import type { ExecutionWorkspaceBinding } from '../change-lifecycle/build-protocol.js';
import type { RunState } from '../engine/types.js';
import { reconcileProjectSnapshots } from '../project/snapshot.js';
import type { ProjectSnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { evidenceInputDigest } from '../evidence/input-snapshot.js';
import type { BuildWorkspaceRecovery } from './build-workspace-recovery.js';

export interface EvidenceWorkspaceRecovery extends BuildWorkspaceRecovery {
  phase: 'verify' | 'archive';
  verificationInputDigest: `sha256:${string}`;
}

/** Checkout authority is independent from content equivalence. HEAD alone is not evidence drift. */
export function classifyEvidenceWorkspaceRecovery(input: {
  state: RunState;
  previous: ProjectSnapshot;
  current: ProjectSnapshot;
  observed: ExecutionWorkspaceBinding | null;
  observationError?: string;
}): EvidenceWorkspaceRecovery {
  const lifecycle = input.state.changeLifecycle!;
  const protocol = lifecycle.buildProtocol!;
  if (
    !['verify', 'archive'].includes(lifecycle.phase) ||
    !lifecycle.verificationInput ||
    !protocol.binding ||
    !protocol.workspaceCheckpoint
  ) {
    throw new Error('Evidence workspace recovery requires frozen Verify authority');
  }
  const reconciliation = reconcileProjectSnapshots(input.previous, input.current);
  const conflicts: string[] = [];
  if (
    input.previous.projectId !== input.current.projectId ||
    input.previous.root !== input.current.root ||
    canonicalJson(input.previous.diagnostics) !== canonicalJson(input.current.diagnostics) ||
    reconciliation.added.length ||
    reconciliation.removed.length
  ) {
    conflicts.push('project-identity-changed');
  }
  for (const repo of input.current.repositories) {
    const old = input.previous.repositories.find((entry) => entry.id === repo.id);
    if (
      !old ||
      old.name !== repo.name ||
      old.path !== repo.path ||
      old.remoteIdentity !== repo.remoteIdentity
    )
      conflicts.push(`repository-identity-changed:${repo.id}`);
  }
  const observed = input.observed;
  if (!observed) conflicts.push(input.observationError ?? 'checkout-observation-failed');
  else {
    if (
      observed.isolation !== protocol.strategy.isolationIntent ||
      observed.repositories.length !== protocol.binding.repositories.length ||
      `execution-workspace:${observed.localDigest.slice(-24)}` !== protocol.binding.localOverlayRef
    )
      conflicts.push('checkout-binding-changed');
    for (const repo of observed.repositories) {
      const bound = protocol.binding.repositories.find(
        (entry) => entry.repositoryId === repo.repositoryId,
      );
      if (!bound || repo.branch !== bound.branchRef || repo.worktreeId !== bound.worktreeId)
        conflicts.push(`checkout-identity-changed:${repo.repositoryId}`);
    }
  }
  const stable = {
    phase: lifecycle.phase as 'verify' | 'archive',
    verificationInputDigest: lifecycle.verificationInput.digest,
    bindingId: protocol.binding.bindingId,
    checkpointDigest: protocol.workspaceCheckpoint.digest,
    workId: lifecycle.currentWork?.workId ?? null,
    checkEpoch: lifecycle.checkEpoch,
    currentSnapshotDigest: input.current.digest,
    observedDigest: observed?.stateDigest ?? null,
    conflicts,
  };
  return {
    ...stable,
    expectedStateVersion: input.state.stateVersion,
    observationDigest: evidenceInputDigest(stable).slice(7),
    reconciliation,
  };
}
