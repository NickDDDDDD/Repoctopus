import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  PostMergeCheckoutManifest,
  PostMergeCheckoutPort,
  PostMergeRepositorySource,
} from '../../domains/post-merge/checkout.js';
import { createPostMergeCheckoutManifest } from '../../domains/post-merge/checkout.js';
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

export class GitPostMergeCheckout implements PostMergeCheckoutPort {
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
