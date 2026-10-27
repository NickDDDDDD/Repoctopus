import { afterEach, describe, expect, it } from 'vitest';

import { createObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import { FileObservationEnvelopeStore } from '../platform/telemetry/file-observation-envelope-store.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function workspace(): Promise<string> {
  const value = await temporaryDirectory('repoctopus-observation-destinations-');
  cleanup.push(value);
  return value;
}

function envelope(sequence: number) {
  return createObservationEnvelope({
    source: {
      eventId: `destination-event-${sequence}`,
      eventName: 'work.completed',
      observedAt: `2026-10-27T05:20:0${sequence}.000Z`,
    },
    correlation: { traceId: '1'.repeat(32), spanId: sequence.toString(16).padStart(16, '0') },
    resourceAttributes: { 'service.name': 'repoctopus' },
    recordAttributes: {
      'repoctopus.event.id': `destination-event-${sequence}`,
      'repoctopus.execution.phase': 'build',
      'repoctopus.execution.work.kind': 'task.implement',
      'repoctopus.execution.result': 'succeeded',
    },
    metric: {
      value: 1,
      attributes: { phase: 'build', 'work.kind': 'task.implement', result: 'succeeded' },
    },
  });
}

describe('observation destination lifecycle and bounded retention', () => {
  it('pauses and removes one destination without resetting another destination cursor', async () => {
    const root = await workspace();
    const store = new FileObservationEnvelopeStore(root);
    await store.enableDestination({
      destinationId: 'team-signoz',
      destinationKind: 'remote',
      changedAt: '2026-10-27T05:20:00.000Z',
    });
    await store.enableDestination({
      destinationId: 'desktop-current-user',
      destinationKind: 'desktop',
      changedAt: '2026-10-27T05:20:00.000Z',
    });
    const first = await store.append(envelope(1));
    await store.append(envelope(2));
    await store.acknowledge({
      destinationId: 'team-signoz',
      offset: first.offset,
      envelopeId: first.envelope.envelopeId,
      acknowledgedAt: '2026-10-27T05:20:03.000Z',
    });

    await store.pauseDestination({
      destinationId: 'desktop-current-user',
      changedAt: '2026-10-27T05:20:04.000Z',
    });
    expect(await store.readPending('desktop-current-user')).toEqual([]);
    expect(
      await store.readDestination('desktop-current-user', '2026-10-27T05:20:04.000Z'),
    ).toMatchObject({
      mode: 'paused',
      headOffset: 2,
      cursorLag: 2,
      backlog: { count: 2, oldestAgeMs: 3_000 },
    });
    expect((await store.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([2]);

    await store.enableDestination({
      destinationId: 'desktop-current-user',
      destinationKind: 'desktop',
      changedAt: '2026-10-27T05:20:05.000Z',
    });
    expect((await store.readPending('desktop-current-user')).map((entry) => entry.offset)).toEqual([
      1, 2,
    ]);

    await store.removeDestination({
      destinationId: 'desktop-current-user',
      changedAt: '2026-10-27T05:20:06.000Z',
    });
    await store.append(envelope(3));
    await store.enableDestination({
      destinationId: 'desktop-current-user',
      destinationKind: 'desktop',
      changedAt: '2026-10-27T05:20:07.000Z',
    });

    expect(await store.readPending('desktop-current-user')).toEqual([]);
    expect(await store.readCursor('team-signoz')).toMatchObject({ acknowledgedOffset: 1 });
    expect((await store.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([2, 3]);
    expect(
      await store.readDestination('desktop-current-user', '2026-10-27T05:20:08.000Z'),
    ).toMatchObject({
      mode: 'enabled',
      deliverySemantics: 'at-least-once-replay',
      backlog: { count: 0, bytes: 0, oldestAgeMs: 0 },
    });
  });

  it('atomically records durable per-destination gaps before pruning unconfirmed envelopes', async () => {
    const root = await workspace();
    const store = new FileObservationEnvelopeStore(root, {
      retention: { maxEntries: 2, maxBytes: 1_000_000, maxAgeMs: 60_000 },
      now: () => new Date('2026-10-27T05:20:10.000Z'),
    });
    for (const [destinationId, destinationKind] of [
      ['team-signoz', 'remote'],
      ['desktop-current-user', 'desktop'],
    ] as const) {
      await store.enableDestination({
        destinationId,
        destinationKind,
        changedAt: '2026-10-27T05:20:00.000Z',
      });
    }
    const first = await store.append(envelope(1));
    await store.acknowledge({
      destinationId: 'team-signoz',
      offset: first.offset,
      envelopeId: first.envelope.envelopeId,
      acknowledgedAt: '2026-10-27T05:20:02.000Z',
    });
    await store.append(envelope(2));
    await store.append(envelope(3));
    await store.append(envelope(4));

    const restarted = new FileObservationEnvelopeStore(root);
    expect((await restarted.readAll()).map((entry) => entry.offset)).toEqual([3, 4]);
    expect(await restarted.readCursor('team-signoz')).toMatchObject({ acknowledgedOffset: 1 });
    expect((await restarted.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([
      3, 4,
    ]);
    expect(
      await restarted.readDestination('team-signoz', '2026-10-27T05:20:10.000Z'),
    ).toMatchObject({
      gap: { count: 1, droppedCount: 1, completeHistory: false },
      backlog: { count: 2 },
    });
    expect(
      await restarted.readDestination('desktop-current-user', '2026-10-27T05:20:10.000Z'),
    ).toMatchObject({
      gap: { count: 2, droppedCount: 2, completeHistory: false },
      backlog: { count: 2 },
    });
    expect(await restarted.readGaps('team-signoz')).toEqual([
      expect.objectContaining({ fromOffset: 2, toOffset: 2, droppedCount: 1 }),
    ]);
    expect(await restarted.readGaps('desktop-current-user')).toEqual([
      expect.objectContaining({ fromOffset: 1, toOffset: 1, droppedCount: 1 }),
      expect.objectContaining({ fromOffset: 2, toOffset: 2, droppedCount: 1 }),
    ]);
    const [third] = await restarted.readPending('team-signoz');
    await restarted.acknowledge({
      destinationId: 'team-signoz',
      offset: third!.offset,
      envelopeId: third!.envelope.envelopeId,
      acknowledgedAt: '2026-10-27T05:20:11.000Z',
    });
    expect(await restarted.readCursor('team-signoz')).toMatchObject({ acknowledgedOffset: 3 });
    expect((await restarted.readPending('team-signoz')).map((entry) => entry.offset)).toEqual([4]);
  });

  it.each([
    ['byte cap', { maxEntries: 100, maxBytes: 1, maxAgeMs: 60_000 }, '2026-10-27T05:20:10.000Z'],
    [
      'age cap',
      { maxEntries: 100, maxBytes: 1_000_000, maxAgeMs: 1_000 },
      '2026-10-27T05:21:00.000Z',
    ],
  ])('enforces the %s without claiming complete history', async (_label, policy, evaluatedAt) => {
    const root = await workspace();
    const store = new FileObservationEnvelopeStore(root);
    await store.enableDestination({
      destinationId: 'team-signoz',
      destinationKind: 'remote',
      changedAt: '2026-10-27T05:20:00.000Z',
    });
    await store.append(envelope(1));
    await store.append(envelope(2));

    const result = await store.enforceRetention(policy, evaluatedAt);

    expect(result).toMatchObject({ droppedCount: 2, retainedCount: 0 });
    expect(await store.readDestination('team-signoz', evaluatedAt)).toMatchObject({
      cursor: { acknowledgedOffset: 0 },
      headOffset: 2,
      cursorLag: 2,
      backlog: { count: 0 },
      gap: { count: 1, droppedCount: 2, completeHistory: false },
      deliverySemantics: 'at-least-once-replay',
    });
  });

  it('keeps both envelopes and gap history unchanged when the atomic retention commit is interrupted', async () => {
    const root = await workspace();
    const stable = new FileObservationEnvelopeStore(root);
    await stable.enableDestination({
      destinationId: 'team-signoz',
      destinationKind: 'remote',
      changedAt: '2026-10-27T05:20:00.000Z',
    });
    await stable.append(envelope(1));
    await stable.append(envelope(2));
    const interrupted = new FileObservationEnvelopeStore(root, {
      beforeEnvelopeCommit: () => {
        throw new Error('interrupt retention commit');
      },
    });

    await expect(
      interrupted.enforceRetention(
        { maxEntries: 1, maxBytes: 1_000_000, maxAgeMs: 60_000 },
        '2026-10-27T05:20:10.000Z',
      ),
    ).rejects.toThrow('interrupt retention commit');

    const restarted = new FileObservationEnvelopeStore(root);
    expect((await restarted.readAll()).map((entry) => entry.offset)).toEqual([1, 2]);
    expect(await restarted.readGaps('team-signoz')).toEqual([]);
  });
});
