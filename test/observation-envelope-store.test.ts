import { afterEach, describe, expect, it } from 'vitest';

import {
  mapObservationEnvelope,
  type ObservationEnvelope,
} from '../domains/telemetry/observation-envelope.js';
import { FileObservationEnvelopeStore } from '../platform/telemetry/observation-envelope-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});

function envelope(sequence: number): ObservationEnvelope {
  return mapObservationEnvelope(
    {
      source: {
        domain: 'workflow',
        eventId: `event-${sequence}`,
        eventType: 'action.completed',
        sequence,
      },
      observedAt: `2026-10-23T08:15:${String(sequence).padStart(2, '0')}.000Z`,
      attributes: {
        'repoctopus.run.id': 'run-store',
        'repoctopus.event.result': 'succeeded',
      },
    },
    {
      allowedAttributes: ['repoctopus.event.result', 'repoctopus.run.id'],
      signals: [{ kind: 'log', name: 'repoctopus.workflow.event', severity: 'info' }],
    },
  );
}

describe('FileObservationEnvelopeStore', () => {
  it('atomically persists immutable envelopes and can retry an interrupted commit', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-store-');
    cleanup.push(workspace);
    const item = envelope(1);
    let interrupt = true;
    const store = new FileObservationEnvelopeStore(workspace, {
      beforeEnvelopeCommit: () => {
        if (interrupt) throw new Error('simulated-process-exit');
      },
    });

    await expect(store.save(item)).rejects.toThrow('simulated-process-exit');
    await expect(store.load(item.envelopeId)).resolves.toBeNull();
    interrupt = false;
    await store.save(item);
    await store.save(structuredClone(item));
    await expect(store.list()).resolves.toEqual([item]);

    const conflicting = mapObservationEnvelope(
      {
        source: item.source,
        observedAt: item.observedAt,
        attributes: { 'repoctopus.run.id': 'another-run' },
      },
      {
        allowedAttributes: ['repoctopus.run.id'],
        signals: item.signals,
      },
    );
    expect(conflicting.envelopeId).toBe(item.envelopeId);
    await expect(store.save(conflicting)).rejects.toThrow(/conflicting observation envelope/iu);
  });

  it('keeps remote and desktop progress independent across opposite failures', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-cursors-');
    cleanup.push(workspace);
    const store = new FileObservationEnvelopeStore(workspace);
    const first = envelope(1);
    const second = envelope(2);
    await store.save(first);
    await store.save(second);

    await store.acknowledge('remote-signoz', first, '2026-10-23T08:16:00.000Z');
    await store.recordFailure('local-desktop', 'receiver-unavailable', '2026-10-23T08:16:01.000Z');
    expect((await store.pending('remote-signoz')).map((item) => item.envelopeId)).toEqual([
      second.envelopeId,
    ]);
    expect((await store.pending('local-desktop')).map((item) => item.envelopeId)).toEqual([
      first.envelopeId,
      second.envelopeId,
    ]);

    await store.acknowledge('local-desktop', first, '2026-10-23T08:16:02.000Z');
    await store.acknowledge('local-desktop', second, '2026-10-23T08:16:03.000Z');
    await store.recordFailure('remote-signoz', 'collector-unavailable', '2026-10-23T08:16:04.000Z');
    expect(await store.pending('local-desktop')).toEqual([]);
    expect((await store.pending('remote-signoz')).map((item) => item.envelopeId)).toEqual([
      second.envelopeId,
    ]);
    expect((await store.readCursor('remote-signoz')).health).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
      lastFailureCode: 'collector-unavailable',
    });
    expect((await store.readCursor('local-desktop')).health).toEqual({
      status: 'healthy',
      consecutiveFailures: 0,
    });
  });

  it('replays after a cursor commit is interrupted instead of advancing another destination', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-replay-');
    cleanup.push(workspace);
    const item = envelope(3);
    let interruptRemote = true;
    const interrupted = new FileObservationEnvelopeStore(workspace, {
      beforeCursorCommit: (cursor) => {
        if (interruptRemote && cursor.destinationId === 'remote-signoz') {
          throw new Error('simulated-process-exit');
        }
      },
    });
    await interrupted.save(item);
    await interrupted.acknowledge('local-desktop', item, '2026-10-23T08:17:00.000Z');
    await expect(
      interrupted.acknowledge('remote-signoz', item, '2026-10-23T08:17:01.000Z'),
    ).rejects.toThrow('simulated-process-exit');

    interruptRemote = false;
    const restarted = new FileObservationEnvelopeStore(workspace);
    await expect(restarted.pending('local-desktop')).resolves.toEqual([]);
    await expect(restarted.pending('remote-signoz')).resolves.toEqual([item]);
    await restarted.acknowledge('remote-signoz', item, '2026-10-23T08:17:02.000Z');
    await expect(restarted.pending('remote-signoz')).resolves.toEqual([]);
  });
});
