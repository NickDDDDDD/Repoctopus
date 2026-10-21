import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { createProjectSnapshot } from '../../domains/project/snapshot.js';
import type { ProjectSnapshot, RepositorySnapshot } from '../../domains/project/types.js';
import { execute } from '../process/execute.js';
import { normalizeRemoteIdentity } from './remote-identity.js';

export { normalizeRemoteIdentity } from './remote-identity.js';

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function repositoryId(remoteIdentity: string | null, resolvedPath: string): string {
  return createHash('sha256')
    .update(remoteIdentity ?? resolvedPath.toLowerCase())
    .digest('hex')
    .slice(0, 20);
}

function worktreeSummary(status: string): RepositorySnapshot['worktree'] {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  const records = status.split('\0').filter(Boolean);
  for (const record of records) {
    if (record.startsWith('? ')) {
      untracked += 1;
      continue;
    }
    if (!record.startsWith('1 ') && !record.startsWith('2 ') && !record.startsWith('u ')) continue;
    const fields = record.split(' ');
    const xy = fields[1] ?? '..';
    if (xy[0] && xy[0] !== '.') staged += 1;
    if (xy[1] && xy[1] !== '.') unstaged += 1;
  }
  return {
    dirty: staged + unstaged + untracked > 0,
    digest: createHash('sha256').update(status).digest('hex'),
    staged,
    unstaged,
    untracked,
  };
}

async function optionalGit(cwd: string, args: string[]): Promise<string | null> {
  const result = await execute('git', args, { cwd, allowFailure: true });
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export async function inspectRepository(candidate: string): Promise<RepositorySnapshot | null> {
  const inside = await optionalGit(candidate, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return null;
  const topLevel = await optionalGit(candidate, ['rev-parse', '--show-toplevel']);
  if (!topLevel) return null;
  const resolvedCandidate = await realpath(candidate);
  const resolvedTopLevel = await realpath(topLevel);
  if (resolvedCandidate.toLowerCase() !== resolvedTopLevel.toLowerCase()) return null;

  const head = await optionalGit(candidate, ['rev-parse', 'HEAD']);
  if (!head) throw new Error(`Git repository has no HEAD commit: ${candidate}`);
  const branch = await optionalGit(candidate, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const remote = await optionalGit(candidate, ['remote', 'get-url', 'origin']);
  const statusResult = await execute(
    'git',
    ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
    {
      cwd: candidate,
    },
  );
  const remoteIdentity = remote ? normalizeRemoteIdentity(remote) : null;
  return {
    id: repositoryId(remoteIdentity, resolvedCandidate),
    name: path.basename(resolvedCandidate),
    path: resolvedCandidate,
    remoteIdentity,
    branch,
    head,
    worktree: worktreeSummary(statusResult.stdout),
  };
}

export async function snapshotWorkspaceRepositories(options: {
  workspaceId: string;
  workspaceRoot: string;
  workspaceRepositoryId: string;
  repositories: ReadonlyArray<{ id: string; path: string }>;
  now?: () => Date;
}): Promise<ProjectSnapshot> {
  const workspaceRoot = await realpath(options.workspaceRoot);
  const repositories: RepositorySnapshot[] = [];
  for (const configured of [...options.repositories].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    let resolved: string;
    try {
      resolved = await realpath(configured.path);
    } catch (error) {
      throw new Error(
        `Configured repository is unreadable: ${configured.id}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const repository = await inspectRepository(resolved);
    if (!repository) {
      throw new Error(
        `Configured repository is not a Git repository root: ${configured.id}: ${resolved}`,
      );
    }
    repositories.push({ ...repository, id: configured.id });
  }
  const workspaceRepository = repositories.find(
    (repository) => repository.id === options.workspaceRepositoryId,
  );
  if (!workspaceRepository) {
    throw new Error(`Workspace Repository is not registered: ${options.workspaceRepositoryId}`);
  }
  if (workspaceRepository.path.toLowerCase() !== workspaceRoot.toLowerCase()) {
    throw new Error(
      `Workspace Repository must resolve to the Workspace root: ${workspaceRepository.path}`,
    );
  }
  const identities = new Map<string, string>();
  for (const repository of repositories) {
    const identity = repository.remoteIdentity ?? repository.path.toLowerCase();
    const existing = identities.get(identity);
    if (existing) {
      throw new Error(
        `Configured repositories share one Git identity: ${existing}, ${repository.id}: ${identity}`,
      );
    }
    identities.set(identity, repository.id);
  }
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId: options.workspaceId,
    root: workspaceRoot,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    repositories,
    diagnostics: [],
  });
}

export async function probeProject(options: {
  root: string;
  duplicateIdentity?: 'error' | 'omit-ambiguous';
  now?: () => Date;
}): Promise<ProjectSnapshot> {
  const resolvedRoot = await realpath(options.root);
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const repositories: RepositorySnapshot[] = [];
  const diagnostics: ProjectSnapshot['diagnostics'] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const candidate = path.join(resolvedRoot, entry.name);
    let resolved: string;
    try {
      resolved = await realpath(candidate);
      const candidateStat = await stat(resolved);
      if (!candidateStat.isDirectory()) continue;
    } catch (error) {
      diagnostics.push({
        code: 'path-unreadable',
        path: candidate,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!contained(resolvedRoot, resolved)) {
      diagnostics.push({
        code: 'path-outside-root',
        path: candidate,
        message: `Resolved path is outside project root: ${resolved}`,
      });
      continue;
    }
    const repository = await inspectRepository(resolved);
    if (repository) repositories.push(repository);
  }

  // Detection is presented to people and hashed into an approval draft. Keep its
  // order tied to the visible scan path instead of an opaque identity hash.
  repositories.sort((left, right) => left.path.localeCompare(right.path));
  const identityCounts = new Map<string, number>();
  for (const repository of repositories) {
    identityCounts.set(repository.id, (identityCounts.get(repository.id) ?? 0) + 1);
  }
  const ambiguousIds = new Set(
    [...identityCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  );
  const duplicate = repositories.find((repository) => ambiguousIds.has(repository.id));
  if (duplicate && options.duplicateIdentity !== 'omit-ambiguous') {
    throw new Error(`Duplicate repository identity: ${duplicate.remoteIdentity ?? duplicate.path}`);
  }
  if (duplicate) {
    for (const repository of repositories.filter((item) => ambiguousIds.has(item.id))) {
      diagnostics.push({
        code: 'duplicate-repository-identity',
        path: repository.path,
        message: `Omitted ambiguous repository identity: ${repository.remoteIdentity ?? repository.id}`,
      });
    }
  }
  const unambiguousRepositories = repositories.filter(
    (repository) => !ambiguousIds.has(repository.id),
  );

  const projectId = createHash('sha256')
    .update(resolvedRoot.toLowerCase())
    .digest('hex')
    .slice(0, 20);
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId,
    root: resolvedRoot,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    repositories: unambiguousRepositories,
    diagnostics,
  });
}
