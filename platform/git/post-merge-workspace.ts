import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  PostMergeWorkspaceBaseline,
  PostMergeWorkspaceChange,
  PostMergeWorkspaceContentType,
  PostMergeWorkspaceDiff,
  PostMergeWorkspacePort,
} from '../../domains/post-merge/closure.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import { execute } from '../process/execute.js';

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  return (await execute('git', args, { cwd: root })).stdout;
}

async function assertRepositoryRoot(root: string): Promise<string> {
  const resolved = await realpath(root);
  const topLevel = (await git(resolved, ['rev-parse', '--show-toplevel'])).trim();
  if ((await realpath(topLevel)).toLowerCase() !== resolved.toLowerCase()) {
    throw new Error(`Post-merge workspace must be a Git repository root: ${root}`);
  }
  return resolved;
}

async function trackedContent(root: string, file: string): Promise<string> {
  return git(root, ['show', `HEAD:${file}`]);
}

async function contentType(
  root: string,
  file: string,
  status: PostMergeWorkspaceChange['status'],
): Promise<PostMergeWorkspaceContentType> {
  if (status !== 'deleted') {
    const target = path.join(root, ...file.split('/'));
    const fileStat = await lstat(target);
    if (fileStat.isSymbolicLink()) return 'symlink';
    if (!fileStat.isFile()) return 'unsupported';
    return (await readFile(target)).includes(0) ? 'binary' : 'text';
  }
  const mode = (await git(root, ['ls-tree', 'HEAD', '--', file])).split(/\s/u)[0];
  if (mode === '120000') return 'symlink';
  if (mode !== '100644' && mode !== '100755') return 'unsupported';
  return (await trackedContent(root, file)).includes('\0') ? 'binary' : 'text';
}

function parseTracked(stdout: string): Array<{
  path: string;
  status: PostMergeWorkspaceChange['status'];
  previousPath?: string;
}> {
  const tokens = stdout.split('\0').filter(Boolean);
  const changes: Array<{
    path: string;
    status: PostMergeWorkspaceChange['status'];
    previousPath?: string;
  }> = [];
  for (let index = 0; index < tokens.length; ) {
    const code = tokens[index++]!;
    if (code.startsWith('R')) {
      const previousPath = tokens[index++];
      const currentPath = tokens[index++];
      if (!previousPath || !currentPath)
        throw new Error('Git returned an incomplete rename record');
      changes.push({ path: currentPath, previousPath, status: 'renamed' });
      continue;
    }
    const file = tokens[index++];
    if (!file) throw new Error('Git returned an incomplete path change record');
    const status =
      code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === 'M' ? 'modified' : null;
    if (!status) throw new Error(`Git returned an unsupported path status: ${code}`);
    changes.push({ path: file, status });
  }
  return changes;
}

export class GitPostMergeWorkspace implements PostMergeWorkspacePort {
  async cleanBaseline(root: string): Promise<PostMergeWorkspaceBaseline> {
    const resolved = await assertRepositoryRoot(root);
    const status = await git(resolved, ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
    if (status.length > 0) {
      throw new Error(
        'Post-merge coordination workspace must be clean before Specification closure',
      );
    }
    const [head, tree] = await Promise.all([
      git(resolved, ['rev-parse', 'HEAD']).then((value) => value.trim()),
      git(resolved, ['rev-parse', 'HEAD^{tree}']).then((value) => value.trim()),
    ]);
    const base = { schemaVersion: 1 as const, root: resolved, head, tree };
    return { ...base, digest: sha256(base) };
  }

  async diff(baseline: PostMergeWorkspaceBaseline): Promise<PostMergeWorkspaceDiff> {
    const resolved = await assertRepositoryRoot(baseline.root);
    if (resolved.toLowerCase() !== baseline.root.toLowerCase()) {
      throw new Error('Post-merge workspace root changed before path audit');
    }
    const [head, tree, trackedOutput, untrackedOutput] = await Promise.all([
      git(resolved, ['rev-parse', 'HEAD']).then((value) => value.trim()),
      git(resolved, ['rev-parse', 'HEAD^{tree}']).then((value) => value.trim()),
      git(resolved, ['diff', '--name-status', '-z', '--find-renames', 'HEAD', '--']),
      git(resolved, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]);
    const records = parseTracked(trackedOutput);
    for (const file of untrackedOutput.split('\0').filter(Boolean)) {
      records.push({ path: file, status: 'added' });
    }
    records.sort((left, right) => left.path.localeCompare(right.path));
    const changes = await Promise.all(
      records.map(
        async (record): Promise<PostMergeWorkspaceChange> => ({
          ...record,
          contentType: await contentType(resolved, record.path, record.status),
        }),
      ),
    );
    return { baseline: structuredClone(baseline), head, tree, changes };
  }
}
