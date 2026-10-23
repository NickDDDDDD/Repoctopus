import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

  it('persists enable, pause and remove without resetting another destination', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-lifecycle-');
    cleanup.push(workspace);
    const store = new FileObservationEnvelopeStore(workspace);
    await store.ensureDestination('remote-signoz', '2026-10-23T08:18:00.000Z');
    await store.ensureDestination('local-desktop', '2026-10-23T08:18:00.000Z');
    const first = envelope(1);
    const second = envelope(2);
    const third = envelope(3);
    const fourth = envelope(4);
    await store.save(first, '2026-10-23T08:18:01.000Z');
    await store.acknowledge('remote-signoz', first, '2026-10-23T08:18:02.000Z');

    await store.setDestinationState('local-desktop', 'paused', '2026-10-23T08:18:03.000Z');
    await store.save(second, '2026-10-23T08:18:04.000Z');
    await expect(store.pending('local-desktop')).resolves.toEqual([]);
    expect(await store.inspectDestination('local-desktop')).toMatchObject({
      state: 'paused',
      deliveryGuarantee: 'at-least-once',
      backlog: { envelopeCount: 2 },
      incomplete: false,
    });

    await store.setDestinationState('local-desktop', 'removed', '2026-10-23T08:18:05.000Z');
    await store.save(third, '2026-10-23T08:18:06.000Z');
    expect(await store.inspectDestination('local-desktop')).toMatchObject({
      state: 'removed',
      backlog: { envelopeCount: 0, bytes: 0 },
      incomplete: true,
      droppedEnvelopeCount: 2,
      gaps: [{ reason: 'destination-removed', envelopeCount: 2 }],
    });
    expect(await store.inspectDestination('remote-signoz')).toMatchObject({
      state: 'enabled',
      backlog: { envelopeCount: 2 },
      incomplete: false,
    });

    await store.setDestinationState('local-desktop', 'enabled', '2026-10-23T08:18:07.000Z');
    await expect(store.pending('local-desktop')).resolves.toEqual([]);
    await store.save(fourth, '2026-10-23T08:18:08.000Z');
    await expect(store.pending('local-desktop')).resolves.toEqual([fourth]);
    expect((await store.readCursor('remote-signoz')).acknowledged).toMatchObject({
      [first.envelopeId]: first.digest,
    });
  });

  it('bounds retained envelopes and records gaps only for destinations that missed them', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-retention-');
    cleanup.push(workspace);
    const store = new FileObservationEnvelopeStore(
      workspace,
      {},
      { maxEnvelopes: 2, maxBytes: 1_000_000, maxGapRecords: 2 },
    );
    await store.ensureDestination('remote-signoz', '2026-10-23T08:19:00.000Z');
    await store.ensureDestination('local-desktop', '2026-10-23T08:19:00.000Z');
    const items = [envelope(1), envelope(2), envelope(3), envelope(4), envelope(5)];
    await store.save(items[0]!, '2026-10-23T08:19:01.000Z');
    await store.acknowledge('remote-signoz', items[0]!, '2026-10-23T08:19:02.000Z');
    await store.save(items[1]!, '2026-10-23T08:19:03.000Z');
    await store.save(items[2]!, '2026-10-23T08:19:04.000Z');

    expect(await store.list()).toEqual([items[1], items[2]]);
    expect(await store.inspectDestination('remote-signoz')).toMatchObject({
      incomplete: false,
      droppedEnvelopeCount: 0,
      backlog: { envelopeCount: 2 },
    });
    expect(await store.inspectDestination('local-desktop')).toMatchObject({
      incomplete: true,
      droppedEnvelopeCount: 1,
      backlog: { envelopeCount: 2 },
      gaps: [{ reason: 'retention-limit', envelopeCount: 1 }],
    });

    await store.save(items[3]!, '2026-10-23T08:19:05.000Z');
    await store.save(items[4]!, '2026-10-23T08:19:06.000Z');
    const local = await store.inspectDestination('local-desktop');
    expect(local.gaps).toHaveLength(2);
    expect(local.droppedEnvelopeCount).toBe(3);
    expect(local.backlog.envelopeCount).toBe(2);
    const remote = await store.inspectDestination('remote-signoz');
    expect(remote.gaps).toHaveLength(2);
    expect(remote.droppedEnvelopeCount).toBe(2);
    expect(remote.deliveryGuarantee).toBe('at-least-once');
    expect(JSON.stringify(remote)).not.toContain('exactly-once');
  });

  it.each([
    {
      label: 'byte limit',
      policy: { maxEnvelopes: 10, maxBytes: 1, maxGapRecords: 4 },
      retentionAt: '2026-10-23T08:20:00.000Z',
    },
    {
      label: 'age limit',
      policy: { maxEnvelopes: 10, maxBytes: 1_000_000, maxAgeMs: 1_000, maxGapRecords: 4 },
      retentionAt: '2026-10-23T08:15:02.001Z',
    },
  ])(
    'records a diagnostic gap when the $label evicts an envelope',
    async ({ policy, retentionAt }) => {
      const workspace = await temporaryDirectory('repoctopus-observation-policy-');
      cleanup.push(workspace);
      const store = new FileObservationEnvelopeStore(workspace, {}, policy);
      await store.ensureDestination('local-desktop', '2026-10-23T08:15:00.000Z');
      await store.save(envelope(1), retentionAt);
      expect(await store.list()).toEqual([]);
      expect(await store.inspectDestination('local-desktop')).toMatchObject({
        incomplete: true,
        droppedEnvelopeCount: 1,
        gaps: [{ reason: 'retention-limit', envelopeCount: 1 }],
      });
    },
  );

  it('records a gap before deleting an over-limit envelope and safely retries after interruption', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-retention-recovery-');
    cleanup.push(workspace);
    let interrupt = true;
    const policy = { maxEnvelopes: 1, maxBytes: 1_000_000, maxGapRecords: 4 };
    const store = new FileObservationEnvelopeStore(
      workspace,
      {
        beforeCursorCommit: (cursor) => {
          if (interrupt && cursor.gaps.length > 0) throw new Error('simulated-gap-commit-exit');
        },
      },
      policy,
    );
    await store.ensureDestination('local-desktop', '2026-10-23T08:21:00.000Z');
    const first = envelope(1);
    const second = envelope(2);
    await store.save(first, '2026-10-23T08:21:01.000Z');
    await expect(store.save(second, '2026-10-23T08:21:02.000Z')).rejects.toThrow(
      'simulated-gap-commit-exit',
    );
    expect(await store.list()).toEqual([first, second]);

    interrupt = false;
    const restarted = new FileObservationEnvelopeStore(workspace, {}, policy);
    await restarted.save(second, '2026-10-23T08:21:03.000Z');
    expect(await restarted.list()).toEqual([second]);
    expect(await restarted.inspectDestination('local-desktop')).toMatchObject({
      incomplete: true,
      droppedEnvelopeCount: 1,
    });
  });

  it('migrates the existing v1 cursor without losing acknowledgements', async () => {
    const workspace = await temporaryDirectory('repoctopus-observation-cursor-migration-');
    cleanup.push(workspace);
    const item = envelope(1);
    const directory = path.join(workspace, '.repoctopus', 'telemetry', 'v1', 'destinations');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'remote-signoz.json'),
      JSON.stringify({
        schemaVersion: 1,
        destinationId: 'remote-signoz',
        acknowledged: { [item.envelopeId]: item.digest },
        health: { status: 'healthy', consecutiveFailures: 0 },
        updatedAt: '2026-10-23T08:22:00.000Z',
      }),
    );
    const cursor = await new FileObservationEnvelopeStore(workspace).readCursor('remote-signoz');
    expect(cursor).toMatchObject({
      schemaVersion: 2,
      state: 'enabled',
      acknowledged: { [item.envelopeId]: item.digest },
      gaps: [],
      droppedEnvelopeCount: 0,
    });
  });
});
