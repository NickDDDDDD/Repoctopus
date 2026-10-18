import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { unlinkWithRetry } from '../filesystem/transient-retry.js';
import { inspectProcessLiveness, readProcessIdentity } from '../process/process-identity.js';

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_RETRY_MS = 20;
const DEFAULT_MALFORMED_LOCK_STALE_MS = 5 * 60_000;
const EMPTY_LOCK_GRACE_MS = 10_000;

interface FileLockOwner {
  readonly pid: number;
  readonly nonce: string;
  readonly createdAt: number;
  readonly hostname?: string;
  readonly processIdentity?: string;
}

export interface RecoverableFileLockOptions {
  readonly timeoutMs?: number;
  readonly retryMs?: number;
  readonly malformedLockStaleMs?: number;
}

export async function withRecoverableFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: RecoverableFileLockOptions = {},
): Promise<T> {
  const resolvedLockPath = path.resolve(lockPath);
  await fs.mkdir(path.dirname(resolvedLockPath), { recursive: true });
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS;
  const malformedLockStaleMs = options.malformedLockStaleMs ?? DEFAULT_MALFORMED_LOCK_STALE_MS;
  const processIdentity = await readProcessIdentity(process.pid);
  const owner: FileLockOwner = {
    pid: process.pid,
    nonce: randomUUID(),
    createdAt: Date.now(),
    hostname: os.hostname(),
    ...(processIdentity === null ? {} : { processIdentity }),
  };
  let acquired = false;
  while (!acquired) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(resolvedLockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(owner), 'utf8');
      await handle.sync();
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await recoverAbandonedLock(resolvedLockPath, malformedLockStaleMs)) continue;
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`Timed out waiting for file lock: ${resolvedLockPath}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    } finally {
      await handle?.close();
    }
  }
  try {
    return await operation();
  } finally {
    await releaseOwnedLock(resolvedLockPath, owner.nonce);
  }
}

async function recoverAbandonedLock(
  lockPath: string,
  malformedLockStaleMs: number,
): Promise<boolean> {
  let content: string;
  let information: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [content, information] = await Promise.all([fs.readFile(lockPath, 'utf8'), fs.stat(lockPath)]);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
  const owner = parseLockOwner(content);
  if (owner !== null) {
    if (owner.hostname !== undefined && owner.hostname !== os.hostname()) return false;
    if ((await inspectProcessLiveness(owner.pid, owner.processIdentity)) !== 'dead') return false;
  } else {
    const graceMs = content.trim().length === 0 ? EMPTY_LOCK_GRACE_MS : malformedLockStaleMs;
    if (Date.now() - information.mtimeMs < graceMs) return false;
  }
  try {
    if ((await fs.readFile(lockPath, 'utf8')) !== content) return false;
    await fs.rm(lockPath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

async function releaseOwnedLock(lockPath: string, nonce: string): Promise<void> {
  try {
    if (parseLockOwner(await fs.readFile(lockPath, 'utf8'))?.nonce !== nonce) return;
    await unlinkWithRetry(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    process.stderr.write(
      `[repoctopus] warning: could not remove lock file ${lockPath}; it will be recovered automatically\n`,
    );
  }
}

function parseLockOwner(content: string): FileLockOwner | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    return Number.isSafeInteger(value.pid) &&
      Number(value.pid) > 0 &&
      typeof value.nonce === 'string' &&
      value.nonce.length > 0 &&
      typeof value.createdAt === 'number' &&
      Number.isFinite(value.createdAt) &&
      (value.hostname === undefined ||
        (typeof value.hostname === 'string' && value.hostname.length > 0)) &&
      (value.processIdentity === undefined ||
        (typeof value.processIdentity === 'string' && value.processIdentity.length > 0))
      ? {
          pid: Number(value.pid),
          nonce: value.nonce,
          createdAt: value.createdAt,
          ...(value.hostname === undefined ? {} : { hostname: value.hostname }),
          ...(value.processIdentity === undefined
            ? {}
            : { processIdentity: value.processIdentity }),
        }
      : null;
  } catch {
    return null;
  }
}
