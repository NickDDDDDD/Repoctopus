import { createHash } from 'node:crypto';

import type { ExecutionBinding, WorkPackageCandidate } from '../change-lifecycle/build-protocol.js';
import { isProtectedBranch, normalizeProtectedBranchPatterns } from '../delivery/branch-policy.js';
import { reconcileProjectSnapshots } from '../project/snapshot.js';
import type { ProjectReconciliation, ProjectSnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export type ProtectedBranchRebindRejectionReason =
  | 'lifecycle-not-correctable'
  | 'candidate-missing'
  | 'binding-missing'
  | 'protected-write-set-empty'
  | 'project-identity-drift'
  | 'branch-change-empty'
  | 'branch-change-unrelated'
  | 'binding-baseline-drift'
  | 'branch-still-protected'
  | 'reconciliation-poison-mismatch';

export interface AuthorizedProtectedBranchRebind {
  schemaVersion: 1;
  kind: 'authorized-protected-branch-rebind';
  authorizationDigest: `sha256:${string}`;
  projectReconciliationDigest: `sha256:${string}`;
  bindingId: string;
  correctedRepositoryIds: readonly string[];
  unresolvedRepositoryIds: readonly string[];
  repositoryCount: number;
  poisonRecovery: boolean;
  reconciliation: ProjectReconciliation;
}

export type ProtectedBranchRebindClassification =
  | { authorized: true; value: AuthorizedProtectedBranchRebind }
  | {
      authorized: false;
      reason: ProtectedBranchRebindRejectionReason;
      reconciliation: ProjectReconciliation;
    };

export interface ClassifyProtectedBranchRebindInput {
  phase: string;
  workKind: string | null;
  executionStatus: string | null;
  continuation: string | null;
  candidate: { packages: readonly WorkPackageCandidate[] } | null;
  binding: ExecutionBinding | null;
  protectedBranches: readonly string[];
  previousProjectSnapshot: ProjectSnapshot;
  currentProjectSnapshot: ProjectSnapshot;
  reconciliationRequired: boolean;
  poisonReconciliation?: ProjectReconciliation | null;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function projectReconciliationDigest(
  reconciliation: ProjectReconciliation,
): `sha256:${string}` {
  return digest(reconciliation);
}

function sameReconciliation(
  left: ProjectReconciliation | null | undefined,
  right: ProjectReconciliation,
): boolean {
  return Boolean(left) && canonicalJson(left) === canonicalJson(right);
}

function rejected(
  reason: ProtectedBranchRebindRejectionReason,
  reconciliation: ProjectReconciliation,
): ProtectedBranchRebindClassification {
  return { authorized: false, reason, reconciliation };
}

/**
 * Classifies only the branch correction explicitly requested by a rejected
 * protected-write Plan. It deliberately does not perform Git side effects or
 * choose the next lifecycle Action.
 */
export function classifyProtectedBranchRebind(
  input: ClassifyProtectedBranchRebindInput,
): ProtectedBranchRebindClassification {
  const reconciliation = reconcileProjectSnapshots(
    input.previousProjectSnapshot,
    input.currentProjectSnapshot,
  );
  if (
    input.phase !== 'build' ||
    input.workKind !== 'build.plan' ||
    input.executionStatus !== 'invoking' ||
    input.continuation !== 'awaiting-correction'
  ) {
    return rejected('lifecycle-not-correctable', reconciliation);
  }
  if (!input.candidate) return rejected('candidate-missing', reconciliation);
  if (!input.binding) return rejected('binding-missing', reconciliation);

  const protectedBranches = normalizeProtectedBranchPatterns(input.protectedBranches);
  const writeRepositoryIds = [
    ...new Set(
      input.candidate.packages.flatMap((workPackage) =>
        workPackage.writeScopes.map((scope) => scope.repositoryId),
      ),
    ),
  ].sort();
  const bindingByRepository = new Map(
    input.binding.repositories.map((repository) => [repository.repositoryId, repository] as const),
  );
  const protectedWriteRepositoryIds = writeRepositoryIds.filter((repositoryId) => {
    const repository = bindingByRepository.get(repositoryId);
    return repository ? isProtectedBranch(repository.branchRef, protectedBranches) : false;
  });
  if (protectedWriteRepositoryIds.length === 0) {
    return rejected('protected-write-set-empty', reconciliation);
  }

  const previousByRepository = new Map(
    input.previousProjectSnapshot.repositories.map(
      (repository) => [repository.id, repository] as const,
    ),
  );
  const currentByRepository = new Map(
    input.currentProjectSnapshot.repositories.map(
      (repository) => [repository.id, repository] as const,
    ),
  );
  const sameProjectEnvelope =
    input.previousProjectSnapshot.projectId === input.currentProjectSnapshot.projectId &&
    input.previousProjectSnapshot.root === input.currentProjectSnapshot.root &&
    canonicalJson(input.previousProjectSnapshot.diagnostics) ===
      canonicalJson(input.currentProjectSnapshot.diagnostics) &&
    input.previousProjectSnapshot.repositories.every(
      (repository) => currentByRepository.get(repository.id)?.name === repository.name,
    );
  if (
    !sameProjectEnvelope ||
    reconciliation.added.length > 0 ||
    reconciliation.removed.length > 0 ||
    reconciliation.changedRepositories.some(
      (repository) =>
        repository.fields.includes('path') || repository.fields.includes('remoteIdentity'),
    )
  ) {
    return rejected('project-identity-drift', reconciliation);
  }

  const correctedRepositoryIds = reconciliation.changedRepositories
    .filter((repository) => repository.fields.includes('branch'))
    .map((repository) => repository.repositoryId)
    .sort();
  if (correctedRepositoryIds.length === 0) {
    return rejected('branch-change-empty', reconciliation);
  }
  const protectedWriteSet = new Set(protectedWriteRepositoryIds);
  if (correctedRepositoryIds.some((repositoryId) => !protectedWriteSet.has(repositoryId))) {
    return rejected('branch-change-unrelated', reconciliation);
  }

  for (const repository of input.binding.repositories) {
    const current = currentByRepository.get(repository.repositoryId);
    if (
      !current ||
      (!correctedRepositoryIds.includes(repository.repositoryId) &&
        current.branch !== repository.branchRef)
    ) {
      return rejected('binding-baseline-drift', reconciliation);
    }
  }

  const changes: Array<{
    repositoryId: string;
    previousBranch: string;
    currentBranch: string;
    headRevision: string;
  }> = [];
  for (const repositoryId of correctedRepositoryIds) {
    const binding = bindingByRepository.get(repositoryId);
    const previous = previousByRepository.get(repositoryId);
    const current = currentByRepository.get(repositoryId);
    if (
      !binding ||
      !previous ||
      !current ||
      previous.branch !== binding.branchRef ||
      current.head !== binding.headRevision ||
      current.remoteIdentity === null ||
      current.remoteIdentity !== previous.remoteIdentity
    ) {
      return rejected('binding-baseline-drift', reconciliation);
    }
    if (!current.branch || isProtectedBranch(current.branch, protectedBranches)) {
      return rejected('branch-still-protected', reconciliation);
    }
    changes.push({
      repositoryId,
      previousBranch: binding.branchRef,
      currentBranch: current.branch,
      headRevision: current.head,
    });
  }

  if (
    input.reconciliationRequired &&
    !sameReconciliation(input.poisonReconciliation, reconciliation)
  ) {
    return rejected('reconciliation-poison-mismatch', reconciliation);
  }

  const unresolvedRepositoryIds = protectedWriteRepositoryIds.filter(
    (repositoryId) => !correctedRepositoryIds.includes(repositoryId),
  );
  return {
    authorized: true,
    value: Object.freeze({
      schemaVersion: 1,
      kind: 'authorized-protected-branch-rebind',
      authorizationDigest: digest({
        schemaVersion: 1,
        bindingId: input.binding.bindingId,
        candidate: input.candidate,
        protectedBranches,
        changes,
      }),
      projectReconciliationDigest: projectReconciliationDigest(reconciliation),
      bindingId: input.binding.bindingId,
      correctedRepositoryIds: Object.freeze(correctedRepositoryIds),
      unresolvedRepositoryIds: Object.freeze(unresolvedRepositoryIds),
      repositoryCount: correctedRepositoryIds.length,
      poisonRecovery: input.reconciliationRequired,
      reconciliation,
    }),
  };
}
