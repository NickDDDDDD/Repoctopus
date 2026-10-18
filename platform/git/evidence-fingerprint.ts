import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

import type {
  DirtyFileFingerprint,
  RepositoryFingerprint,
} from '../../domains/evidence/fingerprint.js';
import { sameFileObject } from '../filesystem/file-identity.js';
import { hashFileRaceSafe } from '../filesystem/race-safe-read.js';
import { runExternalCommandAsync } from '../process/external-command.js';

export class RepositoryFingerprintChangedError extends Error {
  constructor(readonly repositoryId: string) {
    super(`Repository inputs changed while fingerprinting: ${repositoryId}`);
    this.name = 'RepositoryFingerprintChangedError';
  }
}

interface GitSelection {
  head: string;
  tree: string;
  dirtyPaths: string[];
}

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

function inside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function sameSymlink(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameFileObject(
      { dev: left.dev, ino: left.ino, birthtime: left.birthtimeNs },
      { dev: right.dev, ino: right.ino, birthtime: right.birthtimeNs },
    ) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs
  );
}

async function fingerprintFile(root: string, relativePath: string): Promise<DirtyFileFingerprint> {
  const normalized = relativePath.replaceAll('\\', '/');
  const target = containedPath(root, normalized);
  try {
    const information = await lstat(target, { bigint: true });
    if (information.isSymbolicLink()) {
      const link = await readlink(target, 'utf8');
      const after = await lstat(target, { bigint: true });
      if (!after.isSymbolicLink() || !sameSymlink(information, after)) {
        throw new Error(`Dirty symlink changed while fingerprinting: ${normalized}`);
      }
      return {
        path: normalized,
        kind: 'symlink',
        sha256: createHash('sha256').update(link).digest('hex'),
        size: Buffer.byteLength(link),
      };
    }
    if (!information.isFile()) throw new Error(`Dirty input is not a regular file: ${normalized}`);
    const captured = await hashFileRaceSafe(target, {
      bigint: true,
      label: `dirty input ${normalized}`,
    });
    if (!inside(await realpath(root), captured.realPath)) {
      throw new Error(`Dirty input resolves outside its repository: ${normalized}`);
    }
    return {
      path: normalized,
      kind: 'file',
      sha256: captured.digest,
      size: Number(captured.stat.size),
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

async function captureSelection(root: string): Promise<GitSelection> {
  const [head, tree, changed, untracked] = await Promise.all([
    runExternalCommandAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    runExternalCommandAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root }),
    runExternalCommandAsync('git', ['diff', '--name-only', '-z', 'HEAD', '--'], { cwd: root }),
    runExternalCommandAsync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
    }),
  ]);
  return {
    head: head.trim(),
    tree: tree.trim(),
    dirtyPaths: [...new Set([...nulPaths(changed), ...nulPaths(untracked)])].sort(),
  };
}

function sameSelection(left: GitSelection, right: GitSelection): boolean {
  return (
    left.head === right.head &&
    left.tree === right.tree &&
    JSON.stringify(left.dirtyPaths) === JSON.stringify(right.dirtyPaths)
  );
}

export async function collectRepositoryFingerprint(input: {
  repositoryId: string;
  root: string;
  hooks?: { beforeFinalSelection?: () => void | Promise<void> };
}): Promise<RepositoryFingerprint> {
  const root = path.resolve(input.root);
  const before = await captureSelection(root);
  const dirtyFiles = await Promise.all(
    before.dirtyPaths.map((file) => fingerprintFile(root, file)),
  );
  await input.hooks?.beforeFinalSelection?.();
  const after = await captureSelection(root);
  if (!sameSelection(before, after))
    throw new RepositoryFingerprintChangedError(input.repositoryId);
  const confirmed = await Promise.all(after.dirtyPaths.map((file) => fingerprintFile(root, file)));
  if (JSON.stringify(dirtyFiles) !== JSON.stringify(confirmed)) {
    throw new RepositoryFingerprintChangedError(input.repositoryId);
  }
  return {
    repositoryId: input.repositoryId,
    head: before.head,
    tree: before.tree,
    dirtyFiles,
  };
}
