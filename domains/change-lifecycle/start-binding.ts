import { createHash } from 'node:crypto';

import type { ProjectSnapshot, TargetBranchSnapshot } from '../project/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export const CHANGE_START_BINDING_ERROR_CODES = [
  'workspace-repository-missing',
  'source-branch-detached',
  'source-target-equal',
  'remote-identity-mismatch',
  'repository-topology-mismatch',
] as const;

export type ChangeStartBindingErrorCode = (typeof CHANGE_START_BINDING_ERROR_CODES)[number];

export class ChangeStartBindingError extends Error {
  readonly code: `runtime.workspace-binding.${ChangeStartBindingErrorCode}`;

  constructor(reason: ChangeStartBindingErrorCode) {
    super(`Change start workspace binding is invalid: ${reason}`);
    this.name = 'ChangeStartBindingError';
    this.code = `runtime.workspace-binding.${reason}`;
  }
}

export interface ChangeStartBinding {
  schemaVersion: 1;
  workspaceRepositoryId: string;
  sourceRemoteIdentity: string;
  sourceBranch: string;
  targetRemoteIdentity: string;
  targetBranch: string;
  topologyIdentity: `sha256:${string}`;
  digest: `sha256:${string}`;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function createChangeStartBinding(input: {
  projectSnapshot: ProjectSnapshot;
  workspaceRepositoryId: string;
  targetBranch: TargetBranchSnapshot;
}): ChangeStartBinding {
  const workspaceRepository = input.projectSnapshot.repositories.find(
    (repository) => repository.id === input.workspaceRepositoryId,
  );
  if (!workspaceRepository || input.targetBranch.repositoryId !== input.workspaceRepositoryId) {
    throw new ChangeStartBindingError('workspace-repository-missing');
  }
  const sourceBranch = workspaceRepository.branch?.trim();
  if (!sourceBranch) throw new ChangeStartBindingError('source-branch-detached');
  const targetBranch = input.targetBranch.targetBranch.trim();
  if (sourceBranch === targetBranch) throw new ChangeStartBindingError('source-target-equal');

  const sourceRemoteIdentity = workspaceRepository.remoteIdentity?.trim();
  const targetRemoteIdentity = input.targetBranch.remoteIdentity.trim();
  const targetMatchesWorkspace =
    targetRemoteIdentity === sourceRemoteIdentity ||
    targetRemoteIdentity === input.workspaceRepositoryId;
  if (!sourceRemoteIdentity || !targetRemoteIdentity || !targetMatchesWorkspace) {
    throw new ChangeStartBindingError('remote-identity-mismatch');
  }

  const topology = input.projectSnapshot.repositories
    .map((repository) => ({
      repositoryId: repository.id.trim(),
      remoteIdentity: repository.remoteIdentity?.trim() ?? null,
    }))
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  if (
    topology.some((repository) => !repository.repositoryId || !repository.remoteIdentity) ||
    new Set(topology.map((repository) => repository.repositoryId)).size !== topology.length
  ) {
    throw new ChangeStartBindingError('repository-topology-mismatch');
  }
  const topologyIdentity = digest({ schemaVersion: 1, repositories: topology });
  const stable = {
    schemaVersion: 1 as const,
    workspaceRepositoryId: input.workspaceRepositoryId,
    sourceRemoteIdentity,
    sourceBranch,
    targetRemoteIdentity,
    targetBranch,
    topologyIdentity,
  };
  return { ...stable, digest: digest(stable) };
}
