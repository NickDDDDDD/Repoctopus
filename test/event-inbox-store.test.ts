import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import {
  acceptDelivery,
  claimDelivery,
  deliveryEnvelope,
  settleDelivery,
} from '../domains/platform-events/inbox.js';
import { FileEventInboxStore } from '../platform/events/file-event-inbox-store.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-inbox-'));
  roots.push(root);
  return root;
}
const timestamp = '2026-10-20T00:00:00.000Z';
const envelope = deliveryEnvelope({
  provider: 'github',
  source: 'primary',
  deliveryId: 'delivery-1',
  eventType: 'pull_request',
  receivedAt: timestamp,
  payload: { number: 2 },
});

it('persists one delivery across duplicate submissions and store reopen', async () => {
  const root = await workspace();
  const store = new FileEventInboxStore(root);
  const accept = () =>
    store.transaction(envelope.envelopeId, (current) => {
      const accepted = acceptDelivery(envelope, timestamp, current ?? undefined);
      return { entry: accepted.entry, result: accepted.duplicate };
    });
  expect(await accept()).toBe(false);
  expect(await accept()).toBe(true);
  expect(await new FileEventInboxStore(root).load(envelope.envelopeId)).toMatchObject({
    status: 'pending',
    stateVersion: 0,
    attempts: 0,
    envelope,
  });
});

async function seed(root: string) {
  const store = new FileEventInboxStore(root);
  await store.transaction(envelope.envelopeId, () => ({
    entry: acceptDelivery(envelope, timestamp).entry,
    result: true,
  }));
  return store;
}
function claim(store: FileEventInboxStore, owner: string, at = timestamp) {
  return store.transaction(envelope.envelopeId, (current) => {
    const entry = claimDelivery({ entry: current!, owner, timestamp: at, leaseMs: 1000 });
    return entry ? { entry, result: entry } : null;
  });
}

it('grants one concurrent lease and fences the former owner after expiry', async () => {
  const root = await workspace();
  const store = await seed(root);
  const contenders = await Promise.all([
    claim(store, 'a'),
    claim(new FileEventInboxStore(root), 'b'),
  ]);
  expect(contenders.filter(Boolean)).toHaveLength(1);
  const original = contenders.find(Boolean)!;
  const recovered = await claim(new FileEventInboxStore(root), 'c', '2026-10-20T00:00:02.000Z');
  expect(recovered).toMatchObject({ attempts: 2, stateVersion: 2, lease: { owner: 'c' } });
  await expect(
    store.transaction(envelope.envelopeId, (current) => ({
      ...settleDelivery({
        entry: current!,
        leaseToken: original.lease!.token,
        timestamp: '2026-10-20T00:00:02.100Z',
        result: 'completed',
      }),
      result: true,
    })),
  ).rejects.toThrow('lease does not match');
  await store.transaction(envelope.envelopeId, (current) => ({
    ...settleDelivery({
      entry: current!,
      leaseToken: recovered!.lease!.token,
      timestamp: '2026-10-20T00:00:02.100Z',
      result: 'completed',
    }),
    result: true,
  }));
  expect(await new FileEventInboxStore(root).receipts(envelope.envelopeId)).toMatchObject([
    { attempt: 2, result: 'completed' },
  ]);
  expect(await claim(store, 'd', '2026-10-20T00:00:04.000Z')).toBeNull();
});

it.each(['afterJournalWritten', 'afterStateWritten'] as const)(
  'recovers a settlement interrupted at %s without duplicating receipts',
  async (hook) => {
    const root = await workspace();
    const store = await seed(root);
    const leased = await claim(store, 'a');
    const interrupted = new FileEventInboxStore(root, {
      [hook]: () => {
        throw new Error('injected interruption');
      },
    });
    await expect(
      interrupted.transaction(envelope.envelopeId, (current) => ({
        ...settleDelivery({
          entry: current!,
          leaseToken: leased!.lease!.token,
          timestamp: '2026-10-20T00:00:00.100Z',
          result: 'completed',
        }),
        result: true,
      })),
    ).rejects.toThrow('injected interruption');
    const restarted = new FileEventInboxStore(root);
    expect(await restarted.load(envelope.envelopeId)).toMatchObject({ status: 'completed' });
    expect(await restarted.receipts(envelope.envelopeId)).toHaveLength(1);
    expect(await new FileEventInboxStore(root).receipts(envelope.envelopeId)).toHaveLength(1);
  },
);

it('preserves a corrupt journal and refuses to serve or overwrite uncertain state', async () => {
  const root = await workspace();
  await seed(root);
  const interrupted = new FileEventInboxStore(root, {
    afterJournalWritten: () => {
      throw new Error('interrupted');
    },
  });
  await expect(claim(interrupted, 'a')).rejects.toThrow('interrupted');
  const file = path.join(
    root,
    '.repoctopus/events',
    envelope.envelopeId.slice(7),
    'transition.json',
  );
  await writeFile(file, '{"schemaVersion":1,', 'utf8');
  const restarted = new FileEventInboxStore(root);
  await expect(restarted.load(envelope.envelopeId)).rejects.toThrow();
  await expect(claim(restarted, 'b')).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('{"schemaVersion":1,');
});

it('rejects settlement after lease expiration even before another worker claims it', async () => {
  const store = await seed(await workspace());
  const leased = await claim(store, 'a');
  await expect(
    store.transaction(envelope.envelopeId, (current) => ({
      ...settleDelivery({
        entry: current!,
        leaseToken: leased!.lease!.token,
        timestamp: '2026-10-20T00:00:01.000Z',
        result: 'completed',
      }),
      result: true,
    })),
  ).rejects.toThrow('expired');
  expect(await store.receipts(envelope.envelopeId)).toEqual([]);
});

it('persists retry delays and a terminal dead letter across restarts', async () => {
  const root = await workspace();
  const store = await seed(root);
  const leased = await claim(store, 'a');
  await store.transaction(envelope.envelopeId, (current) => ({
    ...settleDelivery({
      entry: current!,
      leaseToken: leased!.lease!.token,
      timestamp: '2026-10-20T00:00:00.100Z',
      result: 'retry',
      retryAt: '2026-10-20T00:00:02.000Z',
    }),
    result: true,
  }));
  const restarted = new FileEventInboxStore(root);
  expect(await claim(restarted, 'b', '2026-10-20T00:00:01.000Z')).toBeNull();
  const retry = await claim(restarted, 'b', '2026-10-20T00:00:02.000Z');
  await restarted.transaction(envelope.envelopeId, (current) => ({
    ...settleDelivery({
      entry: current!,
      leaseToken: retry!.lease!.token,
      timestamp: '2026-10-20T00:00:02.100Z',
      result: 'dead_letter',
      diagnostic: 'repository-not-mapped',
    }),
    result: true,
  }));
  expect(await restarted.receipts(envelope.envelopeId)).toMatchObject([
    { attempt: 1, result: 'retry' },
    { attempt: 2, result: 'dead_letter' },
  ]);
  expect(await claim(restarted, 'c', '2026-10-20T00:00:03.000Z')).toBeNull();
});

it('rejects reused delivery identities with different event semantics', async () => {
  const store = await seed(await workspace());
  for (const changed of [
    deliveryEnvelope({ ...envelope, payload: { number: 3 } }),
    deliveryEnvelope({ ...envelope, eventType: 'issues' }),
  ]) {
    await expect(
      store.transaction(envelope.envelopeId, (current) => ({
        entry: acceptDelivery(changed, timestamp, current!).entry,
        result: true,
      })),
    ).rejects.toThrow('Delivery ID');
  }
  expect(await store.load(envelope.envelopeId)).toMatchObject({ stateVersion: 0, envelope });
});

it('rejects a stale captured state instead of overwriting a newer lease', async () => {
  const store = await seed(await workspace());
  const captured = (await store.load(envelope.envelopeId))!;
  await claim(store, 'a');
  await claim(store, 'b', '2026-10-20T00:00:02.000Z');
  const stale = claimDelivery({ entry: captured, owner: 'stale', timestamp, leaseMs: 1000 })!;
  await expect(
    store.transaction(envelope.envelopeId, () => ({ entry: stale, result: true })),
  ).rejects.toThrow('state version');
  expect(await store.load(envelope.envelopeId)).toMatchObject({ lease: { owner: 'b' } });
});

it('does not change state when a transaction callback throws', async () => {
  const store = await seed(await workspace());
  await expect(
    store.transaction(envelope.envelopeId, (current) => {
      current!.attempts = 99;
      throw new Error('callback failed');
    }),
  ).rejects.toThrow('callback failed');
  expect(await store.load(envelope.envelopeId)).toMatchObject({ attempts: 0, stateVersion: 0 });
});

it('rejects a terminal state without its processing receipt', async () => {
  const store = await seed(await workspace());
  await expect(
    store.transaction(envelope.envelopeId, (current) => ({
      entry: { ...current!, status: 'completed', stateVersion: 1 },
      result: true,
    })),
  ).rejects.toThrow('receipt');
});

it('uses canonical payload digests and explicit identity fields independent of key order', () => {
  const left = deliveryEnvelope({ ...envelope, payload: { b: 2, a: 1 } });
  const right = deliveryEnvelope({ ...envelope, payload: { a: 1, b: 2 } });
  expect(left.payloadDigest).toBe(right.payloadDigest);
  expect(left.envelopeId).toBe(right.envelopeId);
  expect(() => deliveryEnvelope({ ...envelope, eventType: '' })).toThrow('eventType');
});

it('refuses a valid JSON journal whose snapshot was altered', async () => {
  const root = await workspace();
  await seed(root);
  await expect(
    claim(
      new FileEventInboxStore(root, {
        afterJournalWritten: () => {
          throw new Error('interrupted');
        },
      }),
      'a',
    ),
  ).rejects.toThrow('interrupted');
  const file = path.join(
    root,
    '.repoctopus/events',
    envelope.envelopeId.slice(7),
    'transition.json',
  );
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('"owner": "a"', '"owner": "tampered"'));
  await expect(new FileEventInboxStore(root).load(envelope.envelopeId)).rejects.toThrow(
    'Corrupt event inbox journal',
  );
});
