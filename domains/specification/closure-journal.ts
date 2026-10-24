import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SpecificationClosurePlan, SpecificationProviderIdentity } from './types.js';

export const SPECIFICATION_CLOSURE_JOURNAL_API_VERSION =
  'repoctopus.specification-closure/v1alpha1' as const;

export type SpecificationClosureJournalState =
  | 'prepared'
  | 'applying'
  | 'rolling-back'
  | 'rolled-back'
  | 'committed';

export interface SpecificationFileIdentity {
  path: string;
  kind: 'file' | 'missing';
  contentDigest: `sha256:${string}` | null;
}

export interface SpecificationClosurePostconditions {
  activeChangeAbsent: true;
  expectedArchiveId: string;
  exactlyOneArchive: true;
  affectedCapabilities: string[];
  requiredPurposeCapabilities: string[];
  strictStoreValidation: true;
  allowedPathPrefixes: string[];
}

export interface SpecificationClosureJournal {
  apiVersion: typeof SPECIFICATION_CLOSURE_JOURNAL_API_VERSION;
  kind: 'SpecificationClosureJournal';
  schemaVersion: 1;
  journalId: `sha256:${string}`;
  changeId: string;
  checkoutId: string;
  provider: SpecificationProviderIdentity;
  plan: SpecificationClosurePlan;
  state: SpecificationClosureJournalState;
  stateVersion: number;
  before: SpecificationFileIdentity[];
  expected: SpecificationFileIdentity[];
  postconditions: SpecificationClosurePostconditions;
  resultClosureId: `sha256:${string}` | null;
  digest: `sha256:${string}`;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const transitions: Readonly<
  Record<SpecificationClosureJournalState, readonly SpecificationClosureJournalState[]>
> = {
  prepared: ['applying'],
  applying: ['committed', 'rolling-back'],
  'rolling-back': ['rolled-back'],
  'rolled-back': [],
  committed: [],
};

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function assertRelativePath(value: string, label: string): void {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized.trim() ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//u.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`${label} must stay inside the isolated checkout`);
  }
}

function normalizeFiles(files: readonly SpecificationFileIdentity[]): SpecificationFileIdentity[] {
  const normalized = files
    .map((file) => {
      assertRelativePath(file.path, 'Specification file identity path');
      if (
        (file.kind === 'file' && (!file.contentDigest || !SHA256.test(file.contentDigest))) ||
        (file.kind === 'missing' && file.contentDigest !== null)
      ) {
        throw new Error(`Specification file identity is invalid: ${file.path}`);
      }
      return { ...file, path: file.path.replaceAll('\\', '/') };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(normalized.map((file) => file.path)).size !== normalized.length) {
    throw new Error('Specification file identities must be unique');
  }
  return normalized;
}

function stable(journal: Omit<SpecificationClosureJournal, 'digest'>) {
  return {
    ...structuredClone(journal),
    before: normalizeFiles(journal.before),
    expected: normalizeFiles(journal.expected),
    postconditions: {
      ...structuredClone(journal.postconditions),
      affectedCapabilities: [...new Set(journal.postconditions.affectedCapabilities)].sort(),
      requiredPurposeCapabilities: [
        ...new Set(journal.postconditions.requiredPurposeCapabilities),
      ].sort(),
      allowedPathPrefixes: [...new Set(journal.postconditions.allowedPathPrefixes)]
        .map((prefix) => {
          assertRelativePath(prefix, 'Allowed Specification path prefix');
          return prefix.replaceAll('\\', '/').replace(/\/+$/u, '');
        })
        .sort(),
    },
  };
}

export function createSpecificationClosureJournal(input: {
  changeId: string;
  checkoutId: string;
  plan: SpecificationClosurePlan;
  before: readonly SpecificationFileIdentity[];
  expected?: readonly SpecificationFileIdentity[];
  expectedArchiveId: string;
  requiredPurposeCapabilities?: readonly string[];
}): SpecificationClosureJournal {
  if (!input.changeId.trim() || input.plan.changeId !== input.changeId) {
    throw new Error('Specification Closure Journal plan belongs to another Change');
  }
  if (!input.checkoutId.trim() || /[\\/]/u.test(input.checkoutId)) {
    throw new Error('Specification Closure Journal checkout id must be an opaque identity');
  }
  if (!input.expectedArchiveId.trim() || /[\\/]/u.test(input.expectedArchiveId)) {
    throw new Error('Specification Closure Journal archive id is invalid');
  }
  const base = stable({
    apiVersion: SPECIFICATION_CLOSURE_JOURNAL_API_VERSION,
    kind: 'SpecificationClosureJournal',
    schemaVersion: 1,
    journalId: sha256({
      changeId: input.changeId,
      checkoutId: input.checkoutId,
      planDigest: input.plan.planDigest,
    }),
    changeId: input.changeId,
    checkoutId: input.checkoutId,
    provider: structuredClone(input.plan.provider),
    plan: structuredClone(input.plan),
    state: 'prepared',
    stateVersion: 1,
    before: [...input.before],
    expected: [...(input.expected ?? [])],
    postconditions: {
      activeChangeAbsent: true,
      expectedArchiveId: input.expectedArchiveId,
      exactlyOneArchive: true,
      affectedCapabilities: [...input.plan.affectedCapabilities],
      requiredPurposeCapabilities: [
        ...(input.requiredPurposeCapabilities ?? input.plan.affectedCapabilities),
      ],
      strictStoreValidation: true,
      allowedPathPrefixes: [...input.plan.allowedPathPrefixes],
    },
    resultClosureId: null,
  });
  return { ...base, digest: sha256(base) };
}

export function assertSpecificationClosureJournal(journal: SpecificationClosureJournal): void {
  if (
    journal.apiVersion !== SPECIFICATION_CLOSURE_JOURNAL_API_VERSION ||
    journal.kind !== 'SpecificationClosureJournal' ||
    journal.schemaVersion !== 1
  ) {
    throw new Error('Unsupported Specification Closure Journal contract');
  }
  if (
    journal.changeId !== journal.plan.changeId ||
    journal.provider.id !== journal.plan.provider.id
  ) {
    throw new Error('Specification Closure Journal contains cross-Change or provider input');
  }
  if (!Number.isSafeInteger(journal.stateVersion) || journal.stateVersion < 1) {
    throw new Error('Specification Closure Journal state version is invalid');
  }
  if (
    (journal.state === 'committed') !== (journal.resultClosureId !== null) ||
    (journal.resultClosureId !== null && !SHA256.test(journal.resultClosureId))
  ) {
    throw new Error('Specification Closure Journal committed result is invalid');
  }
  const { digest, ...unsigned } = journal;
  const normalized = stable(unsigned);
  if (!SHA256.test(digest) || sha256(normalized) !== digest) {
    throw new Error('Specification Closure Journal digest does not match its contents');
  }
}

export function advanceSpecificationClosureJournal(
  current: SpecificationClosureJournal,
  nextState: SpecificationClosureJournalState,
  options: {
    expected?: readonly SpecificationFileIdentity[];
    resultClosureId?: `sha256:${string}`;
  } = {},
): SpecificationClosureJournal {
  assertSpecificationClosureJournal(current);
  if (current.state === nextState) return structuredClone(current);
  if (!transitions[current.state].includes(nextState)) {
    throw new Error(`Specification Closure Journal cannot move ${current.state} -> ${nextState}`);
  }
  if (nextState === 'committed' && !options.resultClosureId) {
    throw new Error('Committed Specification Closure Journal requires a Closure Receipt identity');
  }
  const unsigned = stable({
    ...structuredClone(current),
    state: nextState,
    stateVersion: current.stateVersion + 1,
    expected: options.expected ? [...options.expected] : current.expected,
    resultClosureId: nextState === 'committed' ? options.resultClosureId! : null,
  });
  const { digest: _previousDigest, ...withoutDigest } = unsigned as typeof unsigned & {
    digest?: `sha256:${string}`;
  };
  return { ...withoutDigest, digest: sha256(withoutDigest) };
}

export function recordSpecificationClosureExpectedManifest(
  current: SpecificationClosureJournal,
  expected: readonly SpecificationFileIdentity[],
): SpecificationClosureJournal {
  assertSpecificationClosureJournal(current);
  if (current.state !== 'applying' || current.expected.length > 0) {
    throw new Error('Expected Specification manifest can only be recorded once while applying');
  }
  const { digest: _digest, ...unsignedCurrent } = current;
  const unsigned = stable({
    ...unsignedCurrent,
    stateVersion: current.stateVersion + 1,
    expected: [...expected],
  });
  return { ...unsigned, digest: sha256(unsigned) };
}
