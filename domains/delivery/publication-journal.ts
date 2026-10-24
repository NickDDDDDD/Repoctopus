import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { PublicationReceiptItem, PublicationRole } from './publication-receipt.js';

export type PublicationJournalItemStatus = 'pending' | 'published' | 'failed';

export interface PublicationJournalItemIntent {
  publicationId: string;
  role: PublicationRole;
  deliveryId?: string;
  repositoryId: string;
  remoteIdentity: string;
  remote: string;
  sourceBranch: string;
  targetBranch: string;
  expectedOid: string;
  operation: 'push-and-create-or-adopt-mr';
}

export interface PublicationJournalItem {
  operationId: `sha256:${string}`;
  intent: PublicationJournalItemIntent;
  status: PublicationJournalItemStatus;
  attempts: number;
  result: PublicationReceiptItem | null;
  diagnostic: string | null;
}

export interface PublicationJournal {
  apiVersion: 'repoctopus.delivery-publication/v1alpha1';
  kind: 'PublicationJournal';
  schemaVersion: 1;
  changeId: string;
  generation: number;
  stateVersion: number;
  items: PublicationJournalItem[];
  digest: `sha256:${string}`;
}

export interface PublicationJournalStore {
  load(changeId: string, generation: number): Promise<PublicationJournal | null>;
  create(journal: PublicationJournal): Promise<void>;
  compareAndSet(journal: PublicationJournal, expectedDigest: `sha256:${string}`): Promise<void>;
}

export interface PublicationItemExecutor {
  observe(intent: PublicationJournalItemIntent): Promise<PublicationReceiptItem | null>;
  execute(intent: PublicationJournalItemIntent): Promise<PublicationReceiptItem>;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function stable(input: Omit<PublicationJournal, 'digest'>) {
  return {
    ...structuredClone(input),
    items: [...input.items].sort((left, right) =>
      [
        left.intent.role,
        left.intent.repositoryId,
        left.intent.deliveryId ?? '',
        left.intent.publicationId,
        left.operationId,
      ]
        .join('\0')
        .localeCompare(
          [
            right.intent.role,
            right.intent.repositoryId,
            right.intent.deliveryId ?? '',
            right.intent.publicationId,
            right.operationId,
          ].join('\0'),
        ),
    ),
  };
}

export function createPublicationJournal(input: {
  changeId: string;
  generation: number;
  items: readonly PublicationJournalItemIntent[];
}): PublicationJournal {
  if (!input.changeId.trim() || !Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new Error('Publication Journal Change identity is invalid');
  }
  if (input.items.length < 2)
    throw new Error('Publication Journal requires Business and Specification items');
  const items = input.items.map((intent) => {
    if (
      !intent.publicationId.trim() ||
      !intent.repositoryId.trim() ||
      !intent.remoteIdentity.trim() ||
      !intent.remote.trim() ||
      !intent.sourceBranch.trim() ||
      !intent.targetBranch.trim() ||
      !/^[a-f0-9]{40,64}$/u.test(intent.expectedOid) ||
      intent.operation !== 'push-and-create-or-adopt-mr'
    ) {
      throw new Error(`Publication Journal item is invalid: ${intent.publicationId}`);
    }
    const operationId = sha256({
      changeId: input.changeId,
      generation: input.generation,
      repositoryId: intent.repositoryId,
      role: intent.role,
      deliveryId: intent.deliveryId ?? null,
      sourceBranch: intent.sourceBranch,
      targetBranch: intent.targetBranch,
      expectedOid: intent.expectedOid,
    });
    return {
      operationId,
      intent: structuredClone(intent),
      status: 'pending' as const,
      attempts: 0,
      result: null,
      diagnostic: null,
    };
  });
  if (new Set(items.map((item) => item.operationId)).size !== items.length) {
    throw new Error('Publication Journal contains duplicate stable operations');
  }
  const unsigned = stable({
    apiVersion: 'repoctopus.delivery-publication/v1alpha1',
    kind: 'PublicationJournal',
    schemaVersion: 1,
    changeId: input.changeId,
    generation: input.generation,
    stateVersion: 1,
    items,
  });
  return { ...unsigned, digest: sha256(unsigned) };
}

function updated(
  current: PublicationJournal,
  operationId: string,
  update: (item: PublicationJournalItem) => PublicationJournalItem,
): PublicationJournal {
  const unsigned = stable({
    ...current,
    stateVersion: current.stateVersion + 1,
    items: current.items.map((item) =>
      item.operationId === operationId ? update(structuredClone(item)) : structuredClone(item),
    ),
  });
  const { digest: _digest, ...withoutDigest } = unsigned as typeof unsigned & {
    digest?: `sha256:${string}`;
  };
  return { ...withoutDigest, digest: sha256(withoutDigest) };
}

function assertResult(intent: PublicationJournalItemIntent, result: PublicationReceiptItem): void {
  if (
    result.publicationId !== intent.publicationId ||
    result.role !== intent.role ||
    result.repositoryId !== intent.repositoryId ||
    result.remoteIdentity !== intent.remoteIdentity ||
    result.remote !== intent.remote ||
    result.sourceBranch !== intent.sourceBranch ||
    result.targetBranch !== intent.targetBranch ||
    result.publishedOid !== intent.expectedOid ||
    (intent.deliveryId ?? null) !== (result.deliveryId ?? null)
  ) {
    throw new Error(`Observed publication does not match stable item: ${intent.publicationId}`);
  }
}

export class ResumablePublicationExecutor {
  constructor(
    private readonly store: PublicationJournalStore,
    private readonly adapter: PublicationItemExecutor,
  ) {}

  async publish(input: {
    changeId: string;
    generation: number;
    items: readonly PublicationJournalItemIntent[];
  }): Promise<PublicationJournal> {
    let journal = await this.store.load(input.changeId, input.generation);
    if (!journal) {
      journal = createPublicationJournal(input);
      await this.store.create(journal);
    }
    for (const item of journal.items) {
      if (item.status === 'published') {
        const observed = await this.adapter.observe(item.intent);
        if (!observed) throw new Error(`Published item disappeared: ${item.intent.publicationId}`);
        assertResult(item.intent, observed);
        continue;
      }
      let result = await this.adapter.observe(item.intent);
      if (!result) {
        try {
          result = await this.adapter.execute(item.intent);
        } catch (error) {
          result = await this.adapter.observe(item.intent);
          if (!result) {
            const failed = updated(journal, item.operationId, (candidate) => ({
              ...candidate,
              status: 'failed',
              attempts: candidate.attempts + 1,
              diagnostic: error instanceof Error ? error.message : String(error),
            }));
            await this.store.compareAndSet(failed, journal.digest);
            throw new Error(`Publication failed at item ${item.intent.publicationId}`, {
              cause: error,
            });
          }
        }
      }
      assertResult(item.intent, result);
      const published = updated(journal, item.operationId, (candidate) => ({
        ...candidate,
        status: 'published',
        attempts: candidate.attempts + 1,
        result: structuredClone(result),
        diagnostic: null,
      }));
      await this.store.compareAndSet(published, journal.digest);
      journal = published;
    }
    return journal;
  }
}
