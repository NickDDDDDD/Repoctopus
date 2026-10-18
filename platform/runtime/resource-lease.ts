import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats, Stats } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { sameFileObject, type FileObjectIdentity } from '../filesystem/file-identity.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';
import { renameWithRetry, unlinkWithRetry } from '../filesystem/transient-retry.js';
import { inspectProcessLiveness, readProcessIdentity } from '../process/process-identity.js';

export interface ResourceLeaseOwner {
  schemaVersion: 1;
  leaseId: string;
  resourceKey: string;
  pid: number;
  hostname: string;
  createdAt: string;
  processIdentity?: string;
}

export interface ResourceLease {
  file: string;
  owner: ResourceLeaseOwner;
  identity: FileObjectIdentity;
}

export class ResourceLeaseConflictError extends Error {
  constructor(readonly owner: ResourceLeaseOwner) {
    super(`Resource lease is held by pid ${owner.pid}: ${owner.resourceKey}`);
    this.name = 'ResourceLeaseConflictError';
  }
}

function fileIdentity(stat: Stats | BigIntStats): FileObjectIdentity {
  const scalar = (value: number | bigint): number | string =>
    typeof value === 'bigint' ? value.toString() : value;
  return {
    dev: scalar(stat.dev),
    ino: scalar(stat.ino),
    birthtime: scalar(
      'birthtimeNs' in stat && typeof stat.birthtimeNs === 'bigint'
        ? stat.birthtimeNs
        : stat.birthtimeMs,
    ),
  };
}

async function readLease(file: string): Promise<ResourceLease | null> {
  try {
    const { bytes, stat } = await readFileRaceSafe(file, 64 * 1024, {
      bigint: true,
      label: 'resource lease',
    });
    const owner = JSON.parse(bytes.toString('utf8')) as ResourceLeaseOwner;
    if (
      owner.schemaVersion !== 1 ||
      typeof owner.leaseId !== 'string' ||
      typeof owner.resourceKey !== 'string' ||
      !Number.isSafeInteger(owner.pid) ||
      typeof owner.hostname !== 'string'
    ) {
      throw new Error(`Invalid resource lease: ${file}`);
    }
    return { file, owner, identity: fileIdentity(stat) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class FileResourceLeaseManager {
  constructor(private readonly workspace: string) {}

  leasePath(resourceKey: string): string {
    const digest = createHash('sha256').update(resourceKey).digest('hex');
    return path.join(this.workspace, '.repoctopus', 'runtime', 'leases', `${digest}.json`);
  }

  async acquire(resourceKey: string): Promise<ResourceLease> {
    const file = this.leasePath(resourceKey);
    await mkdir(path.dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const processIdentity = await readProcessIdentity(process.pid);
      const owner: ResourceLeaseOwner = {
        schemaVersion: 1,
        leaseId: randomUUID(),
        resourceKey,
        pid: process.pid,
        hostname: os.hostname(),
        createdAt: new Date().toISOString(),
        ...(processIdentity ? { processIdentity } : {}),
      };
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(file, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8');
        await handle.sync();
        return { file, owner, identity: fileIdentity(await handle.stat({ bigint: true })) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      } finally {
        await handle?.close();
      }
      const existing = await readLease(file);
      if (!existing) continue;
      const liveness =
        existing.owner.hostname === os.hostname()
          ? await inspectProcessLiveness(existing.owner.pid, existing.owner.processIdentity)
          : 'unknown';
      if (liveness !== 'dead') throw new ResourceLeaseConflictError(existing.owner);
      const quarantine = `${file}.${existing.owner.leaseId}.stale`;
      try {
        await renameWithRetry(file, quarantine);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const moved = await readLease(quarantine);
      if (
        moved?.owner.leaseId !== existing.owner.leaseId ||
        !sameFileObject(existing.identity, moved.identity)
      ) {
        if (!(await readLease(file))) await renameWithRetry(quarantine, file);
        throw new Error(`Resource lease changed during stale takeover: ${resourceKey}`);
      }
      await unlinkWithRetry(quarantine);
    }
    throw new Error(`Could not acquire resource lease: ${resourceKey}`);
  }

  async release(lease: ResourceLease): Promise<void> {
    const current = await readLease(lease.file);
    if (!current) return;
    if (
      current.owner.leaseId !== lease.owner.leaseId ||
      current.owner.resourceKey !== lease.owner.resourceKey ||
      !sameFileObject(current.identity, lease.identity)
    ) {
      throw new Error(`Resource lease ownership changed: ${lease.owner.resourceKey}`);
    }
    const quarantine = `${lease.file}.${lease.owner.leaseId}.release`;
    await renameWithRetry(lease.file, quarantine);
    const moved = await readLease(quarantine);
    if (
      moved?.owner.leaseId !== lease.owner.leaseId ||
      !sameFileObject(moved.identity, lease.identity)
    ) {
      if (!(await readLease(lease.file))) await renameWithRetry(quarantine, lease.file);
      throw new Error(`Resource lease changed during release: ${lease.owner.resourceKey}`);
    }
    await unlinkWithRetry(quarantine);
  }

  async rebind(
    lease: ResourceLease,
    owner: { pid: number; processIdentity: string },
  ): Promise<ResourceLease> {
    const current = await readLease(lease.file);
    if (
      !current ||
      current.owner.leaseId !== lease.owner.leaseId ||
      current.owner.resourceKey !== lease.owner.resourceKey ||
      !sameFileObject(current.identity, lease.identity)
    ) {
      throw new Error(`Resource lease ownership changed: ${lease.owner.resourceKey}`);
    }
    const rebound: ResourceLeaseOwner = {
      ...current.owner,
      pid: owner.pid,
      processIdentity: owner.processIdentity,
    };
    await atomicWriteJson(lease.file, rebound);
    const updated = await readLease(lease.file);
    if (!updated || updated.owner.leaseId !== rebound.leaseId) {
      throw new Error(`Resource lease disappeared during rebind: ${lease.owner.resourceKey}`);
    }
    return updated;
  }

  async isOwnedBy(lease: ResourceLease): Promise<boolean> {
    const current = await readLease(lease.file);
    return (
      current?.owner.leaseId === lease.owner.leaseId &&
      current.owner.resourceKey === lease.owner.resourceKey &&
      current.owner.pid === lease.owner.pid &&
      current.owner.processIdentity === lease.owner.processIdentity &&
      sameFileObject(current.identity, lease.identity)
    );
  }

  async withLease<T>(resourceKey: string, work: () => Promise<T>): Promise<T> {
    const lease = await this.acquire(resourceKey);
    try {
      return await work();
    } finally {
      await this.release(lease);
    }
  }

  async writeLeaseForRecovery(owner: ResourceLeaseOwner): Promise<void> {
    await atomicWriteJson(this.leasePath(owner.resourceKey), owner);
  }
}
