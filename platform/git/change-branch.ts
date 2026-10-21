import type { ChangeBranchReference } from '../../domains/specification/types.js';
import { execute } from '../process/execute.js';
import { normalizeRemoteIdentity } from './remote-identity.js';

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function remoteOid(cwd: string, remote: string, branch: string): Promise<string | null> {
  const output = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  const [oid] = output.split(/\s+/u);
  return oid || null;
}

export async function inspectPublishedChangeBranch(input: {
  repositoryPath: string;
  repositoryId: string;
  remote: string;
  sourceBranch: string;
  targetBranch: string;
}): Promise<ChangeBranchReference> {
  const published = await inspectRemoteChangeBranch(input);
  const [currentBranch, localOid, worktreeStatus] = await Promise.all([
    git(input.repositoryPath, ['branch', '--show-current']),
    git(input.repositoryPath, ['rev-parse', 'HEAD']),
    git(input.repositoryPath, ['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  if (currentBranch !== input.sourceBranch) {
    throw new Error(
      `Specification workspace must be checked out at Change branch: ${input.sourceBranch}`,
    );
  }
  if (localOid !== published.remoteOid) {
    throw new Error(
      `Change branch is not synchronized with ${input.remote}: ${input.sourceBranch}`,
    );
  }
  if (worktreeStatus) {
    throw new Error('Specification workspace must be clean before planning approval');
  }
  return published;
}

export async function inspectRemoteChangeBranch(input: {
  repositoryPath: string;
  repositoryId: string;
  remote: string;
  sourceBranch: string;
  targetBranch: string;
}): Promise<ChangeBranchReference> {
  if (!input.repositoryId.trim()) throw new Error('Workspace Repository ID is required');
  await Promise.all([
    git(input.repositoryPath, ['check-ref-format', '--branch', input.sourceBranch]),
    git(input.repositoryPath, ['check-ref-format', '--branch', input.targetBranch]),
  ]);
  if (input.sourceBranch === input.targetBranch) {
    throw new Error('Change branch source and target branches must differ');
  }
  const remoteUrl = await git(input.repositoryPath, ['remote', 'get-url', input.remote]);
  const [sourceOid, targetOid] = await Promise.all([
    remoteOid(input.repositoryPath, input.remote, input.sourceBranch),
    remoteOid(input.repositoryPath, input.remote, input.targetBranch),
  ]);
  if (!sourceOid) throw new Error(`Change branch is not published: ${input.sourceBranch}`);
  if (!targetOid) throw new Error(`Change target branch is not published: ${input.targetBranch}`);
  return {
    repositoryId: input.repositoryId,
    remoteIdentity: normalizeRemoteIdentity(remoteUrl),
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    remoteOid: sourceOid,
  };
}
