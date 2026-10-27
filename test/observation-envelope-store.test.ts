import { afterEach, describe, expect, it } from 'vitest';

import {
  createObservationEnvelope,
} from '../domains/telemetry/observation-envelope.js';
import { FileObservationEnvelopeStore } from '../platform/telemetry/file-observation-envelope-store.js';
import {
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function envelope(sequence: number, result: 'succeeded' | 'failed' = 'succeeded') {
  return createObservationEnvelope({
    source: {
      eventId: `event-${sequence}`,
      eventName: 'work.completed',
      observedAt: `2026-10-27T05:20:${String(sequence).padStart(2, '0')}.000Z`,
    },
    correlation: { traceId: '1'.repeat(32), spanId: sequence.toString(16).padStart(16, '0') },
    resourceAttributes: { 'service.name': 'repoctopus' },
    recordAttributes: {
      'repoctopus.event.id': `event-${sequence}`,
      'repoctopus.execution.phase': 'build',
      'repoctopus.execution.work.kind': 'task.implement',
      'repoctopus.execution.result': result,
    },
    metric: {
      value: 1,
      attributes: { phase: 'build', 'work.kind': 'task.implement', result },
    },
  });
}

async function workspace(): Promise<string> {
  const value = await temporaryDirectory('repoctopus-observation-store-');
  cleanup.push(value);
  return value;
}

describe('atomic observation envelope store', () => {
  it.each([
    ['remote succeeds while desktop fails', 'team-signoz', 'desktop-current-user'],
    ['desktop succeeds while remote fails', 'desktop-current-user', 'team-signoz'],
  ])('keeps destination cursors independent when %s', async (_label, succeeds, fails) => {
    const store = new FileObservationEnvelopeStore(await workspace());
    const appended = await store.append(envelope(1));

    await store.acknowledge({
      destinationId: succeeds,
      offset: appended.offset,
      envelopeId: appended.envelope.envelopeId,
      acknowledgedAt: '2026-10-27T05:21:00.000Z',
    });

    expect(await store.readCursor(succeeds)).toMatchObject({
      destinationId: succeeds,
      acknowledgedOffset: 1,
      acknowledgedEnvelopeId: appended.envelope.envelopeId,
    });
    expect(await store.readCursor(fails)).toMatchObject({
      destinationId: fails,
      acknowledgedOffset: 0,
      acknowledgedEnvelopeId: null,
    });
    expect(await store.readPending(succeeds)).toEqual([]);
    expect((await store.readPending(fails)).map((entry) => entry.offset)).toEqual([1]);
  });

  it('recovers a durable envelope after process exit before any destination confirms it', async () => {
    const root = await workspace();
    const crashing = new FileObservationEnvelopeStore(root, {
      afterEnvelopeCommit: () => {
        throw new Error('simulated process exit');
      },
    });
    await expect(crashing.append(envelope(1))).rejects.toThrow('simulated process exit');

    const restarted = new FileObservationEnvelopeStore(root);
    expect((await restarted.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([1]);
    expect((await restarted.readPending('desktop-current-user')).map((entry) => entry.offset)).toEqual(
      [1],
    );
  });

  it('replays only records after each destination own persisted cursor', async () => {
    const root = await workspace();
    const firstProcess = new FileObservationEnvelopeStore(root);
    const first = await firstProcess.append(envelope(1));
    const second = await firstProcess.append(envelope(2));
    await firstProcess.acknowledge({
      destinationId: 'team-signoz',
      offset: first.offset,
      envelopeId: first.envelope.envelopeId,
      acknowledgedAt: '2026-10-27T05:21:00.000Z',
    });

    const restarted = new FileObservationEnvelopeStore(root);
    expect((await restarted.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([
      second.offset,
    ]);
    expect((await restarted.readPending('desktop-current-user')).map((entry) => entry.offset)).toEqual(
      [first.offset, second.offset],
    );
  });

  it('leaves the old atomic state readable when envelope or cursor commit is interrupted', async () => {
    const root = await workspace();
    const stable = new FileObservationEnvelopeStore(root);
    const first = await stable.append(envelope(1));
    const interruptedEnvelope = new FileObservationEnvelopeStore(root, {
      beforeEnvelopeCommit: () => {
        throw new Error('interrupt envelope commit');
      },
    });
    await expect(interruptedEnvelope.append(envelope(2))).rejects.toThrow(
      'interrupt envelope commit',
    );

    const interruptedCursor = new FileObservationEnvelopeStore(root, {
      beforeCursorCommit: () => {
        throw new Error('interrupt cursor commit');
      },
    });
    await expect(
      interruptedCursor.acknowledge({
        destinationId: 'team-signoz',
        offset: first.offset,
        envelopeId: first.envelope.envelopeId,
        acknowledgedAt: '2026-10-27T05:21:00.000Z',
      }),
    ).rejects.toThrow('interrupt cursor commit');

    const restarted = new FileObservationEnvelopeStore(root);
    expect((await restarted.readAll()).map((entry) => entry.offset)).toEqual([1]);
    expect(await restarted.readCursor('team-signoz')).toMatchObject({ acknowledgedOffset: 0 });
    expect((await restarted.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([1]);
  });

  it('deduplicates exact replay and rejects gaps, wrong identities and identity collisions', async () => {
    const store = new FileObservationEnvelopeStore(await workspace());
    const value = envelope(1);
    const first = await store.append(value);
    expect(await store.append(value)).toEqual(first);

    await expect(
      store.acknowledge({
        destinationId: 'team-signoz',
        offset: 2,
        envelopeId: value.envelopeId,
        acknowledgedAt: '2026-10-27T05:21:00.000Z',
      }),
    ).rejects.toThrow(/contiguous/iu);
    await expect(
      store.acknowledge({
        destinationId: 'team-signoz',
        offset: 1,
        envelopeId: `sha256:${'f'.repeat(64)}`,
        acknowledgedAt: '2026-10-27T05:21:00.000Z',
      }),
    ).rejects.toThrow(/identity/iu);

    const colliding = envelope(1, 'failed');
    expect(colliding.envelopeId).toBe(value.envelopeId);
    expect(colliding.canonicalDigest).not.toBe(value.canonicalDigest);
    await expect(store.append(colliding)).rejects.toThrow(/identity collision/iu);
  });
});
