import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { createProjectSnapshot } from '../../domains/project/snapshot.js';
import type { ProjectSnapshot, RepositorySnapshot } from '../../domains/project/types.js';
import { execute } from '../process/execute.js';

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git\/?$/i, '').replace(/\/$/, '');
}

export function normalizeRemoteIdentity(remote: string): string {
  const trimmed = remote.trim();
  if (/^[^/@\s]+@[^:\s]+:.+$/.test(trimmed)) {
    const match = /^[^@]+@([^:]+):(.+)$/.exec(trimmed);
    if (match) return stripGitSuffix(`${match[1]}/${match[2]}`).toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return stripGitSuffix(`${url.hostname}${url.pathname}`).toLowerCase();
  } catch {
    return stripGitSuffix(trimmed).replaceAll('\\', '/');
  }
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

async function inspectRepository(candidate: string): Promise<RepositorySnapshot | null> {
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

export async function probeProject(options: {
  root: string;
  workspaceRoot?: string;
  now?: () => Date;
}): Promise<ProjectSnapshot> {
  const resolvedRoot = await realpath(options.root);
  const workspaceRoot = options.workspaceRoot ? await realpath(options.workspaceRoot) : null;
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
    if (workspaceRoot && resolved.toLowerCase() === workspaceRoot.toLowerCase()) continue;
    const repository = await inspectRepository(resolved);
    if (repository) repositories.push(repository);
  }

  repositories.sort((left, right) => left.id.localeCompare(right.id));
  const duplicate = repositories.find(
    (repository, index) => repositories.findIndex((item) => item.id === repository.id) !== index,
  );
  if (duplicate)
    throw new Error(`Duplicate repository identity: ${duplicate.remoteIdentity ?? duplicate.path}`);

  const projectId = createHash('sha256')
    .update(resolvedRoot.toLowerCase())
    .digest('hex')
    .slice(0, 20);
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId,
    root: resolvedRoot,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    repositories,
    diagnostics,
  });
}
