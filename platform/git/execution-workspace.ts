import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import type {
  ExecutionCheckoutFacts,
  ExpectedTaskProjection,
} from '../../services/execution-workspace.js';
import { execute } from '../process/execute.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';
import { normalizeRemoteIdentity } from './remote-identity.js';

const execFileAsync = promisify(execFile);
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function assertObjectId(value: string): void {
  if (!objectId.test(value)) throw new Error('Execution workspace requires an exact Git object ID');
}

async function readGitRecords(checkoutPath: string, args: readonly string[]): Promise<string[]> {
  const { stdout } = await execute(
    'git',
    ['--no-replace-objects', '--no-optional-locks', ...args],
    {
      cwd: checkoutPath,
    },
  );
  if (stdout === '') return [];
  if (!stdout.endsWith('\0')) throw new Error('Incomplete Git execution workspace observation');
  return stdout.slice(0, -1).split('\0');
}

export async function readTrackedExecutionInputs(
  checkoutPath: string,
  head: string,
): Promise<string[]> {
  assertObjectId(head);
  const [index, tree] = await Promise.all([
    readGitRecords(checkoutPath, ['ls-files', '--cached', '-z']),
    readGitRecords(checkoutPath, ['ls-tree', '--full-tree', '-r', '--name-only', '-z', head]),
  ]);
  if ((await git(checkoutPath, ['rev-parse', 'HEAD'])) !== head) {
    throw new Error('Execution checkout HEAD changed while reading its Git index and tree');
  }
  return [...new Set([...index, ...tree])].sort();
}

export async function observeExecutionCleanupCommit(
  checkoutPath: string,
  previous: string,
  head: string,
  expectedTasks?: ExpectedTaskProjection,
): Promise<string[] | null> {
  assertObjectId(previous);
  assertObjectId(head);
  const commit = await git(checkoutPath, ['--no-replace-objects', 'cat-file', '-p', head]);
  const parents = commit
    ?.split('\n\n', 1)[0]
    ?.split('\n')
    .filter((line) => line.startsWith('parent '));
  if (parents?.length !== 1 || parents[0] !== `parent ${previous}`) return null;
  const liveHead = await git(checkoutPath, ['rev-parse', 'HEAD']);
  if (liveHead !== head) return null;
  const [changes, clean, tracked] = await Promise.all([
    readGitRecords(checkoutPath, [
      'diff-tree',
      '--no-commit-id',
      '--no-renames',
      '--no-abbrev',
      '--ignore-submodules=none',
      '-r',
      '--raw',
      '-z',
      previous,
      head,
      '--',
    ]),
    isExecutionCheckoutClean(checkoutPath, expectedTasks),
    readTrackedExecutionInputs(checkoutPath, head),
  ]);
  if (!clean || changes.length === 0 || changes.length % 2 !== 0) return null;
  const currentlyTracked = new Set(tracked);
  const deleted: string[] = [];
  for (let index = 0; index < changes.length; index += 2) {
    const metadata = changes[index]!;
    const relativePath = changes[index + 1]!;
    if (
      !/^:100(?:644|755) 000000 [a-f0-9]+ 0+ D$/u.test(metadata) ||
      !relativePath ||
      relativePath.includes('�') ||
      currentlyTracked.has(relativePath)
    ) {
      return null;
    }
    deleted.push(relativePath);
  }
  return deleted.sort();
}

export async function isExecutionCheckoutClean(
  checkoutPath: string,
  expectedTasks?: ExpectedTaskProjection,
): Promise<boolean> {
  const [status, index] = await Promise.all([
    readGitRecords(checkoutPath, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignore-submodules=none',
      '-z',
    ]),
    readGitRecords(checkoutPath, ['ls-files', '-v', '-z']),
  ]);
  // Git status can hide local edits for skip-worktree and assume-unchanged entries.
  if (index.some((entry) => /^[Sa-z]/u.test(entry))) return false;
  if (status.length === 0) return true;
  if (!expectedTasks || status.length !== 1 || status[0] !== ` M ${expectedTasks.path}`)
    return false;
  const [{ stdout }, contents] = await Promise.all([
    execute('git', ['--no-replace-objects', 'cat-file', 'blob', `:${expectedTasks.path}`], {
      cwd: checkoutPath,
    }),
    readFileRaceSafe(path.join(checkoutPath, expectedTasks.path), 4 * 1024 * 1024, {
      bigint: true,
    }),
  ]);
  const digest = `sha256:${createHash('sha256').update(contents.bytes).digest('hex')}`;
  return digest === expectedTasks.rawDigest && expectedTasks.matchesCommittedDocument(stdout);
}

async function git(
  checkoutPath: string,
  args: readonly string[],
  optional = false,
): Promise<string | null> {
  const result = await execute('git', [...args], { cwd: checkoutPath, allowFailure: optional });
  const value = result.stdout.trim();
  return value || null;
}

export async function inspectExecutionCheckout(
  checkoutPath: string,
): Promise<ExecutionCheckoutFacts> {
  const resolved = await realpath(checkoutPath);
  const topLevel = await git(resolved, ['rev-parse', '--show-toplevel']);
  if (!topLevel || path.resolve(topLevel).toLowerCase() !== resolved.toLowerCase()) {
    throw new Error(`Execution checkout is not a Git repository root: ${checkoutPath}`);
  }
  const [branch, head, gitDirectory, commonDirectory, remote] = await Promise.all([
    git(resolved, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(resolved, ['rev-parse', 'HEAD']),
    git(resolved, ['rev-parse', '--path-format=absolute', '--git-dir']),
    git(resolved, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    git(resolved, ['remote', 'get-url', 'origin'], true),
  ]);
  if (!branch || !head || !gitDirectory || !commonDirectory) {
    throw new Error(
      `Execution checkout requires branch, HEAD, and Git ownership facts: ${checkoutPath}`,
    );
  }
  const normalizedGitDirectory = path.resolve(gitDirectory);
  const normalizedCommonDirectory = path.resolve(commonDirectory);
  const linked = normalizedGitDirectory.toLowerCase() !== normalizedCommonDirectory.toLowerCase();
  return {
    checkoutPath: resolved,
    branch,
    head,
    remoteIdentity: remote ? normalizeRemoteIdentity(remote) : null,
    gitDirectory: normalizedGitDirectory,
    commonDirectory: normalizedCommonDirectory,
    worktreeId: linked ? path.basename(normalizedGitDirectory) : null,
  };
}

export async function isExecutionRevisionAncestor(
  checkoutPath: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: checkoutPath,
      windowsHide: true,
    });
    return true;
  } catch (error) {
    const exitCode =
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : null;
    if (exitCode === 1) return false;
    throw new Error(`Cannot establish Git ancestry for execution checkout: ${checkoutPath}`, {
      cause: error,
    });
  }
}
