import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';

import type {
  PostMergeDeliveryGitPort,
  PostMergeGitPublicationInput,
  PostMergeGitPublicationResult,
} from '../../domains/delivery/post-merge.js';
import type {
  CheckpointResult,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliveryRepositoryIntent,
  PublicationAction,
} from '../../domains/delivery/types.js';
import type { RepositorySnapshot } from '../../domains/project/types.js';
import { execute } from '../process/execute.js';
import { normalizeRemoteIdentity } from './remote-identity.js';

function globPattern(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`);
}

function protectedBranch(branch: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globPattern(pattern).test(branch));
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout;
}

function contentDigest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function parsedChangedPaths(output: string): string[] {
  const tokens = output.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++]!;
    if (status.startsWith('R') || status.startsWith('C')) {
      const previous = tokens[index++];
      const current = tokens[index++];
      if (!previous || !current) throw new Error('Git returned an incomplete rename record');
      paths.push(previous, current);
      continue;
    }
    const file = tokens[index++];
    if (!file) throw new Error('Git returned an incomplete path change record');
    if (!['A', 'M', 'D', 'T'].includes(status[0]!)) {
      throw new Error(`Git returned an unsupported post-merge path status: ${status}`);
    }
    paths.push(file);
  }
  return [...new Set(paths)].sort();
}

function equalPaths(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

async function treeContains(cwd: string, treeish: string, file: string): Promise<boolean> {
  if (treeish === ':') return (await git(cwd, ['ls-files', '--stage', '--', file])).length > 0;
  return (await git(cwd, ['ls-tree', treeish, '--', file])).length > 0;
}

async function assertPublicationContent(
  cwd: string,
  input: PostMergeGitPublicationInput,
  treeish: ':' | 'HEAD',
): Promise<void> {
  for (const file of input.audit.changedFiles) {
    const source = (await treeContains(cwd, treeish, file))
      ? treeish === ':'
        ? `:${file}`
        : `HEAD:${file}`
      : `${input.baseline.head}:${file}`;
    const actual = contentDigest(await gitRaw(cwd, ['show', source]));
    if (actual !== input.audit.contentDigests[file]) {
      throw new Error(`Post-merge content drifted after path audit: ${file}`);
    }
  }
}

async function assertPublicationDiff(
  cwd: string,
  input: PostMergeGitPublicationInput,
  mode: 'cached' | 'committed',
): Promise<void> {
  const args =
    mode === 'cached'
      ? ['diff', '--cached', '--name-status', '-z', '--find-renames', input.baseline.head, '--']
      : ['diff', '--name-status', '-z', '--find-renames', input.baseline.head, 'HEAD', '--'];
  const actual = parsedChangedPaths(await gitRaw(cwd, args));
  if (!equalPaths(actual, input.audit.changedFiles)) {
    throw new Error('Post-merge staged paths do not match the audited closure paths');
  }
  await assertPublicationContent(cwd, input, mode === 'cached' ? ':' : 'HEAD');
}

async function assertClean(cwd: string): Promise<void> {
  const status = await gitRaw(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
  if (status.length > 0) throw new Error('Post-merge workspace drifted during publication');
}

async function remoteOid(cwd: string, remote: string, branch: string): Promise<string | null> {
  const output = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  const [oid] = output.split(/\s+/);
  return oid || null;
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

export class GitDeliveryAdapter implements PostMergeDeliveryGitPort {
  async checkpoint(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<CheckpointResult> {
    if (!policy.checkpoint.automatic) throw new Error('Automatic checkpoint commits are disabled');
    const branch = await git(repository.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be checkpointed: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    if (protectedBranch(branch, policy.checkpoint.protectedBranches))
      throw new Error(`Protected branch cannot be checkpointed: ${branch}`);
    const messagePattern = new RegExp(policy.checkpoint.commitMessagePattern);
    if (!messagePattern.test(intent.commitMessage))
      throw new Error(`Commit message does not match policy for ${repository.id}`);
    const checks = [
      ...(policy.checkpoint.quickChecks['*'] ?? []),
      ...(policy.checkpoint.quickChecks[repository.id] ?? []),
    ];
    const results: CheckpointResult['checks'] = [];
    for (const check of checks) {
      await execute(check.command, check.args, { cwd: repository.path });
      results.push({ command: check.command, passed: true });
    }
    const status = await git(repository.path, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]);
    const created = status.length > 0;
    if (created) {
      await git(repository.path, ['add', '--all']);
      await git(repository.path, ['commit', '-m', intent.commitMessage]);
    }
    const head = await git(repository.path, ['rev-parse', 'HEAD']);
    const publication = await publishCheckpoint(
      repository.path,
      policy.publication.remote,
      branch,
      head,
    );
    return {
      repositoryId: repository.id,
      created,
      head,
      checks: results,
      publication,
    };
  }

  async inspect(
    repository: RepositorySnapshot,
    intent: DeliveryRepositoryIntent,
    policy: DeliveryPolicy,
  ): Promise<DeliveryRepositoryFacts> {
    const branch = await git(repository.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be delivered: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    const head = await git(repository.path, ['rev-parse', 'HEAD']);
    const tree = await git(repository.path, ['rev-parse', 'HEAD^{tree}']);
    const status = await git(repository.path, [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
    ]);
    const remoteSourceOid = await remoteOid(
      repository.path,
      policy.publication.remote,
      intent.sourceBranch,
    );
    const remoteTargetOid = await remoteOid(
      repository.path,
      policy.publication.remote,
      intent.targetBranch,
    );
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
      clean: status.length === 0,
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
    if (facts.head !== action.expectedHead)
      throw new Error(`Local HEAD drifted for ${repository.id}`);
    if (facts.remoteTargetOid !== action.expectedRemoteTargetOid)
      throw new Error(`Remote target drifted for ${repository.id}`);
    if (facts.remoteSourceOid !== action.expectedRemoteSourceOid) {
      if (facts.remoteSourceOid === facts.head) return facts.head;
      throw new Error(`Remote source drifted for ${repository.id}`);
    }
    if (facts.remoteSourceOid === facts.head) return facts.head;
    await git(repository.path, [
      'push',
      policy.publication.remote,
      `${action.sourceBranch}:refs/heads/${action.sourceBranch}`,
    ]);
    const published = await remoteOid(
      repository.path,
      policy.publication.remote,
      action.sourceBranch,
    );
    if (published !== facts.head)
      throw new Error(`Remote source verification failed for ${repository.id}`);
    return published;
  }

  async publishPostMerge(
    input: PostMergeGitPublicationInput,
  ): Promise<PostMergeGitPublicationResult> {
    const cwd = await realpath(input.workspaceRoot);
    const repositoryRoot = await realpath(await git(cwd, ['rev-parse', '--show-toplevel']));
    const baselineRoot = await realpath(input.baseline.root);
    if (
      cwd.toLowerCase() !== repositoryRoot.toLowerCase() ||
      cwd.toLowerCase() !== baselineRoot.toLowerCase()
    ) {
      throw new Error('Post-merge publication workspace does not match its audited Git root');
    }
    await git(cwd, ['check-ref-format', '--branch', input.coordination.sourceBranch]);
    await git(cwd, ['check-ref-format', '--branch', input.coordination.targetBranch]);
    const branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (branch !== input.coordination.sourceBranch) {
      throw new Error(
        `Post-merge publication source branch drifted: expected ${input.coordination.sourceBranch}, received ${branch}`,
      );
    }
    const configuredRemote = await git(cwd, ['remote', 'get-url', input.policy.remote]);
    if (normalizeRemoteIdentity(configuredRemote) !== input.coordination.remoteIdentity) {
      throw new Error('Post-merge publication remote does not match the coordination MR');
    }

    const before = await remoteOid(cwd, input.policy.remote, input.coordination.sourceBranch);
    let head = await git(cwd, ['rev-parse', 'HEAD']);
    let commitRecovered = false;
    if (head === input.baseline.head) {
      if (before !== input.baseline.head) {
        throw new Error('Post-merge coordination remote source drifted before commit');
      }
      await git(cwd, ['add', '--all', '--', ...input.audit.changedFiles]);
      await assertPublicationDiff(cwd, input, 'cached');
      const unstaged = await gitRaw(cwd, ['diff', '--name-only', '-z', '--']);
      const untracked = await gitRaw(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
      if (unstaged.length > 0 || untracked.length > 0) {
        throw new Error('Post-merge workspace changed after audited paths were staged');
      }
      await git(cwd, [
        '-c',
        `user.name=${input.policy.commit.authorName}`,
        '-c',
        `user.email=${input.policy.commit.authorEmail}`,
        'commit',
        '-m',
        input.policy.commit.message,
      ]);
      head = await git(cwd, ['rev-parse', 'HEAD']);
      await assertPublicationDiff(cwd, input, 'committed');
      await assertClean(cwd);
    } else {
      const parents = (await git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(/\s+/u);
      const [message, authorName, authorEmail] = await Promise.all([
        git(cwd, ['show', '-s', '--format=%B', 'HEAD']),
        git(cwd, ['show', '-s', '--format=%an', 'HEAD']),
        git(cwd, ['show', '-s', '--format=%ae', 'HEAD']),
      ]);
      if (
        parents.length !== 2 ||
        parents[1] !== input.baseline.head ||
        message !== input.policy.commit.message.trim() ||
        authorName !== input.policy.commit.authorName.trim() ||
        authorEmail !== input.policy.commit.authorEmail.trim()
      ) {
        throw new Error('Local HEAD is not the recoverable post-merge closure commit');
      }
      await assertPublicationDiff(cwd, input, 'committed');
      await assertClean(cwd);
      commitRecovered = true;
    }

    const remoteBeforePush = await remoteOid(
      cwd,
      input.policy.remote,
      input.coordination.sourceBranch,
    );
    let pushRecovered = remoteBeforePush === head;
    if (!pushRecovered) {
      if (remoteBeforePush !== input.baseline.head) {
        throw new Error('Post-merge coordination remote source drifted before push');
      }
      await git(cwd, [
        'push',
        input.policy.remote,
        `${input.coordination.sourceBranch}:refs/heads/${input.coordination.sourceBranch}`,
      ]);
    }
    const published = await remoteOid(cwd, input.policy.remote, input.coordination.sourceBranch);
    if (published !== head) {
      throw new Error('Post-merge coordination push could not be verified');
    }
    pushRecovered ||= before === head;
    return { commitOid: head, remoteOid: published, commitRecovered, pushRecovered };
  }
}
