import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

import type {
  DirtyFileFingerprint,
  RepositoryFingerprint,
} from '../../domains/evidence/fingerprint.js';
import { runExternalCommandAsync } from '../process/external-command.js';

function nulPaths(value: string): string[] {
  return value
    .split('\0')
    .filter(Boolean)
    .map((item) => item.replaceAll('\\', '/'));
}

function containedPath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Git reported a path outside its repository: ${relativePath}`);
  }
  return target;
}

async function fingerprintFile(root: string, relativePath: string): Promise<DirtyFileFingerprint> {
  const normalized = relativePath.replaceAll('\\', '/');
  const target = containedPath(root, normalized);
  try {
    const information = await lstat(target);
    if (information.isSymbolicLink()) {
      const link = await readlink(target, 'utf8');
      return {
        path: normalized,
        kind: 'symlink',
        sha256: createHash('sha256').update(link).digest('hex'),
        size: Buffer.byteLength(link),
      };
    }
    if (!information.isFile()) throw new Error(`Dirty input is not a regular file: ${normalized}`);
    const contents = await readFile(target);
    return {
      path: normalized,
      kind: 'file',
      sha256: createHash('sha256').update(contents).digest('hex'),
      size: contents.byteLength,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      path: normalized,
      kind: 'deleted',
      sha256: createHash('sha256').update('deleted').digest('hex'),
      size: 0,
    };
  }
}

export async function collectRepositoryFingerprint(input: {
  repositoryId: string;
  root: string;
}): Promise<RepositoryFingerprint> {
  const root = path.resolve(input.root);
  const [head, tree, changed, untracked] = await Promise.all([
    runExternalCommandAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    runExternalCommandAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }),
    runExternalCommandAsync('git', ['diff', '--name-only', '-z', 'HEAD', '--'], { cwd: root }),
    runExternalCommandAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
    }),
  ]);
  const dirtyPaths = [...new Set([...nulPaths(changed), ...nulPaths(untracked)])].sort();
  return {
    repositoryId: input.repositoryId,
    head: head.trim(),
    tree: tree.trim(),
    dirtyFiles: await Promise.all(dirtyPaths.map((file) => fingerprintFile(root, file))),
  };
}
