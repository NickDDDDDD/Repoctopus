import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  PostMergeChangeBranchCheckoutPort,
  PostMergeCheckoutManifest,
  PostMergeCheckoutPort,
  PostMergeRepositorySource,
  PostMergeTargetMergeIntent,
  PostMergeTargetMergeReceipt,
} from '../../domains/post-merge/checkout.js';
import {
  assertPostMergeTargetMergeIntent,
  assertPostMergeTargetMergeReceipt,
  createPostMergeCheckoutManifest,
  createPostMergeTargetMergeIntent,
  createPostMergeTargetMergeReceipt,
} from '../../domains/post-merge/checkout.js';
import type { PostMergeRepositoryFact } from '../../domains/post-merge/coordinator.js';
import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { execute } from '../process/execute.js';
import { normalizeRemoteIdentity } from './remote-identity.js';

const MARKER = '.repoctopus-post-merge-checkout.json';

interface CheckoutMarker {
  schemaVersion: 1;
  runId: string;
  mergeFactsDigest: `sha256:${string}`;
}

export class PostMergeCheckoutError extends Error {
  constructor(
    readonly code:
      | 'invalid-input'
      | 'source-mismatch'
      | 'checkout-conflict'
      | 'commit-unavailable'
      | 'checkout-drift'
      | 'change-branch-drift'
      | 'target-branch-drift'
      | 'target-merge-conflict'
      | 'target-merge-invalid'
      | 'cleanup-refused',
    readonly repositoryId?: string,
  ) {
    super(
      repositoryId
        ? `Post-merge checkout failed: ${code} (${repositoryId})`
        : `Post-merge checkout failed: ${code}`,
    );
    this.name = 'PostMergeCheckoutError';
  }
}

function inside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function repositoryDirectory(repositoryId: string): string {
  return createHash('sha256').update(repositoryId).digest('hex').slice(0, 24);
}

export function postMergeCheckoutDirectory(runId: string): string {
  return `run-${createHash('sha256')
    .update(['post-merge-checkout/v1', runId].join('\0'))
    .digest('hex')
    .slice(0, 24)}`;
}

function assertInputs(
  repositories: readonly PostMergeRepositoryFact[],
  sources: readonly PostMergeRepositorySource[],
): Map<string, PostMergeRepositorySource> {
  const repositoryIds = repositories.map((item) => item.repositoryId);
  const sourceIds = sources.map((item) => item.repositoryId);
  if (
    repositories.length === 0 ||
    new Set(repositoryIds).size !== repositoryIds.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    repositoryIds.some((repositoryId) => !sourceIds.includes(repositoryId))
  ) {
    throw new PostMergeCheckoutError('invalid-input');
  }
  return new Map(sources.map((source) => [source.repositoryId, source]));
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execute('git', args, { cwd })).stdout.trim();
}

async function remoteBranchOid(
  cwd: string,
  remote: string,
  branch: string,
): Promise<string | null> {
  const output = await git(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  const [oid] = output.split(/\s+/u);
  return oid || null;
}

async function assertSource(
  repository: PostMergeRepositoryFact,
  source: PostMergeRepositorySource,
): Promise<string> {
  try {
    const remote = await git(path.resolve(source.path), ['remote', 'get-url', 'origin']);
    if (normalizeRemoteIdentity(remote) !== repository.remoteIdentity) {
      throw new PostMergeCheckoutError('source-mismatch', repository.repositoryId);
    }
    return remote;
  } catch (error) {
    if (error instanceof PostMergeCheckoutError) throw error;
    throw new PostMergeCheckoutError('source-mismatch', repository.repositoryId);
  }
}

async function readMarker(runRoot: string): Promise<CheckoutMarker> {
  try {
    const value = JSON.parse(await readFile(path.join(runRoot, MARKER), 'utf8')) as CheckoutMarker;
    if (
      value.schemaVersion !== 1 ||
      typeof value.runId !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(value.mergeFactsDigest)
    ) {
      throw new Error('invalid marker');
    }
    return value;
  } catch {
    throw new PostMergeCheckoutError('checkout-conflict');
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertManagedRunRoot(
  temporaryRoot: string,
  runRoot: string,
  marker: CheckoutMarker,
): Promise<void> {
  const [resolvedTemporaryRoot, information, currentMarker] = await Promise.all([
    realpath(temporaryRoot),
    lstat(runRoot),
    readMarker(runRoot),
  ]);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new PostMergeCheckoutError('checkout-conflict');
  }
  const resolvedRunRoot = await realpath(runRoot);
  if (
    !inside(resolvedTemporaryRoot, resolvedRunRoot) ||
    currentMarker.runId !== marker.runId ||
    currentMarker.mergeFactsDigest !== marker.mergeFactsDigest
  ) {
    throw new PostMergeCheckoutError('checkout-conflict');
  }
}

async function verifyRepository(
  repository: PostMergeRepositoryFact,
  repositoryRoot: string,
): Promise<{ tree: string }> {
  try {
    const [head, tree, remote, status] = await Promise.all([
      git(repositoryRoot, ['rev-parse', 'HEAD']),
      git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']),
      git(repositoryRoot, ['remote', 'get-url', 'origin']),
      git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    ]);
    if (
      head.toLowerCase() !== repository.mergeCommit.toLowerCase() ||
      normalizeRemoteIdentity(remote) !== repository.remoteIdentity ||
      status.length > 0
    ) {
      throw new PostMergeCheckoutError('checkout-drift', repository.repositoryId);
    }
    return { tree };
  } catch (error) {
    if (error instanceof PostMergeCheckoutError) throw error;
    throw new PostMergeCheckoutError('checkout-drift', repository.repositoryId);
  }
}

export interface GitPostMergeCheckoutHooks {
  afterTargetMergeCreated?(receipt: PostMergeTargetMergeReceipt): Promise<void> | void;
}

export class GitPostMergeCheckout
  implements PostMergeCheckoutPort, PostMergeChangeBranchCheckoutPort
{
  constructor(private readonly hooks: GitPostMergeCheckoutHooks = {}) {}

  async checkout(input: {
    runId: string;
    mergeFactsDigest: `sha256:${string}`;
    temporaryRoot: string;
    repositories: PostMergeRepositoryFact[];
    sources: PostMergeRepositorySource[];
    signal?: AbortSignal;
  }): Promise<PostMergeCheckoutManifest> {
    if (input.signal?.aborted) throw input.signal.reason;
    const sources = assertInputs(input.repositories, input.sources);
    const temporaryRoot = path.resolve(input.temporaryRoot);
    await mkdir(temporaryRoot, { recursive: true });
    const resolvedTemporaryRoot = await realpath(temporaryRoot);
    // Git creates deeply nested object and pack paths. A bounded physical directory keeps the
    // checkout portable on Windows while the marker below retains the complete logical Run id.
    const runRoot = path.join(resolvedTemporaryRoot, postMergeCheckoutDirectory(input.runId));
    if (!inside(resolvedTemporaryRoot, runRoot)) throw new PostMergeCheckoutError('invalid-input');
    const marker: CheckoutMarker = {
      schemaVersion: 1,
      runId: input.runId,
      mergeFactsDigest: input.mergeFactsDigest,
    };
    try {
      try {
        await mkdir(runRoot);
        await atomicWriteJson(path.join(runRoot, MARKER), marker);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await assertManagedRunRoot(resolvedTemporaryRoot, runRoot, marker);
      }

      const checkedOut = [];
      for (const repository of [...input.repositories].sort((left, right) =>
        left.repositoryId.localeCompare(right.repositoryId),
      )) {
        if (input.signal?.aborted) throw input.signal.reason;
        const source = sources.get(repository.repositoryId)!;
        const remote = await assertSource(repository, source);
        const repositoryRoot = path.join(runRoot, repositoryDirectory(repository.repositoryId));
        try {
          await lstat(repositoryRoot);
          const verified = await verifyRepository(repository, repositoryRoot);
          checkedOut.push({ ...repository, path: repositoryRoot, tree: verified.tree });
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        try {
          await execute('git', [
            'clone',
            '--no-checkout',
            '--origin',
            'origin',
            remote,
            repositoryRoot,
          ]);
          await execute('git', ['fetch', '--no-tags', 'origin', repository.targetBranch], {
            cwd: repositoryRoot,
          });
          const available = await execute(
            'git',
            ['cat-file', '-e', `${repository.mergeCommit}^{commit}`],
            { cwd: repositoryRoot, allowFailure: true },
          );
          if (available.stderr.trim()) {
            throw new PostMergeCheckoutError('commit-unavailable', repository.repositoryId);
          }
          await execute('git', ['checkout', '--detach', repository.mergeCommit], {
            cwd: repositoryRoot,
          });
        } catch (error) {
          if (error instanceof PostMergeCheckoutError) throw error;
          throw new PostMergeCheckoutError('commit-unavailable', repository.repositoryId);
        }
        const verified = await verifyRepository(repository, repositoryRoot);
        checkedOut.push({ ...repository, path: repositoryRoot, tree: verified.tree });
      }
      return createPostMergeCheckoutManifest({
        schemaVersion: 1,
        runId: input.runId,
        mergeFactsDigest: input.mergeFactsDigest,
        root: runRoot,
        repositories: checkedOut,
      });
    } catch (error) {
      await this.cleanupRoot(resolvedTemporaryRoot, runRoot, marker).catch(() => {});
      throw error;
    }
  }

  async verify(manifest: PostMergeCheckoutManifest, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    await assertManagedRunRoot(path.dirname(manifest.root), manifest.root, {
      schemaVersion: 1,
      runId: manifest.runId,
      mergeFactsDigest: manifest.mergeFactsDigest,
    });
    for (const repository of manifest.repositories) {
      await verifyRepository(repository, repository.path);
    }
    const current = createPostMergeCheckoutManifest({
      schemaVersion: 1,
      runId: manifest.runId,
      mergeFactsDigest: manifest.mergeFactsDigest,
      root: manifest.root,
      repositories: manifest.repositories,
    });
    if (current.digest !== manifest.digest) throw new PostMergeCheckoutError('checkout-drift');
  }

  async cleanup(manifest: PostMergeCheckoutManifest): Promise<void> {
    await this.cleanupRoot(path.dirname(manifest.root), manifest.root, {
      schemaVersion: 1,
      runId: manifest.runId,
      mergeFactsDigest: manifest.mergeFactsDigest,
    });
  }

  async prepareTargetMerge(input: {
    runId: string;
    mergeFactsDigest: `sha256:${string}`;
    remote: string;
    changeBranch: PostMergeTargetMergeIntent['changeBranch'];
    source: PostMergeRepositorySource;
  }): Promise<PostMergeTargetMergeIntent> {
    if (
      input.source.repositoryId !== input.changeBranch.repositoryId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(input.remote)
    ) {
      throw new PostMergeCheckoutError('invalid-input', input.changeBranch.repositoryId);
    }
    const sourceRoot = path.resolve(input.source.path);
    const remoteUrl = await git(sourceRoot, ['remote', 'get-url', input.remote]);
    if (normalizeRemoteIdentity(remoteUrl) !== input.changeBranch.remoteIdentity) {
      throw new PostMergeCheckoutError('source-mismatch', input.changeBranch.repositoryId);
    }
    const [sourceOid, targetOid] = await Promise.all([
      remoteBranchOid(sourceRoot, input.remote, input.changeBranch.sourceBranch),
      remoteBranchOid(sourceRoot, input.remote, input.changeBranch.targetBranch),
    ]);
    if (sourceOid !== input.changeBranch.remoteOid) {
      throw new PostMergeCheckoutError('change-branch-drift', input.changeBranch.repositoryId);
    }
    if (!targetOid) {
      throw new PostMergeCheckoutError('target-branch-drift', input.changeBranch.repositoryId);
    }
    return createPostMergeTargetMergeIntent({
      schemaVersion: 1,
      runId: input.runId,
      mergeFactsDigest: input.mergeFactsDigest,
      remote: input.remote,
      changeBranch: input.changeBranch,
      targetOid,
    });
  }

  async mergeTarget(input: {
    temporaryRoot: string;
    source: PostMergeRepositorySource;
    intent: PostMergeTargetMergeIntent;
    signal?: AbortSignal;
  }): Promise<PostMergeTargetMergeReceipt> {
    if (input.signal?.aborted) throw input.signal.reason;
    assertPostMergeTargetMergeIntent(input.intent);
    if (input.source.repositoryId !== input.intent.changeBranch.repositoryId) {
      throw new PostMergeCheckoutError('invalid-input', input.intent.changeBranch.repositoryId);
    }
    const temporaryRoot = path.resolve(input.temporaryRoot);
    await mkdir(temporaryRoot, { recursive: true });
    const resolvedTemporaryRoot = await realpath(temporaryRoot);
    const runRoot = path.join(
      resolvedTemporaryRoot,
      postMergeCheckoutDirectory(input.intent.runId),
    );
    const marker: CheckoutMarker = {
      schemaVersion: 1,
      runId: input.intent.runId,
      mergeFactsDigest: input.intent.mergeFactsDigest,
    };
    try {
      await mkdir(runRoot);
      await atomicWriteJson(path.join(runRoot, MARKER), marker);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await assertManagedRunRoot(resolvedTemporaryRoot, runRoot, marker);
    }
    const sourceRoot = path.resolve(input.source.path);
    const remoteUrl = await git(sourceRoot, ['remote', 'get-url', input.intent.remote]);
    if (normalizeRemoteIdentity(remoteUrl) !== input.intent.changeBranch.remoteIdentity) {
      throw new PostMergeCheckoutError('source-mismatch', input.intent.changeBranch.repositoryId);
    }
    await this.assertLockedRemote(sourceRoot, input.intent);

    const checkoutPath = path.join(
      runRoot,
      `change-${repositoryDirectory(input.intent.changeBranch.repositoryId)}`,
    );
    const freshCheckout = !(await exists(checkoutPath));
    if (freshCheckout) {
      await execute('git', [
        'clone',
        '--no-checkout',
        '--origin',
        input.intent.remote,
        remoteUrl,
        checkoutPath,
      ]);
    }
    const checkoutRemoteUrl = await git(checkoutPath, ['remote', 'get-url', input.intent.remote]);
    if (normalizeRemoteIdentity(checkoutRemoteUrl) !== input.intent.changeBranch.remoteIdentity) {
      throw new PostMergeCheckoutError('source-mismatch', input.intent.changeBranch.repositoryId);
    }
    await execute(
      'git',
      [
        'fetch',
        '--no-tags',
        input.intent.remote,
        `refs/heads/${input.intent.changeBranch.sourceBranch}`,
        `refs/heads/${input.intent.changeBranch.targetBranch}`,
      ],
      { cwd: checkoutPath },
    );
    if (freshCheckout) {
      await execute(
        'git',
        [
          'checkout',
          '-B',
          input.intent.changeBranch.sourceBranch,
          input.intent.changeBranch.remoteOid,
        ],
        { cwd: checkoutPath },
      );
    }

    const mergeHead = await execute('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
      cwd: checkoutPath,
      allowFailure: true,
    });
    if (mergeHead.stdout.trim()) {
      throw new PostMergeCheckoutError(
        'target-merge-conflict',
        input.intent.changeBranch.repositoryId,
      );
    }
    let head = (
      await execute('git', ['rev-parse', '-q', '--verify', 'HEAD'], {
        cwd: checkoutPath,
        allowFailure: true,
      })
    ).stdout.trim();
    if (head && head !== input.intent.changeBranch.remoteOid) {
      const existingParents = (
        await execute('git', ['rev-list', '--parents', '-n', '1', head], {
          cwd: checkoutPath,
          allowFailure: true,
        })
      ).stdout
        .trim()
        .split(/\s+/u)
        .slice(1);
      const status = await git(checkoutPath, ['status', '--porcelain=v1', '--untracked-files=all']);
      const recoveredMerge =
        existingParents.length === 2 &&
        existingParents[0] === input.intent.changeBranch.remoteOid &&
        existingParents[1] === input.intent.targetOid;
      if (!recoveredMerge) {
        if (status) {
          throw new PostMergeCheckoutError(
            'target-merge-invalid',
            input.intent.changeBranch.repositoryId,
          );
        }
        await execute(
          'git',
          [
            'checkout',
            '-B',
            input.intent.changeBranch.sourceBranch,
            input.intent.changeBranch.remoteOid,
          ],
          { cwd: checkoutPath },
        );
        head = input.intent.changeBranch.remoteOid;
      }
    }
    if (!head) {
      await execute(
        'git',
        [
          'checkout',
          '-B',
          input.intent.changeBranch.sourceBranch,
          input.intent.changeBranch.remoteOid,
        ],
        { cwd: checkoutPath },
      );
      head = input.intent.changeBranch.remoteOid;
    }
    if (head === input.intent.changeBranch.remoteOid) {
      const status = await git(checkoutPath, ['status', '--porcelain=v1', '--untracked-files=all']);
      if (status) {
        throw new PostMergeCheckoutError(
          'target-merge-invalid',
          input.intent.changeBranch.repositoryId,
        );
      }
      await execute('git', ['config', 'user.name', 'Repoctopus'], { cwd: checkoutPath });
      await execute('git', ['config', 'user.email', 'repoctopus@example.invalid'], {
        cwd: checkoutPath,
      });
      await execute('git', ['merge', '--no-ff', '--no-edit', input.intent.targetOid], {
        cwd: checkoutPath,
        allowFailure: true,
      });
      const conflict = await execute('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
        cwd: checkoutPath,
        allowFailure: true,
      });
      if (conflict.stdout.trim()) {
        throw new PostMergeCheckoutError(
          'target-merge-conflict',
          input.intent.changeBranch.repositoryId,
        );
      }
      head = await git(checkoutPath, ['rev-parse', 'HEAD']);
    }
    const parentLine = await git(checkoutPath, ['rev-list', '--parents', '-n', '1', head]);
    const [commit, ...parents] = parentLine.split(/\s+/u);
    const status = await git(checkoutPath, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (
      commit !== head ||
      parents.length !== 2 ||
      parents[0] !== input.intent.changeBranch.remoteOid ||
      parents[1] !== input.intent.targetOid ||
      status
    ) {
      throw new PostMergeCheckoutError(
        'target-merge-invalid',
        input.intent.changeBranch.repositoryId,
      );
    }
    await this.assertLockedRemote(checkoutPath, input.intent);
    const receipt = createPostMergeTargetMergeReceipt({
      schemaVersion: 1,
      intentDigest: input.intent.digest,
      repositoryId: input.intent.changeBranch.repositoryId,
      sourceOid: input.intent.changeBranch.remoteOid,
      targetOid: input.intent.targetOid,
      mergeCommitOid: head,
      parents: [parents[0], parents[1]],
      checkoutPath,
    });
    await this.hooks.afterTargetMergeCreated?.(structuredClone(receipt));
    return receipt;
  }

  async verifyTargetMerge(
    intent: PostMergeTargetMergeIntent,
    receipt: PostMergeTargetMergeReceipt,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    assertPostMergeTargetMergeReceipt(receipt, intent);
    const [head, parentLine, status, remoteUrl] = await Promise.all([
      git(receipt.checkoutPath, ['rev-parse', 'HEAD']),
      git(receipt.checkoutPath, ['rev-list', '--parents', '-n', '1', 'HEAD']),
      git(receipt.checkoutPath, ['status', '--porcelain=v1', '--untracked-files=all']),
      git(receipt.checkoutPath, ['remote', 'get-url', intent.remote]),
    ]);
    if (
      head !== receipt.mergeCommitOid ||
      parentLine !== [receipt.mergeCommitOid, ...receipt.parents].join(' ') ||
      status ||
      normalizeRemoteIdentity(remoteUrl) !== intent.changeBranch.remoteIdentity
    ) {
      throw new PostMergeCheckoutError('checkout-drift', intent.changeBranch.repositoryId);
    }
    await this.assertLockedRemote(receipt.checkoutPath, intent);
  }

  private async assertLockedRemote(
    repositoryRoot: string,
    intent: PostMergeTargetMergeIntent,
  ): Promise<void> {
    const [sourceOid, targetOid] = await Promise.all([
      remoteBranchOid(repositoryRoot, intent.remote, intent.changeBranch.sourceBranch),
      remoteBranchOid(repositoryRoot, intent.remote, intent.changeBranch.targetBranch),
    ]);
    if (sourceOid !== intent.changeBranch.remoteOid) {
      throw new PostMergeCheckoutError('change-branch-drift', intent.changeBranch.repositoryId);
    }
    if (targetOid !== intent.targetOid) {
      throw new PostMergeCheckoutError('target-branch-drift', intent.changeBranch.repositoryId);
    }
  }

  private async cleanupRoot(
    temporaryRoot: string,
    runRoot: string,
    marker: CheckoutMarker,
  ): Promise<void> {
    if (!(await exists(runRoot))) return;
    try {
      await assertManagedRunRoot(temporaryRoot, runRoot, marker);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof PostMergeCheckoutError) {
        throw new PostMergeCheckoutError('cleanup-refused');
      }
      throw error;
    }
    await rm(runRoot, { recursive: true, force: false });
  }
}
