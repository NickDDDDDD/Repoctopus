import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  PostMergeDeliveryGitPort,
  PostMergeDeliveryGitPortV2,
  PostMergeGitPublicationInput,
  PostMergeGitPublicationInputV2,
  PostMergeGitPublicationResult,
} from '../../domains/delivery/post-merge.js';
import { assertPostMergeTargetMergeReceipt } from '../../domains/post-merge/checkout.js';
import type {
  PostMergeClosureAudit,
  PostMergeWorkspaceBaseline,
} from '../../domains/post-merge/closure.js';
import type {
  CheckpointResult,
  DeliveryPolicy,
  DeliveryRepositoryFacts,
  DeliveryRepositoryIntent,
  PublicationAction,
} from '../../domains/delivery/types.js';
import type { RepositorySnapshot } from '../../domains/project/types.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
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
  return realpath(path.resolve(worktrees[0]!.path));
}

function contentDigest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

interface ClosureGitInput {
  workspaceRoot: string;
  baseline: PostMergeWorkspaceBaseline;
  audit: PostMergeClosureAudit;
  policy: {
    remote: string;
    commit: { message: string; authorName: string; authorEmail: string };
  };
}

interface ClosureBranchBinding {
  sourceBranch: string;
  targetBranch: string;
  remoteIdentity: string;
  remoteBaseOid: string;
  label: string;
  targetMerge?: {
    sourceOid: string;
    targetOid: string;
  };
}

interface CommitSemantics {
  parents: string[];
  tree: string;
  message: string;
  authorName: string;
  authorEmail: string;
}

function closureAuditSemanticDigest(audit: PostMergeClosureAudit): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(
      canonicalJson({
        schemaVersion: audit.schemaVersion,
        planDigest: audit.planDigest,
        closureId: audit.closureId,
        changedFiles: audit.changedFiles,
        contentDigests: audit.contentDigests,
      }),
    )
    .digest('hex')}`;
}

function expectedClosureMessage(input: ClosureGitInput, binding: ClosureBranchBinding): string {
  const message = input.policy.commit.message.trim();
  return binding.targetMerge
    ? `${message}\n\nRepoctopus-Closure-Audit: ${closureAuditSemanticDigest(input.audit)}`
    : message;
}

async function commitSemantics(cwd: string, commit: string): Promise<CommitSemantics> {
  const parentLine = (await git(cwd, ['rev-list', '--parents', '-n', '1', commit])).split(/\s+/u);
  const [tree, message, authorName, authorEmail] = await Promise.all([
    git(cwd, ['rev-parse', `${commit}^{tree}`]),
    git(cwd, ['show', '-s', '--format=%B', commit]),
    git(cwd, ['show', '-s', '--format=%an', commit]),
    git(cwd, ['show', '-s', '--format=%ae', commit]),
  ]);
  return {
    parents: parentLine.slice(1),
    tree,
    message,
    authorName,
    authorEmail,
  };
}

async function equivalentTargetMergeParent(
  cwd: string,
  remoteParent: string,
  localParent: string,
  targetMerge: NonNullable<ClosureBranchBinding['targetMerge']>,
): Promise<boolean> {
  const [remote, local] = await Promise.all([
    commitSemantics(cwd, remoteParent),
    commitSemantics(cwd, localParent),
  ]);
  const expectedParents = [targetMerge.sourceOid, targetMerge.targetOid];
  return (
    remote.parents.length === 2 &&
    local.parents.length === 2 &&
    remote.parents.every((parent, index) => parent === expectedParents[index]) &&
    local.parents.every((parent, index) => parent === expectedParents[index]) &&
    remote.tree === local.tree &&
    remote.message === local.message &&
    remote.authorName === local.authorName &&
    remote.authorEmail === local.authorEmail
  );
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
  input: ClosureGitInput,
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
  input: ClosureGitInput,
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

async function adoptEquivalentPostMergeCommit(
  cwd: string,
  input: ClosureGitInput,
  binding: ClosureBranchBinding,
  remoteCommit: string,
  expectedTree: string,
  localHead: string,
): Promise<boolean> {
  await git(cwd, [
    'fetch',
    '--no-tags',
    input.policy.remote,
    `refs/heads/${binding.sourceBranch}`,
  ]);
  const fetched = await git(cwd, ['rev-parse', 'FETCH_HEAD']);
  if (fetched !== remoteCommit) {
    throw new Error('Post-merge Change MR remote source drifted during recovery');
  }
  const remote = await commitSemantics(cwd, fetched);
  const parent = remote.parents[0];
  const equivalentParent =
    parent === input.baseline.head ||
    (parent !== undefined &&
      binding.targetMerge !== undefined &&
      (await equivalentTargetMergeParent(
        cwd,
        parent,
        input.baseline.head,
        binding.targetMerge,
      )));
  if (
    remote.parents.length !== 1 ||
    !equivalentParent ||
    remote.tree !== expectedTree ||
    remote.message !== expectedClosureMessage(input, binding) ||
    remote.authorName !== input.policy.commit.authorName.trim() ||
    remote.authorEmail !== input.policy.commit.authorEmail.trim()
  ) {
    return false;
  }
  await git(cwd, ['update-ref', 'HEAD', fetched, localHead]);
  await assertClean(cwd);
  return true;
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

export class GitDeliveryAdapter implements PostMergeDeliveryGitPort, PostMergeDeliveryGitPortV2 {
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
    const publication = await publishCheckpoint(cwd, policy.publication.remote, branch, head);
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
    const cwd = await deliveryWorktree(repository.path, intent.sourceBranch);
    const branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch) throw new Error(`Detached HEAD cannot be delivered: ${repository.id}`);
    if (branch !== intent.sourceBranch)
      throw new Error(
        `Source branch mismatch for ${repository.id}: expected ${intent.sourceBranch}, received ${branch}`,
      );
    const head = await git(cwd, ['rev-parse', 'HEAD']);
    const tree = await git(cwd, ['rev-parse', 'HEAD^{tree}']);
    const status = await git(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
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

  async publishPostMerge(
    input: PostMergeGitPublicationInput,
  ): Promise<PostMergeGitPublicationResult> {
    return this.publishClosureBranch(input, {
      sourceBranch: input.changeMergeRequest.sourceBranch,
      targetBranch: input.changeMergeRequest.targetBranch,
      remoteIdentity: input.changeMergeRequest.remoteIdentity,
      remoteBaseOid: input.baseline.head,
      label: 'post-merge Change MR',
    });
  }

  async publishFinalChange(
    input: PostMergeGitPublicationInputV2,
  ): Promise<PostMergeGitPublicationResult> {
    assertPostMergeTargetMergeReceipt(input.targetMergeReceipt, input.targetMergeIntent);
    if (
      input.targetMergeIntent.changeBranch.repositoryId !== input.changeBranch.repositoryId ||
      input.targetMergeIntent.changeBranch.remoteIdentity !== input.changeBranch.remoteIdentity ||
      input.targetMergeIntent.changeBranch.sourceBranch !== input.changeBranch.sourceBranch ||
      input.targetMergeIntent.changeBranch.targetBranch !== input.changeBranch.targetBranch ||
      input.targetMergeIntent.changeBranch.remoteOid !== input.changeBranch.remoteOid ||
      input.baseline.head !== input.targetMergeReceipt.mergeCommitOid ||
      input.baseline.root !== input.targetMergeReceipt.checkoutPath
    ) {
      throw new Error('Final Change publication is not bound to its target merge Receipt');
    }
    return this.publishClosureBranch(input, {
      sourceBranch: input.changeBranch.sourceBranch,
      targetBranch: input.changeBranch.targetBranch,
      remoteIdentity: input.changeBranch.remoteIdentity,
      remoteBaseOid: input.targetMergeReceipt.sourceOid,
      label: 'final Change branch',
      targetMerge: {
        sourceOid: input.targetMergeReceipt.sourceOid,
        targetOid: input.targetMergeReceipt.targetOid,
      },
    });
  }

  private async publishClosureBranch(
    input: ClosureGitInput,
    binding: ClosureBranchBinding,
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
    await git(cwd, ['check-ref-format', '--branch', binding.sourceBranch]);
    await git(cwd, ['check-ref-format', '--branch', binding.targetBranch]);
    const branch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (branch !== binding.sourceBranch) {
      throw new Error(
        `Post-merge publication source branch drifted: expected ${binding.sourceBranch}, received ${branch}`,
      );
    }
    const configuredRemote = await git(cwd, ['remote', 'get-url', input.policy.remote]);
    if (normalizeRemoteIdentity(configuredRemote) !== binding.remoteIdentity) {
      throw new Error(`Post-merge publication remote does not match the ${binding.label}`);
    }

    const before = await remoteOid(cwd, input.policy.remote, binding.sourceBranch);
    let head = await git(cwd, ['rev-parse', 'HEAD']);
    let commitRecovered = false;
    if (head === input.baseline.head) {
      await git(cwd, ['add', '--all', '--', ...input.audit.changedFiles]);
      await assertPublicationDiff(cwd, input, 'cached');
      const unstaged = await gitRaw(cwd, ['diff', '--name-only', '-z', '--']);
      const untracked = await gitRaw(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
      if (unstaged.length > 0 || untracked.length > 0) {
        throw new Error('Post-merge workspace changed after audited paths were staged');
      }
      const stagedTree = await git(cwd, ['write-tree']);
      if (before !== binding.remoteBaseOid) {
        if (
          before &&
          (await adoptEquivalentPostMergeCommit(
            cwd,
            input,
            binding,
            before,
            stagedTree,
            head,
          ))
        ) {
          return {
            commitOid: before,
            remoteOid: before,
            commitRecovered: true,
            pushRecovered: true,
          };
        }
        throw new Error(`Post-merge ${binding.label} remote source drifted before commit`);
      }
      const commitArguments = [
        '-c',
        `user.name=${input.policy.commit.authorName}`,
        '-c',
        `user.email=${input.policy.commit.authorEmail}`,
        'commit',
        '-m',
        input.policy.commit.message,
      ];
      if (binding.targetMerge) {
        commitArguments.push(
          '-m',
          `Repoctopus-Closure-Audit: ${closureAuditSemanticDigest(input.audit)}`,
        );
      }
      await git(cwd, commitArguments);
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
        message !== expectedClosureMessage(input, binding) ||
        authorName !== input.policy.commit.authorName.trim() ||
        authorEmail !== input.policy.commit.authorEmail.trim()
      ) {
        throw new Error('Local HEAD is not the recoverable post-merge closure commit');
      }
      await assertPublicationDiff(cwd, input, 'committed');
      await assertClean(cwd);
      commitRecovered = true;
    }

    const remoteBeforePush = await remoteOid(cwd, input.policy.remote, binding.sourceBranch);
    let pushRecovered = remoteBeforePush === head;
    if (!pushRecovered) {
      if (remoteBeforePush !== binding.remoteBaseOid) {
        const expectedTree = await git(cwd, ['rev-parse', 'HEAD^{tree}']);
        if (
          remoteBeforePush &&
          (await adoptEquivalentPostMergeCommit(
            cwd,
            input,
            binding,
            remoteBeforePush,
            expectedTree,
            head,
          ))
        ) {
          return {
            commitOid: remoteBeforePush,
            remoteOid: remoteBeforePush,
            commitRecovered: true,
            pushRecovered: true,
          };
        }
        throw new Error(`Post-merge ${binding.label} remote source drifted before push`);
      }
      try {
        await git(cwd, [
          'push',
          input.policy.remote,
          `${binding.sourceBranch}:refs/heads/${binding.sourceBranch}`,
        ]);
      } catch (error) {
        const raced = await remoteOid(cwd, input.policy.remote, binding.sourceBranch);
        const expectedTree = await git(cwd, ['rev-parse', 'HEAD^{tree}']);
        if (
          raced &&
          raced !== binding.remoteBaseOid &&
          (await adoptEquivalentPostMergeCommit(
            cwd,
            input,
            binding,
            raced,
            expectedTree,
            head,
          ))
        ) {
          return {
            commitOid: raced,
            remoteOid: raced,
            commitRecovered: true,
            pushRecovered: true,
          };
        }
        throw error;
      }
    }
    const published = await remoteOid(cwd, input.policy.remote, binding.sourceBranch);
    if (published !== head) {
      throw new Error(`Post-merge ${binding.label} push could not be verified`);
    }
    pushRecovered ||= before === head;
    return { commitOid: head, remoteOid: published, commitRecovered, pushRecovered };
  }
}
