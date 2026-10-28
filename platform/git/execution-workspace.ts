import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { ExecutionCheckoutFacts } from '../../services/execution-workspace.js';
import { execute } from '../process/execute.js';
import { normalizeRemoteIdentity } from './remote-identity.js';

async function git(checkoutPath: string, args: readonly string[], optional = false): Promise<string | null> {
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
    throw new Error(`Execution checkout requires branch, HEAD, and Git ownership facts: ${checkoutPath}`);
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
    worktreeId: linked
      ? path.basename(normalizedGitDirectory)
      : null,
  };
}
