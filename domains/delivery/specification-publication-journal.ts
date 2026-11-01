import { createHash } from 'node:crypto';

import type { PublicationReceiptItem } from './publication-receipt.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export const SPECIFICATION_PUBLICATION_JOURNAL_API_VERSION =
  'repoctopus.specification-publication/v1alpha1' as const;

export type SpecificationPublicationJournalState =
  | 'prepared'
  | 'committed'
  | 'push-invoking'
  | 'push-unknown'
  | 'pushed'
  | 'mr-invoking'
  | 'mr-unknown'
  | 'completed';

export interface SpecificationPublicationIntent {
  changeId: string;
  runId: string;
  closureId: `sha256:${string}`;
  planDigest: `sha256:${string}`;
  checkoutId: string;
  baseOid: string;
  changedFiles: string[];
  repositoryId: string;
  remoteIdentity: string;
  remote: string;
  sourceBranch: string;
  targetBranch: string;
  commitMessage: string;
}

export interface SpecificationPublicationJournal {
  apiVersion: typeof SPECIFICATION_PUBLICATION_JOURNAL_API_VERSION;
  kind: 'SpecificationPublicationJournal';
  schemaVersion: 2;
  journalId: `sha256:${string}`;
  state: SpecificationPublicationJournalState;
  stateVersion: number;
  intent: SpecificationPublicationIntent;
  publishedOid: string | null;
  result: PublicationReceiptItem | null;
  digest: `sha256:${string}`;
}

export interface SpecificationPublicationJournalStore {
  load(runId: string): Promise<SpecificationPublicationJournal | null>;
  create(journal: SpecificationPublicationJournal): Promise<void>;
  compareAndSet(
    journal: SpecificationPublicationJournal,
    expectedDigest: `sha256:${string}`,
  ): Promise<void>;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function relativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//u.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Specification publication path is invalid: ${value}`);
  }
  return normalized;
}

function normalizeIntent(intent: SpecificationPublicationIntent): SpecificationPublicationIntent {
  return {
    ...structuredClone(intent),
    changedFiles: [...new Set(intent.changedFiles.map(relativePath))].sort(),
  };
}

function stable(journal: Omit<SpecificationPublicationJournal, 'digest'>) {
  return {
    ...structuredClone(journal),
    intent: normalizeIntent(journal.intent),
  };
}

function assertIntent(intent: SpecificationPublicationIntent): void {
  const required = [
    intent.changeId,
    intent.runId,
    intent.checkoutId,
    intent.repositoryId,
    intent.remoteIdentity,
    intent.remote,
    intent.sourceBranch,
    intent.targetBranch,
    intent.commitMessage,
  ];
  if (
    required.some((value) => !value.trim()) ||
    !SHA256.test(intent.closureId) ||
    !SHA256.test(intent.planDigest) ||
    !GIT_OID.test(intent.baseOid) ||
    intent.sourceBranch === intent.targetBranch ||
    intent.changedFiles.length === 0
  ) {
    throw new Error('Specification publication intent is invalid');
  }
  normalizeIntent(intent);
  if (new Set(intent.changedFiles.map(relativePath)).size !== intent.changedFiles.length) {
    throw new Error('Specification publication changed files must be unique');
  }
}

function assertResult(
  intent: SpecificationPublicationIntent,
  oid: string,
  result: PublicationReceiptItem,
): void {
  if (
    result.publicationId !== `specification:${intent.runId}` ||
    result.role !== 'specification' ||
    result.deliveryId !== undefined ||
    result.repositoryId !== intent.repositoryId ||
    result.remoteIdentity !== intent.remoteIdentity ||
    result.remote !== intent.remote ||
    result.sourceBranch !== intent.sourceBranch ||
    result.targetBranch !== intent.targetBranch ||
    result.publishedOid !== oid
  ) {
    throw new Error('Specification publication result does not match its stable intent');
  }
}

export function createSpecificationPublicationJournal(
  intent: SpecificationPublicationIntent,
): SpecificationPublicationJournal {
  assertIntent(intent);
  const normalized = normalizeIntent(intent);
  const unsigned = stable({
    apiVersion: SPECIFICATION_PUBLICATION_JOURNAL_API_VERSION,
    kind: 'SpecificationPublicationJournal',
    schemaVersion: 2,
    journalId: sha256(normalized),
    state: 'prepared',
    stateVersion: 1,
    intent: normalized,
    publishedOid: null,
    result: null,
  });
  return { ...unsigned, digest: sha256(unsigned) };
}

export function assertSpecificationPublicationJournal(
  journal: SpecificationPublicationJournal,
): void {
  const states: readonly SpecificationPublicationJournalState[] = [
    'prepared',
    'committed',
    'push-invoking',
    'push-unknown',
    'pushed',
    'mr-invoking',
    'mr-unknown',
    'completed',
  ];
  if (
    journal.apiVersion !== SPECIFICATION_PUBLICATION_JOURNAL_API_VERSION ||
    journal.kind !== 'SpecificationPublicationJournal' ||
    journal.schemaVersion !== 2 ||
    !Number.isSafeInteger(journal.stateVersion) ||
    journal.stateVersion < 1 ||
    !states.includes(journal.state)
  ) {
    throw new Error('Unsupported Specification publication Journal');
  }
  assertIntent(journal.intent);
  if (journal.journalId !== sha256(normalizeIntent(journal.intent))) {
    throw new Error('Specification publication Journal identity drifted');
  }
  const needsOid = journal.state !== 'prepared';
  const needsResult = journal.state === 'completed';
  if (
    needsOid !== (journal.publishedOid !== null) ||
    (journal.publishedOid !== null && !GIT_OID.test(journal.publishedOid)) ||
    needsResult !== (journal.result !== null)
  ) {
    throw new Error('Specification publication Journal state is incomplete');
  }
  if (journal.result && journal.publishedOid) {
    assertResult(journal.intent, journal.publishedOid, journal.result);
  }
  const { digest, ...unsigned } = journal;
  const normalized = stable(unsigned);
  if (!SHA256.test(digest) || sha256(normalized) !== digest) {
    throw new Error('Specification publication Journal digest does not match its contents');
  }
}

function advance(
  current: SpecificationPublicationJournal,
  state: Exclude<SpecificationPublicationJournalState, 'prepared'>,
  input: { publishedOid: string; result?: PublicationReceiptItem },
): SpecificationPublicationJournal {
  assertSpecificationPublicationJournal(current);
  const expected: Record<
    SpecificationPublicationJournalState,
    SpecificationPublicationJournalState[]
  > = {
    prepared: ['committed'],
    committed: ['push-invoking', 'pushed'],
    'push-invoking': ['push-unknown', 'pushed'],
    'push-unknown': ['pushed'],
    pushed: ['mr-invoking', 'completed'],
    'mr-invoking': ['mr-unknown', 'completed'],
    'mr-unknown': ['completed'],
    completed: [],
  };
  if (!expected[current.state].includes(state)) {
    throw new Error(`Specification publication Journal cannot move ${current.state} -> ${state}`);
  }
  if (!GIT_OID.test(input.publishedOid)) {
    throw new Error('Specification publication commit OID is invalid');
  }
  if (current.publishedOid && current.publishedOid !== input.publishedOid) {
    throw new Error('Specification publication commit OID drifted');
  }
  if (state === 'completed') {
    if (!input.result) throw new Error('Completed Specification publication requires a result');
    assertResult(current.intent, input.publishedOid, input.result);
  } else if (input.result) {
    throw new Error('Specification publication result is only valid at completed');
  }
  const { digest: previousDigest, ...withoutDigest } = current;
  void previousDigest;
  const unsigned = stable({
    ...withoutDigest,
    state,
    stateVersion: current.stateVersion + 1,
    publishedOid: input.publishedOid,
    result: input.result ? structuredClone(input.result) : null,
  });
  return { ...unsigned, digest: sha256(unsigned) };
}

export function recordSpecificationPublicationCommit(
  current: SpecificationPublicationJournal,
  publishedOid: string,
): SpecificationPublicationJournal {
  return advance(current, 'committed', { publishedOid });
}

export function recordSpecificationPublicationPush(
  current: SpecificationPublicationJournal,
): SpecificationPublicationJournal {
  if (!current.publishedOid) throw new Error('Specification publication has no committed OID');
  return advance(current, 'pushed', { publishedOid: current.publishedOid });
}

export function recordSpecificationPushInvocation(
  current: SpecificationPublicationJournal,
): SpecificationPublicationJournal {
  if (!current.publishedOid) throw new Error('Specification publication has no committed OID');
  return advance(current, 'push-invoking', { publishedOid: current.publishedOid });
}

export function recordSpecificationPushUnknown(
  current: SpecificationPublicationJournal,
): SpecificationPublicationJournal {
  if (!current.publishedOid) throw new Error('Specification publication has no committed OID');
  return advance(current, 'push-unknown', { publishedOid: current.publishedOid });
}

export function recordSpecificationMergeRequestInvocation(
  current: SpecificationPublicationJournal,
): SpecificationPublicationJournal {
  if (!current.publishedOid) throw new Error('Specification publication has no pushed OID');
  return advance(current, 'mr-invoking', { publishedOid: current.publishedOid });
}

export function recordSpecificationMergeRequestUnknown(
  current: SpecificationPublicationJournal,
): SpecificationPublicationJournal {
  if (!current.publishedOid) throw new Error('Specification publication has no pushed OID');
  return advance(current, 'mr-unknown', { publishedOid: current.publishedOid });
}

export function recordSpecificationPublicationCompletion(
  current: SpecificationPublicationJournal,
  result: PublicationReceiptItem,
): SpecificationPublicationJournal {
  if (!current.publishedOid) throw new Error('Specification publication has no pushed OID');
  return advance(current, 'completed', { publishedOid: current.publishedOid, result });
}
