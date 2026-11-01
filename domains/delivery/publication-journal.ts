import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { PublicationReceiptItem, PublicationRole } from './publication-receipt.js';
import { PublicationResultUnknownError } from './publication-result-unknown.js';

export type PublicationJournalItemStatus =
  | 'pending'
  | 'push-invoking'
  | 'push-unknown'
  | 'pushed'
  | 'mr-invoking'
  | 'mr-unknown'
  | 'published';

export interface PublicationJournalItemIntent {
  publicationId: string;
  role: PublicationRole;
  deliveryId?: string;
  repositoryId: string;
  remoteIdentity: string;
  remote: string;
  sourceBranch: string;
  targetBranch: string;
  mergeRequestTitle: string;
  mergeRequestBody: string;
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
  schemaVersion: 3;
  changeId: string;
  runId: string;
  stateVersion: number;
  items: PublicationJournalItem[];
  digest: `sha256:${string}`;
}

export interface PublicationJournalStore {
  load(runId: string): Promise<PublicationJournal | null>;
  create(journal: PublicationJournal): Promise<void>;
  compareAndSet(journal: PublicationJournal, expectedDigest: `sha256:${string}`): Promise<void>;
}

export interface PublicationItemExecutor {
  observePush(intent: PublicationJournalItemIntent): Promise<string | null>;
  push(intent: PublicationJournalItemIntent): Promise<string>;
  observeMergeRequest(
    intent: PublicationJournalItemIntent,
  ): Promise<PublicationReceiptItem | null>;
  createMergeRequest(intent: PublicationJournalItemIntent): Promise<PublicationReceiptItem>;
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

function assertIntent(intent: PublicationJournalItemIntent): void {
  if (
    !intent.publicationId.trim() ||
    !intent.repositoryId.trim() ||
    !intent.remoteIdentity.trim() ||
    !intent.remote.trim() ||
    !intent.sourceBranch.trim() ||
    !intent.targetBranch.trim() ||
    !intent.mergeRequestTitle.trim() ||
    !intent.mergeRequestBody.trim() ||
    !/^[a-f0-9]{40,64}$/u.test(intent.expectedOid) ||
    intent.operation !== 'push-and-create-or-adopt-mr'
  ) {
    throw new Error(`Publication Journal item is invalid: ${intent.publicationId}`);
  }
}

function operationId(
  changeId: string,
  runId: string,
  intent: PublicationJournalItemIntent,
): `sha256:${string}` {
  return sha256({
    changeId,
    runId,
    repositoryId: intent.repositoryId,
    role: intent.role,
    deliveryId: intent.deliveryId ?? null,
    sourceBranch: intent.sourceBranch,
    targetBranch: intent.targetBranch,
    mergeRequestTitle: intent.mergeRequestTitle,
    mergeRequestBody: intent.mergeRequestBody,
    expectedOid: intent.expectedOid,
  });
}

export function createPublicationJournal(input: {
  changeId: string;
  runId: string;
  items: readonly PublicationJournalItemIntent[];
}): PublicationJournal {
  if (!input.changeId.trim() || !input.runId.trim()) {
    throw new Error('Publication Journal Change identity is invalid');
  }
  if (input.items.length === 0) throw new Error('Publication Journal requires an item');
  const items = input.items.map((intent) => {
    assertIntent(intent);
    const stableOperationId = operationId(input.changeId, input.runId, intent);
    return {
      operationId: stableOperationId,
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
    schemaVersion: 3,
    changeId: input.changeId,
    runId: input.runId,
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
  const { digest: previousDigest, ...withoutDigest } = unsigned as typeof unsigned & {
    digest?: `sha256:${string}`;
  };
  void previousDigest;
  return { ...withoutDigest, digest: sha256(withoutDigest) };
}

function assertOid(intent: PublicationJournalItemIntent, oid: string): void {
  if (oid !== intent.expectedOid) {
    throw new Error(`Published remote OID drifted: ${intent.publicationId}`);
  }
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

export function assertPublicationJournal(journal: PublicationJournal): void {
  const statuses: readonly PublicationJournalItemStatus[] = [
    'pending',
    'push-invoking',
    'push-unknown',
    'pushed',
    'mr-invoking',
    'mr-unknown',
    'published',
  ];
  if (
    journal.apiVersion !== 'repoctopus.delivery-publication/v1alpha1' ||
    journal.kind !== 'PublicationJournal' ||
    journal.schemaVersion !== 3 ||
    !journal.changeId.trim() ||
    !journal.runId.trim() ||
    !Number.isSafeInteger(journal.stateVersion) ||
    journal.stateVersion < 1 ||
    journal.items.length === 0
  ) {
    throw new Error('Unsupported Publication Journal');
  }
  for (const item of journal.items) {
    assertIntent(item.intent);
    if (
      item.operationId !== operationId(journal.changeId, journal.runId, item.intent) ||
      !statuses.includes(item.status) ||
      !Number.isSafeInteger(item.attempts) ||
      item.attempts < 0 ||
      (item.status === 'published') !== (item.result !== null)
    ) {
      throw new Error(`Publication Journal item state is invalid: ${item.intent.publicationId}`);
    }
    if (item.result) assertResult(item.intent, item.result);
  }
  if (new Set(journal.items.map((item) => item.operationId)).size !== journal.items.length) {
    throw new Error('Publication Journal contains duplicate stable operations');
  }
  const { digest, ...unsigned } = journal;
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest) || sha256(stable(unsigned)) !== digest) {
    throw new Error('Publication Journal digest does not match its contents');
  }
}

function withProvenance(
  result: PublicationReceiptItem,
  provenance: PublicationReceiptItem['provenance'],
): PublicationReceiptItem {
  return { ...structuredClone(result), provenance };
}

export class ResumablePublicationExecutor {
  constructor(
    private readonly store: PublicationJournalStore,
    private readonly adapter: PublicationItemExecutor,
  ) {}

  async publish(input: {
    changeId: string;
    runId: string;
    items: readonly PublicationJournalItemIntent[];
  }): Promise<PublicationJournal> {
    const expected = createPublicationJournal(input);
    let journal = await this.store.load(input.runId);
    if (!journal) {
      journal = expected;
      await this.store.create(journal);
    } else {
      assertPublicationJournal(journal);
    }
    if (
      journal.changeId !== input.changeId ||
      canonicalJson(journal.items.map((item) => item.intent)) !==
        canonicalJson(expected.items.map((item) => item.intent))
    ) {
      throw new Error('Publication request drifted from its durable Journal');
    }

    const persist = async (
      operationId: string,
      update: (item: PublicationJournalItem) => PublicationJournalItem,
    ): Promise<void> => {
      const next = updated(journal!, operationId, update);
      await this.store.compareAndSet(next, journal!.digest);
      journal = next;
    };
    const unknown = (
      item: PublicationJournalItem,
      stage: 'push' | 'merge-request',
      cause?: unknown,
    ) =>
      new PublicationResultUnknownError(
        item.intent.publicationId,
        stage,
        `Publication result is unknown at ${stage}: ${item.intent.publicationId}`,
        cause === undefined ? {} : { cause },
      );

    for (const operationId of expected.items.map((item) => item.operationId)) {
      while (true) {
        const item = journal.items.find((candidate) => candidate.operationId === operationId)!;
        if (item.status === 'published') {
          const [oid, observed] = await Promise.all([
            this.adapter.observePush(item.intent),
            this.adapter.observeMergeRequest(item.intent),
          ]);
          if (!oid || !observed) {
            throw new Error(`Published item disappeared: ${item.intent.publicationId}`);
          }
          assertOid(item.intent, oid);
          assertResult(item.intent, observed);
          break;
        }

        if (item.status === 'pending') {
          const observed = await this.adapter.observePush(item.intent);
          if (observed) {
            assertOid(item.intent, observed);
            await persist(operationId, (candidate) => ({
              ...candidate,
              status: 'pushed',
              diagnostic: null,
            }));
            continue;
          }
          await persist(operationId, (candidate) => ({
            ...candidate,
            status: 'push-invoking',
            attempts: candidate.attempts + 1,
            diagnostic: null,
          }));
          const invoking = journal.items.find(
            (candidate) => candidate.operationId === operationId,
          )!;
          try {
            const oid = await this.adapter.push(invoking.intent);
            assertOid(invoking.intent, oid);
          } catch (error) {
            let recovered: string | null = null;
            try {
              recovered = await this.adapter.observePush(invoking.intent);
            } catch {
              // The durable invoking state remains authoritative when observation also fails.
            }
            if (!recovered) {
              await persist(operationId, (candidate) => ({
                ...candidate,
                status: 'push-unknown',
                diagnostic: error instanceof Error ? error.message : String(error),
              }));
              throw unknown(invoking, 'push', error);
            }
            assertOid(invoking.intent, recovered);
          }
          await persist(operationId, (candidate) => ({
            ...candidate,
            status: 'pushed',
            diagnostic: null,
          }));
          continue;
        }

        if (item.status === 'push-invoking' || item.status === 'push-unknown') {
          let observed: string | null;
          try {
            observed = await this.adapter.observePush(item.intent);
          } catch (error) {
            if (item.status === 'push-invoking') {
              await persist(operationId, (candidate) => ({
                ...candidate,
                status: 'push-unknown',
                diagnostic: error instanceof Error ? error.message : String(error),
              }));
            }
            throw unknown(item, 'push', error);
          }
          if (!observed) {
            if (item.status === 'push-invoking') {
              await persist(operationId, (candidate) => ({
                ...candidate,
                status: 'push-unknown',
                diagnostic: 'No exact remote OID was observable after invocation',
              }));
            }
            throw unknown(item, 'push');
          }
          assertOid(item.intent, observed);
          await persist(operationId, (candidate) => ({
            ...candidate,
            status: 'pushed',
            diagnostic: null,
          }));
          continue;
        }

        if (item.status === 'pushed') {
          const observed = await this.adapter.observeMergeRequest(item.intent);
          if (observed) {
            const adopted = withProvenance(observed, 'human-created');
            assertResult(item.intent, adopted);
            await persist(operationId, (candidate) => ({
              ...candidate,
              status: 'published',
              result: adopted,
              diagnostic: null,
            }));
            break;
          }
          await persist(operationId, (candidate) => ({
            ...candidate,
            status: 'mr-invoking',
            attempts: candidate.attempts + 1,
            diagnostic: null,
          }));
          const invoking = journal.items.find(
            (candidate) => candidate.operationId === operationId,
          )!;
          let result: PublicationReceiptItem;
          try {
            result = await this.adapter.createMergeRequest(invoking.intent);
          } catch (error) {
            let recovered: PublicationReceiptItem | null = null;
            try {
              recovered = await this.adapter.observeMergeRequest(invoking.intent);
            } catch {
              // The durable invoking state remains authoritative when observation also fails.
            }
            if (!recovered) {
              await persist(operationId, (candidate) => ({
                ...candidate,
                status: 'mr-unknown',
                diagnostic: error instanceof Error ? error.message : String(error),
              }));
              throw unknown(invoking, 'merge-request', error);
            }
            result = withProvenance(recovered, 'recovered');
          }
          assertResult(invoking.intent, result);
          await persist(operationId, (candidate) => ({
            ...candidate,
            status: 'published',
            result: structuredClone(result),
            diagnostic: null,
          }));
          break;
        }

        if (item.status === 'mr-invoking' || item.status === 'mr-unknown') {
          let observed: PublicationReceiptItem | null;
          try {
            observed = await this.adapter.observeMergeRequest(item.intent);
          } catch (error) {
            if (item.status === 'mr-invoking') {
              await persist(operationId, (candidate) => ({
                ...candidate,
                status: 'mr-unknown',
                diagnostic: error instanceof Error ? error.message : String(error),
              }));
            }
            throw unknown(item, 'merge-request', error);
          }
          if (!observed) {
            if (item.status === 'mr-invoking') {
              await persist(operationId, (candidate) => ({
                ...candidate,
                status: 'mr-unknown',
                diagnostic: 'No exact merge request was observable after invocation',
              }));
            }
            throw unknown(item, 'merge-request');
          }
          const recovered = withProvenance(observed, 'recovered');
          assertResult(item.intent, recovered);
          await persist(operationId, (candidate) => ({
            ...candidate,
            status: 'published',
            result: recovered,
            diagnostic: null,
          }));
          break;
        }
      }
    }
    return journal;
  }
}
