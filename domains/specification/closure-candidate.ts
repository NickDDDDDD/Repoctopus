import { canonicalJson } from '../workflow-contract/canonical.js';
import type { SpecificationClosureJournal, SpecificationFileIdentity } from './closure-journal.js';
import type { SpecificationClosureResult } from './types.js';

export interface SpecificationClosureCandidateObservation {
  changeId: string;
  activeChangeExists: boolean;
  archiveIds: string[];
  purposeCapabilities: string[];
  validAffectedCapabilities: string[];
  retiredCapabilities: string[];
  strictStoreValid: boolean;
  changedFiles: string[];
  manifest: SpecificationFileIdentity[];
}

export type SpecificationClosureRecoveryDecision =
  | 'continue-apply'
  | 'continue-commit'
  | 'continue-rollback'
  | 'complete-rollback'
  | 'return-committed'
  | 'manual-repair';

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameManifest(
  left: readonly SpecificationFileIdentity[],
  right: readonly SpecificationFileIdentity[],
): boolean {
  return (
    canonicalJson([...left].sort((a, b) => a.path.localeCompare(b.path))) ===
    canonicalJson([...right].sort((a, b) => a.path.localeCompare(b.path)))
  );
}

export function assertSpecificationClosureCandidate(input: {
  journal: SpecificationClosureJournal;
  result: SpecificationClosureResult;
  observation: SpecificationClosureCandidateObservation;
}): void {
  const { journal, result, observation } = input;
  if (
    observation.changeId !== journal.changeId ||
    result.changeId !== journal.changeId ||
    result.planDigest !== journal.plan.planDigest
  ) {
    throw new Error('Specification closure candidate belongs to another Change or plan');
  }
  if (observation.activeChangeExists) {
    throw new Error('Specification closure candidate still contains the active Change');
  }
  if (observation.archiveIds.length !== 1 || observation.archiveIds[0] !== result.archiveId) {
    throw new Error('Specification closure candidate must contain exactly one expected archive');
  }
  const missingPurpose = journal.postconditions.requiredPurposeCapabilities.filter(
    (capability) => !observation.purposeCapabilities.includes(capability),
  );
  if (missingPurpose.length > 0) {
    throw new Error(
      `Specification closure candidate is missing Purpose: ${missingPurpose.join(', ')}`,
    );
  }
  const activeCapabilities = journal.postconditions.affectedCapabilities.filter(
    (capability) => !journal.postconditions.retiredCapabilities.includes(capability),
  );
  const invalidAffected = activeCapabilities.filter(
    (capability) => !observation.validAffectedCapabilities.includes(capability),
  );
  if (invalidAffected.length > 0) {
    throw new Error(
      `Specification closure candidate has invalid affected Specifications: ${invalidAffected.join(', ')}`,
    );
  }
  const missingRetired = journal.postconditions.retiredCapabilities.filter(
    (capability) => !observation.retiredCapabilities.includes(capability),
  );
  if (missingRetired.length > 0) {
    throw new Error(
      `Specification closure candidate did not retire capabilities: ${missingRetired.join(', ')}`,
    );
  }
  if (!observation.strictStoreValid) {
    throw new Error('Specification closure candidate failed strict Store validation');
  }
  const outside = observation.changedFiles.filter(
    (file) =>
      !journal.postconditions.allowedPathPrefixes.some(
        (prefix) => file === prefix || file.startsWith(`${prefix}/`),
      ),
  );
  if (outside.length > 0) {
    throw new Error(
      `Specification closure candidate changed paths outside the plan: ${outside.join(', ')}`,
    );
  }
  if (
    canonicalJson(sorted(observation.changedFiles)) !== canonicalJson(sorted(result.changedFiles))
  ) {
    throw new Error('Specification closure result does not match the observed allowed diff');
  }
}

export function decideSpecificationClosureRecovery(input: {
  journal: SpecificationClosureJournal;
  current: readonly SpecificationFileIdentity[];
  candidateValid: boolean;
}): SpecificationClosureRecoveryDecision {
  const { journal, current } = input;
  const matchesBefore = sameManifest(current, journal.before);
  const matchesExpected = journal.expected.length > 0 && sameManifest(current, journal.expected);
  if (journal.state === 'committed') return matchesExpected ? 'return-committed' : 'manual-repair';
  if (journal.state === 'rolled-back') return matchesBefore ? 'complete-rollback' : 'manual-repair';
  if (journal.state === 'prepared') return matchesBefore ? 'continue-apply' : 'manual-repair';
  if (journal.state === 'applying') {
    if (matchesExpected && input.candidateValid) return 'continue-commit';
    if (matchesBefore) return 'continue-apply';
    return 'manual-repair';
  }
  if (journal.state === 'rolling-back') {
    if (matchesBefore) return 'complete-rollback';
    if (matchesExpected) return 'continue-rollback';
    return 'manual-repair';
  }
  return 'manual-repair';
}
