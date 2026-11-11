import { randomUUID } from 'crypto';
import type { Stats } from 'fs';

import { linkWithRetry, renameWithRetry, unlinkWithRetry } from './transient-retry.js';
import { promises as fs } from 'fs';
import path from 'path';

import { sameFileObject } from './file-identity.js';

export interface AtomicWriteOptions {
  containedRoot?: string;
  beforeTemporaryOpen?: () => void | Promise<void>;
  afterTemporaryClose?: () => void | Promise<void>;
  beforeCommit?: () => void | Promise<void>;
  exclusive?: boolean;
  temporaryTag?: string;
}

interface DirectoryIdentity {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  birthtimeMs: number;
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function sameDirectoryIdentity(identity: DirectoryIdentity, stat: Stats): boolean {
  return sameFileObject(
    { ...identity, birthtime: identity.birthtimeMs },
    {
      ...stat,
      birthtime: stat.birthtimeMs,
    },
  );
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  // On file systems without stable file ids (exFAT, FAT, some network mounts)
  // the comparison degrades to birthtime. ctime and size change with every
  // legitimate write, so they cannot distinguish tampering from our own write.
  return sameFileObject(
    { dev: left.dev, ino: left.ino, birthtime: left.birthtimeMs },
    { dev: right.dev, ino: right.ino, birthtime: right.birthtimeMs },
  );
}

function sameUnchangedFile(left: Stats, right: Stats): boolean {
  // Linux may immediately reuse an inode after unlink, so object identity alone
  // cannot prove that a path still names the post-write snapshot. These fields
  // are safe to compare only after our own write has finished.
  return (
    sameFileIdentity(left, right) &&
    left.birthtimeMs === right.birthtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

async function captureDirectoryIdentity(directory: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Atomic write parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs.realpath(directory),
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  };
}

async function verifyDirectoryChain(chain: readonly DirectoryIdentity[]): Promise<void> {
  for (const identity of chain) {
    const stat = await fs.lstat(identity.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameDirectoryIdentity(identity, stat) ||
      (await fs.realpath(identity.path)) !== identity.realPath
    ) {
      throw new Error(`Atomic write parent changed before commit: ${identity.path}`);
    }
  }
}

async function captureClosedTemporaryFile(
  temporary: string,
  writtenIdentity: Stats,
  directoryChain: readonly DirectoryIdentity[] | null,
): Promise<Stats> {
  const [temporaryStat, temporaryRealPath] = await Promise.all([
    fs.lstat(temporary),
    fs.realpath(temporary),
    directoryChain ? verifyDirectoryChain(directoryChain) : Promise.resolve(),
  ]);
  if (
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    !sameFileIdentity(temporaryStat, writtenIdentity) ||
    (directoryChain && !isInside(directoryChain[0]!.realPath, temporaryRealPath))
  ) {
    throw new Error('Atomic write temporary file changed after close');
  }
  return temporaryStat;
}

async function prepareContainedDirectoryChain(
  root: string,
  directory: string,
  create = true,
): Promise<DirectoryIdentity[]> {
  const lexicalRoot = path.resolve(root);
  const lexicalDirectory = path.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error(`Atomic write parent is outside its managed root: ${directory}`);
  }

  const chain: DirectoryIdentity[] = [await captureDirectoryIdentity(lexicalRoot)];
  const segments = path.relative(lexicalRoot, lexicalDirectory).split(path.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of segments) {
    await verifyDirectoryChain(chain);
    cursor = path.join(cursor, segment);
    if (create) {
      try {
        await fs.mkdir(cursor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const identity = await captureDirectoryIdentity(cursor);
    if (!isInside(chain[0]!.realPath, identity.realPath)) {
      throw new Error(`Atomic write parent resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
  }
  await verifyDirectoryChain(chain);
  return chain;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function atomicWrite(
  file: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directory = path.dirname(file);
  const directoryChain = options.containedRoot
    ? await prepareContainedDirectoryChain(options.containedRoot, directory)
    : null;
  if (!directoryChain) await fs.mkdir(directory, { recursive: true });
  const tag = options.temporaryTag;
  if (tag !== undefined && !/^[a-f0-9]{24}$/u.test(tag))
    throw new Error('Invalid atomic write temporary tag');
  const nonce = randomUUID();
  const temporaryId = tag ? `${tag}.${nonce.replaceAll('-', '').slice(0, 12)}` : nonce;
  const temporary = path.join(directory, `.${path.basename(file)}.${temporaryId}.tmp`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let temporaryIdentity: Stats | undefined;
  let writtenIdentity: Stats | undefined;
  try {
    await options.beforeTemporaryOpen?.();
    handle = await fs.open(temporary, 'wx');
    temporaryIdentity = await handle.stat();
    if (directoryChain) {
      const [temporaryPathStat, temporaryRealPath] = await Promise.all([
        fs.lstat(temporary),
        fs.realpath(temporary),
      ]);
      await verifyDirectoryChain(directoryChain);
      if (
        !temporaryPathStat.isFile() ||
        temporaryPathStat.isSymbolicLink() ||
        !sameFileIdentity(temporaryIdentity, temporaryPathStat) ||
        !isInside(directoryChain[0]!.realPath, temporaryRealPath)
      ) {
        throw new Error('Atomic write temporary file opened outside its managed parent');
      }
    }
    if (typeof content === 'string') await handle.writeFile(content, 'utf8');
    else await handle.writeFile(content);
    await handle.sync();
    writtenIdentity = await handle.stat();
    if (!sameFileIdentity(temporaryIdentity, writtenIdentity)) {
      throw new Error('Atomic write temporary file changed while writing');
    }
    await handle.close();
    handle = undefined;
    await options.afterTemporaryClose?.();
    if (!writtenIdentity) {
      throw new Error('Atomic write temporary file was not written');
    }
    writtenIdentity = await captureClosedTemporaryFile(temporary, writtenIdentity, directoryChain);
    await options.beforeCommit?.();
    if (directoryChain) {
      await verifyDirectoryChain(directoryChain);
      const temporaryStat = await fs.lstat(temporary);
      if (
        !temporaryStat.isFile() ||
        temporaryStat.isSymbolicLink() ||
        !writtenIdentity ||
        !sameUnchangedFile(temporaryStat, writtenIdentity)
      ) {
        throw new Error('Atomic write temporary file changed before commit');
      }
    }
    if (options.exclusive) {
      await linkWithRetry(temporary, file);
      await unlinkWithRetry(temporary);
    } else {
      await renameWithRetry(temporary, file);
    }
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    if (!directoryChain) {
      await fs.rm(temporary, { force: true });
    } else {
      try {
        await verifyDirectoryChain(directoryChain);
        await fs.rm(temporary, { force: true });
      } catch {
        // The lexical path may now name an attacker-controlled parent. Leave the
        // temporary file in the displaced managed directory for doctor cleanup.
      }
    }
    throw error;
  }
}

export async function prepareContainedFileCleanup(
  file: string,
  containedRoot: string,
): Promise<() => Promise<void>> {
  const chain = await prepareContainedDirectoryChain(containedRoot, path.dirname(file), false);
  const original = await fs.lstat(file).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (original && !original.isFile())
    throw new Error(`Cleanup target must be a regular file: ${file}`);
  await verifyDirectoryChain(chain);
  return async () => {
    if (!original) return;
    try {
      const current = await fs.lstat(file);
      if (!current.isFile() || !sameUnchangedFile(original, current)) {
        throw new Error(`Cleanup target changed before removal: ${file}`);
      }
      await verifyDirectoryChain(chain);
      await fs.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}

export async function atomicWriteText(
  file: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWrite(file, content, options);
}

export async function atomicWriteBytes(
  file: string,
  content: Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWrite(file, content, options);
}

export async function atomicWriteJson(
  file: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteText(file, JSON.stringify(value, null, 2) + '\n', options);
}
