import { createHash } from 'node:crypto';

import {
  advanceBuildWorkspaceCheckpoint,
  type BuildWorkspaceCheckpoint,
  type ExecutionWorkspaceBinding,
} from '../change-lifecycle/build-protocol.js';
import {
  classifyRepositoryInput,
  type CompiledRepositoryInputPolicy,
} from '../evidence/repository-input-policy.js';
import type { RunState } from '../engine/types.js';
import { reconcileProjectSnapshots } from '../project/snapshot.js';
import type { ProjectReconciliation, ProjectSnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export interface BuildWorkspaceRecovery {
  expectedStateVersion: number;
  bindingId: string;
  checkpointDigest: string;
  observationDigest: string;
  conflicts: readonly string[];
  reconciliation: ProjectReconciliation;
}

export interface RuntimeOutputCleanupProof {
  repositoryId: string;
  priorHead: string;
  head: string;
  policyDigest: `sha256:${string}`;
  deletedCount: number;
  digest: `sha256:${string}`;
}

export function isTrackedRuntimeOutput(
  policy: CompiledRepositoryInputPolicy,
  relativePath: string,
): boolean {
  return (
    !relativePath.includes('\\') &&
    classifyRepositoryInput(policy, relativePath, true).kind === 'conflict' &&
    classifyRepositoryInput(policy, relativePath, false).kind === 'runtime-output'
  );
}

export function canAcceptBuildRuntimeCleanup(state: RunState): boolean {
  return (
    state.status === 'running' &&
    state.changeLifecycle?.phase === 'build' &&
    state.changeLifecycle.currentWork?.kind === 'build.execute' &&
    state.changeLifecycle.buildProtocol?.currentAction === 'execute' &&
    !state.changeLifecycle.waitCondition &&
    !state.changeLifecycle.blocker &&
    (!state.workExecution ||
      (state.workExecution.status === 'not-executed' &&
        state.workExecution.workId === state.changeLifecycle.currentWork.workId &&
        state.workExecution.checkEpoch === state.changeLifecycle.checkEpoch &&
        !state.workExecution.pendingSubmission))
  );
}

export function advanceRuntimeOutputCleanupCheckpoint(
  checkpoint: BuildWorkspaceCheckpoint,
  proof: RuntimeOutputCleanupProof,
): BuildWorkspaceCheckpoint {
  const previous = checkpoint.repositories.find(
    ({ repositoryId }) => repositoryId === proof.repositoryId,
  );
  if (
    !previous ||
    previous.headRevision !== proof.priorHead ||
    proof.head === proof.priorHead ||
    !Number.isSafeInteger(proof.deletedCount) ||
    proof.deletedCount <= 0
  ) {
    throw new Error('Runtime output cleanup does not match the accepted workspace checkpoint');
  }
  return advanceBuildWorkspaceCheckpoint({
    current: checkpoint,
    observed: checkpoint.repositories.map((repository) =>
      repository.repositoryId === proof.repositoryId
        ? { ...repository, headRevision: proof.head }
        : repository,
    ),
    writableRepositoryIds: [proof.repositoryId],
    relations: Object.fromEntries(
      checkpoint.repositories.map(({ repositoryId }) => [
        repositoryId,
        repositoryId === proof.repositoryId ? 'fast-forward' : 'unchanged',
      ]),
    ),
  });
}

export function isRuntimeOutputCleanupConflict(
  observation: Pick<BuildWorkspaceRecovery, 'conflicts'>,
  repositoryId: string,
): boolean {
  return (
    observation.conflicts?.length === 1 &&
    observation.conflicts[0] === `unaccepted-head:${repositoryId}`
  );
}

export function classifyBuildWorkspaceRecovery(input: {
  state: RunState;
  previous: ProjectSnapshot;
  current: ProjectSnapshot;
  observed: ExecutionWorkspaceBinding | null;
  observationError?: string;
  planningPublication?: { repositoryId: string; snapshotDigest: string };
  verificationConfigPublication?: {
    repositoryId: string;
    observedHead: string;
    decisionDigest: string;
  };
}): BuildWorkspaceRecovery {
  const lifecycle = input.state.changeLifecycle!;
  const protocol = lifecycle.buildProtocol!;
  const binding = protocol.binding!;
  const checkpoint = protocol.workspaceCheckpoint!;
  const reconciliation = reconcileProjectSnapshots(input.previous, input.current);
  const conflicts: string[] = [];
  if (
    input.previous.projectId !== input.current.projectId ||
    input.previous.root !== input.current.root ||
    canonicalJson(input.previous.diagnostics) !== canonicalJson(input.current.diagnostics) ||
    reconciliation.added.length > 0 ||
    reconciliation.removed.length > 0
  ) {
    conflicts.push('project-identity-changed');
  }
  for (const repository of input.current.repositories) {
    const original = input.previous.repositories.find((entry) => entry.id === repository.id);
    if (
      !original ||
      original.name !== repository.name ||
      original.path !== repository.path ||
      original.remoteIdentity !== repository.remoteIdentity
    ) {
      conflicts.push(`repository-identity-changed:${repository.id}`);
    }
  }
  const observed = input.observed;
  if (!observed) {
    conflicts.push(input.observationError ?? 'checkout-observation-failed');
  } else {
    if (
      observed.isolation !== protocol.strategy.isolationIntent ||
      observed.repositories.length !== binding.repositories.length ||
      `execution-workspace:${observed.localDigest.slice(-24)}` !== binding.localOverlayRef
    ) {
      conflicts.push('checkout-binding-changed');
    }
    const execution = input.state.workExecution;
    const work = lifecycle.currentWork;
    const activePackage =
      work?.kind === 'build.execute' &&
      execution?.workId === work.workId &&
      execution.checkEpoch === lifecycle.checkEpoch &&
      execution.hostInvocation
        ? protocol.plan?.packages.find((entry) => entry.packageId === work.packageId)
        : undefined;
    for (const repository of observed.repositories) {
      const bound = binding.repositories.find(
        (entry) => entry.repositoryId === repository.repositoryId,
      );
      const accepted = checkpoint.repositories.find(
        (entry) => entry.repositoryId === repository.repositoryId,
      );
      if (
        !bound ||
        !accepted ||
        repository.branch !== bound.branchRef ||
        repository.worktreeId !== bound.worktreeId ||
        repository.branch !== accepted.branchRef
      ) {
        conflicts.push(`checkout-identity-changed:${repository.repositoryId}`);
      } else if (
        repository.head !== accepted.headRevision &&
        !(
          work?.kind === 'build.plan' &&
          input.planningPublication?.repositoryId === repository.repositoryId
        ) &&
        !(
          protocol.status === 'ready-for-verify' &&
          input.verificationConfigPublication?.repositoryId === repository.repositoryId &&
          input.verificationConfigPublication.observedHead === repository.head
        ) &&
        !activePackage?.writeScopes.some((scope) => scope.repositoryId === repository.repositoryId)
      ) {
        conflicts.push(`unaccepted-head:${repository.repositoryId}`);
      }
    }
  }
  return {
    expectedStateVersion: input.state.stateVersion,
    bindingId: binding.bindingId,
    checkpointDigest: checkpoint.digest,
    observationDigest: createHash('sha256')
      .update(
        canonicalJson({
          bindingId: binding.bindingId,
          checkpointDigest: checkpoint.digest,
          workId: lifecycle.currentWork?.workId ?? null,
          checkEpoch: lifecycle.checkEpoch,
          snapshotDigest: input.current.digest,
          observedDigest: observed?.stateDigest ?? null,
          planningPublication: input.planningPublication ?? null,
          verificationConfigPublication: input.verificationConfigPublication ?? null,
          conflicts,
        }),
      )
      .digest('hex'),
    conflicts,
    reconciliation,
  };
}
