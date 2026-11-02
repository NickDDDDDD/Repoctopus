import path from 'node:path';

import type {
  CheckpointResult,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliveryRepositoryIntent,
  PublicationAction,
} from '../../domains/delivery/types.js';
import type { RepositorySnapshot } from '../../domains/project/types.js';
import { isProtectedBranch } from '../../domains/delivery/branch-policy.js';
import { execute } from '../process/execute.js';

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

interface GitWorktree {
  path: string;
  branch: string | null;
}

function parseGitWorktrees(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: GitWorktree | null = null;
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length), branch: null };
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

async function deliveryWorktree(repositoryPath: string, sourceBranch: string): Promise<string> {
  await git(repositoryPath, ['check-ref-format', '--branch', sourceBranch]);
  const worktrees = parseGitWorktrees(
    await git(repositoryPath, ['worktree', 'list', '--porcelain']),
  ).filter((worktree) => worktree.branch === sourceBranch);
  if (worktrees.length !== 1) {
    throw new Error(
      worktrees.length === 0
        ? `Source branch requires a checked-out Git worktree: ${sourceBranch}`
        : `Source branch has ambiguous Git worktrees: ${sourceBranch}`,
    );
  }
  return path.resolve(worktrees[0]!.path);
}

async function remoteOid(cwd: string, remote: string, branch: string): Promise<string | null> {
  const output = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  const [oid] = output.split(/\s+/u);
  return oid || null;
}

function normalizeRepositoryPath(value: string): string {
  const slashPath = value.replaceAll('\\', '/');
  const candidate = slashPath.startsWith('./') ? slashPath.slice(2) : slashPath;
  const normalized = path.posix.normalize(candidate);
  if (
    !candidate ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    normalized !== candidate ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Archive cleanliness scope contains an invalid repository path: ${value}`);
  }
  return normalized;
}

function nulPaths(output: string): string[] {
  return output.split('\0').filter(Boolean).map(normalizeRepositoryPath);
}

async function worktreeChangedPaths(cwd: string): Promise<string[]> {
  const [unstaged, staged, untracked] = await Promise.all([
    execute('git', ['diff', '--name-only', '-z'], { cwd }).then((result) => result.stdout),
    execute('git', ['diff', '--cached', '--name-only', '-z'], { cwd }).then(
      (result) => result.stdout,
    ),
    execute('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd }).then(
      (result) => result.stdout,
    ),
  ]);
  return [...new Set([...nulPaths(unstaged), ...nulPaths(staged), ...nulPaths(untracked)])].sort();
}

async function publishCheckpoint(
  cwd: string,
  remote: string,
  branch: string,
  expectedHead: string,
): Promise<CheckpointResult['publication']> {
  await git(cwd, ['push', '--set-upstream', remote, `${branch}:refs/heads/${branch}`]);
  const published = await remoteOid(cwd, remote, branch);
  if (published !== expectedHead)
    throw new Error(`Checkpoint remote verification failed for ${branch}`);
  const upstream = await git(cwd, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  const expectedUpstream = `${remote}/${branch}`;
  if (upstream !== expectedUpstream)
    throw new Error(
      `Checkpoint upstream verification failed for ${branch}: expected ${expectedUpstream}, received ${upstream}`,
    );
  return { remote, branch, remoteOid: published, upstream };
}

export class GitDeliveryAdapter {
  async checkpoint(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<CheckpointResult> {
    if (!policy.checkpoint.automatic) throw new Error('Automatic checkpoint commits are disabled');
    const cwd = await deliveryWorktree(repository.path, intent.sourceBranch);
    const branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be checkpointed: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    if (isProtectedBranch(branch, policy.checkpoint.protectedBranches))
      throw new Error(`Protected branch cannot be checkpointed: ${branch}`);
    if (!new RegExp(policy.checkpoint.commitMessagePattern).test(intent.commitMessage))
      throw new Error(`Commit message does not match policy for ${repository.id}`);
    const checks = [
      ...(policy.checkpoint.quickChecks['*'] ?? []),
      ...(policy.checkpoint.quickChecks[repository.id] ?? []),
    ];
    const results: CheckpointResult['checks'] = [];
    for (const check of checks) {
      await execute(check.command, check.args, { cwd });
      results.push({ command: check.command, passed: true });
    }
    const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
    const created = status.length > 0;
    if (created) {
      await git(cwd, ['add', '--all']);
      await git(cwd, ['commit', '-m', intent.commitMessage]);
    }
    const head = await git(cwd, ['rev-parse', 'HEAD']);
    return {
      repositoryId: repository.id,
      created,
      head,
      checks: results,
      publication: await publishCheckpoint(cwd, policy.publication.remote, branch, head),
    };
  }

  async inspect(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<DeliveryRepositoryFacts> {
    const cwd = await deliveryWorktree(repository.path, intent.sourceBranch);
    const branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be delivered: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    const head = await git(cwd, ['rev-parse', 'HEAD']);
    const tree = await git(cwd, ['rev-parse', 'HEAD^{tree}']);
    const changedPaths = await worktreeChangedPaths(cwd);
    const remoteSourceOid = await remoteOid(cwd, policy.publication.remote, intent.sourceBranch);
    const remoteTargetOid = await remoteOid(cwd, policy.publication.remote, intent.targetBranch);
    if (!remoteTargetOid)
      throw new Error(
        `Remote target branch is missing for ${repository.id}: ${intent.targetBranch}`,
      );
    return {
      repositoryId: repository.id,
      repositoryName: repository.name,
      remoteIdentity: repository.remoteIdentity,
      sourceBranch: branch,
      targetBranch: intent.targetBranch,
      head,
      tree,
      remoteSourceOid,
      remoteTargetOid,
      clean: changedPaths.length === 0,
    };
  }

  async push(
    repository: RepositorySnapshot,
    action: PublicationAction,
    policy: DeliveryPolicy,
  ): Promise<string> {
    if (action.type !== 'git.push') throw new Error(`Unsupported Git action: ${action.type}`);
    const intent: DeliveryRepositoryIntent = {
      repositoryId: action.repositoryId,
      sourceBranch: action.sourceBranch,
      targetBranch: action.targetBranch,
      commitMessage: 'not-used',
      actions: ['push'],
    };
    const facts = await this.inspect(repository, intent, policy);
    const cwd = await deliveryWorktree(repository.path, intent.sourceBranch);
    if (facts.head !== action.expectedHead)
      throw new Error(`Local HEAD drifted for ${repository.id}`);
    if (facts.remoteTargetOid !== action.expectedRemoteTargetOid)
      throw new Error(`Remote target drifted for ${repository.id}`);
    if (facts.remoteSourceOid !== action.expectedRemoteSourceOid) {
      if (facts.remoteSourceOid === facts.head) return facts.head;
      throw new Error(`Remote source drifted for ${repository.id}`);
    }
    if (facts.remoteSourceOid === facts.head) return facts.head;
    await git(cwd, [
      'push',
      policy.publication.remote,
      `${action.sourceBranch}:refs/heads/${action.sourceBranch}`,
    ]);
    const published = await remoteOid(cwd, policy.publication.remote, action.sourceBranch);
    if (published !== facts.head)
      throw new Error(`Remote source verification failed for ${repository.id}`);
    return published;
  }
}
