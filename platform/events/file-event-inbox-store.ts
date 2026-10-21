import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { deliveryEnvelope } from '../../domains/platform-events/inbox.js';
import type { EventInboxMutation, EventInboxStore } from '../../domains/platform-events/ports.js';
import type {
  EventInboxEntry,
  EventProcessingReceipt,
} from '../../domains/platform-events/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { RecoverableFileTransition } from '../runtime/recoverable-file-transition.js';

const hash = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/)
  .transform((value): `sha256:${string}` => value as `sha256:${string}`);
const timestamp = z.iso.datetime();
const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: hash,
    envelopeId: hash,
    result: z.enum(['completed', 'retry', 'dead_letter']),
    attempt: z.number().int().positive(),
    completedAt: timestamp,
    diagnostic: z.string().optional(),
  })
  .strict()
  .transform(({ diagnostic, ...receipt }) => ({
    ...receipt,
    ...(diagnostic === undefined ? {} : { diagnostic }),
  }));
const entrySchema = z
  .object({
    schemaVersion: z.literal(1),
    envelope: z
      .object({
        apiVersion: z.literal('repoctopus.platform-event/v1alpha1'),
        kind: z.literal('PlatformDeliveryEnvelope'),
        provider: z.string().trim().min(1),
        source: z.string().trim().min(1),
        deliveryId: z.string().trim().min(1),
        eventType: z.string().trim().min(1),
        receivedAt: timestamp,
        payload: z.record(z.string(), z.json()),
        payloadDigest: hash,
        envelopeId: hash,
      })
      .strict(),
    status: z.enum(['pending', 'leased', 'retry_wait', 'completed', 'dead_letter']),
    attempts: z.number().int().nonnegative(),
    lease: z
      .object({
        owner: z.string().min(1),
        token: z.string().min(1),
        expiresAt: timestamp,
      })
      .strict()
      .nullable(),
    nextAttemptAt: timestamp.nullable(),
    receiptId: hash.nullable(),
    diagnostic: z.string().nullable(),
    stateVersion: z.number().int().nonnegative(),
    updatedAt: timestamp,
  })
  .strict();
const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    entry: entrySchema,
    receipts: z.array(receiptSchema),
  })
  .strict();
type Snapshot = z.infer<typeof snapshotSchema>;
const journalSchema = z
  .object({
    schemaVersion: z.literal(1),
    previousDigest: hash.nullable(),
    next: snapshotSchema,
    nextDigest: hash,
  })
  .strict();
type Journal = z.infer<typeof journalSchema>;

const CLAIM_SCAN_CONCURRENCY = 16;
const CLAIMABLE_BATCH_SIZE = 64;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export interface EventInboxStoreHooks {
  afterJournalWritten?(): void | Promise<void>;
  afterStateWritten?(): void | Promise<void>;
}

/** One lock and recoverable journal per delivery; state and receipts share one atomic snapshot. */
export class FileEventInboxStore implements EventInboxStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly hooks: EventInboxStoreHooks = {},
  ) {}

  private paths(envelopeId: string) {
    hash.parse(envelopeId);
    const root = path.join(this.workspaceRoot, '.repoctopus', 'events', envelopeId.slice(7));
    return {
      state: path.join(root, 'state.json'),
      lock: path.join(root, 'transition.lock'),
      journal: path.join(root, 'transition.json'),
    };
  }

  private validate(snapshot: Snapshot, envelopeId: string): void {
    const { entry, receipts } = snapshot;
    const envelope = deliveryEnvelope(entry.envelope);
    if (
      envelope.envelopeId !== envelopeId ||
      envelope.payloadDigest !== entry.envelope.payloadDigest ||
      entry.envelope.envelopeId !== envelopeId ||
      (entry.status === 'leased') !== (entry.lease !== null) ||
      (entry.status === 'retry_wait') !== (entry.nextAttemptAt !== null)
    ) {
      throw new Error('Invalid event inbox snapshot');
    }
    for (const receipt of receipts) {
      const { receiptId } = receipt;
      const base = {
        envelopeId: receipt.envelopeId,
        result: receipt.result,
        attempt: receipt.attempt,
        completedAt: receipt.completedAt,
        ...(receipt.diagnostic === undefined ? {} : { diagnostic: receipt.diagnostic }),
      };
      if (receipt.envelopeId !== envelopeId || receiptId !== digest(base)) {
        throw new Error('Invalid event inbox receipt');
      }
    }
    if (
      new Set(receipts.map((receipt) => receipt.receiptId)).size !== receipts.length ||
      entry.receiptId !== (receipts.at(-1)?.receiptId ?? null)
    ) {
      throw new Error('Event inbox receipt history does not match state');
    }
    const last = receipts.at(-1);
    if (
      ['completed', 'dead_letter', 'retry_wait'].includes(entry.status) &&
      (!last ||
        last.attempt !== entry.attempts ||
        last.result !== (entry.status === 'retry_wait' ? 'retry' : entry.status) ||
        last.completedAt !== entry.updatedAt ||
        (last.diagnostic ?? null) !== entry.diagnostic)
    ) {
      throw new Error('Event inbox settlement requires a matching receipt');
    }
    if (
      entry.status === 'pending' &&
      (entry.attempts !== 0 || entry.stateVersion !== 0 || receipts.length !== 0)
    ) {
      throw new Error('Invalid initial event inbox state');
    }
    if (entry.status === 'leased' && entry.attempts < 1) {
      throw new Error('Invalid event inbox lease attempt');
    }
  }

  private async read(envelopeId: string): Promise<Snapshot | null> {
    let content: string;
    try {
      content = await readFile(this.paths(envelopeId).state, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const snapshot = snapshotSchema.parse(JSON.parse(content));
    this.validate(snapshot, envelopeId);
    return snapshot;
  }

  private async replay(envelopeId: string, raw: Journal): Promise<void> {
    const journal = journalSchema.parse(raw);
    this.validate(journal.next, envelopeId);
    if (digest(journal.next) !== journal.nextDigest) throw new Error('Corrupt event inbox journal');
    const current = await this.read(envelopeId);
    const currentDigest = current ? digest(current) : null;
    if (currentDigest === journal.nextDigest) return;
    if (currentDigest !== journal.previousDigest) throw new Error('Stale event inbox journal');
    await atomicWriteJson(this.paths(envelopeId).state, journal.next);
    await this.hooks.afterStateWritten?.();
  }

  private transition(envelopeId: string) {
    const files = this.paths(envelopeId);
    return new RecoverableFileTransition<Journal>(files.lock, files.journal);
  }

  private async snapshot(envelopeId: string): Promise<Snapshot | null> {
    return this.transition(envelopeId).run(
      (journal) => this.replay(envelopeId, journal),
      () => this.read(envelopeId),
    );
  }

  async load(envelopeId: string): Promise<EventInboxEntry | null> {
    return (await this.snapshot(envelopeId))?.entry ?? null;
  }

  async inspect(
    envelopeId: string,
  ): Promise<{ entry: EventInboxEntry; receipts: EventProcessingReceipt[] } | null> {
    const snapshot = await this.snapshot(envelopeId);
    return snapshot
      ? { entry: structuredClone(snapshot.entry), receipts: structuredClone(snapshot.receipts) }
      : null;
  }

  async listClaimable(timestampValue: string): Promise<EventInboxEntry[]> {
    const now = Date.parse(timestampValue);
    if (!Number.isFinite(now)) throw new Error('Valid claim timestamp is required');
    const root = path.join(this.workspaceRoot, '.repoctopus', 'events');
    let directories;
    try {
      directories = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const envelopeIds = directories
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
      .map((entry) => `sha256:${entry.name}`)
      .sort();
    const entries: Array<EventInboxEntry | null> = [];
    for (let offset = 0; offset < envelopeIds.length; offset += CLAIM_SCAN_CONCURRENCY) {
      entries.push(
        ...(await Promise.all(
          envelopeIds
            .slice(offset, offset + CLAIM_SCAN_CONCURRENCY)
            .map((envelopeId) => this.load(envelopeId)),
        )),
      );
    }
    return entries
      .filter((entry): entry is EventInboxEntry => {
        if (!entry || entry.status === 'completed' || entry.status === 'dead_letter') return false;
        if (entry.status === 'leased') return Date.parse(entry.lease!.expiresAt) <= now;
        if (entry.status === 'retry_wait') return Date.parse(entry.nextAttemptAt!) <= now;
        return true;
      })
      .sort(
        (left, right) =>
          left.envelope.receivedAt.localeCompare(right.envelope.receivedAt) ||
          left.envelope.envelopeId.localeCompare(right.envelope.envelopeId),
      )
      .slice(0, CLAIMABLE_BATCH_SIZE);
  }

  async receipts(envelopeId: string): Promise<EventProcessingReceipt[]> {
    return (await this.snapshot(envelopeId))?.receipts ?? [];
  }

  async transaction<T>(
    envelopeId: string,
    update: (current: EventInboxEntry | null) => EventInboxMutation<T> | null,
  ): Promise<T | null> {
    return this.transition(envelopeId).run(
      (journal) => this.replay(envelopeId, journal),
      async (transition) => {
        const current = await this.read(envelopeId);
        const mutation = update(current ? structuredClone(current.entry) : null);
        if (!mutation) return null;
        const next = snapshotSchema.parse({
          schemaVersion: 1,
          entry: mutation.entry,
          receipts: [...(current?.receipts ?? []), ...(mutation.receipt ? [mutation.receipt] : [])],
        });
        this.validate(next, envelopeId);
        if (current && digest(next) === digest(current)) return mutation.result;
        if (
          next.entry.stateVersion !== (current ? current.entry.stateVersion + 1 : 0) ||
          (current && canonicalJson(next.entry.envelope) !== canonicalJson(current.entry.envelope))
        ) {
          throw new Error('Invalid event inbox state version or immutable envelope');
        }
        await transition.commit(
          {
            schemaVersion: 1,
            previousDigest: current ? digest(current) : null,
            next,
            nextDigest: digest(next),
          },
          (journal) => this.replay(envelopeId, journal),
          () => this.hooks.afterJournalWritten?.(),
        );
        return mutation.result;
      },
    );
  }
}
