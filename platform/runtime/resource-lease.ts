import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { atomicWriteJson } from '../filesystem/atomic-write.js';
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
}

export class ResourceLeaseConflictError extends Error {
  constructor(readonly owner: ResourceLeaseOwner) {
    super(`Resource lease is held by pid ${owner.pid}: ${owner.resourceKey}`);
    this.name = 'ResourceLeaseConflictError';
  }
}

async function readOwner(file: string): Promise<ResourceLeaseOwner | null> {
  try {
    const bytes = await readFile(file);
    if (bytes.byteLength > 64 * 1024) throw new Error(`Resource lease is too large: ${file}`);
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
    return owner;
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
        return { file, owner };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      } finally {
        await handle?.close();
      }
      const existing = await readOwner(file);
      if (!existing) continue;
      const liveness =
        existing.hostname === os.hostname()
          ? await inspectProcessLiveness(existing.pid, existing.processIdentity)
          : 'unknown';
      if (liveness !== 'dead') throw new ResourceLeaseConflictError(existing);
      const quarantine = `${file}.${existing.leaseId}.stale`;
      try {
        await rename(file, quarantine);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const moved = await readOwner(quarantine);
      if (moved?.leaseId !== existing.leaseId) {
        if (!(await readOwner(file))) await rename(quarantine, file);
        throw new Error(`Resource lease changed during stale takeover: ${resourceKey}`);
      }
      await rm(quarantine, { force: true });
    }
    throw new Error(`Could not acquire resource lease: ${resourceKey}`);
  }

  async release(lease: ResourceLease): Promise<void> {
    const current = await readOwner(lease.file);
    if (!current) return;
    if (
      current.leaseId !== lease.owner.leaseId ||
      current.resourceKey !== lease.owner.resourceKey
    ) {
      throw new Error(`Resource lease ownership changed: ${lease.owner.resourceKey}`);
    }
    const quarantine = `${lease.file}.${lease.owner.leaseId}.release`;
    await rename(lease.file, quarantine);
    const moved = await readOwner(quarantine);
    if (moved?.leaseId !== lease.owner.leaseId) {
      if (!(await readOwner(lease.file))) await rename(quarantine, lease.file);
      throw new Error(`Resource lease changed during release: ${lease.owner.resourceKey}`);
    }
    await rm(quarantine, { force: true });
  }

  async rebind(
    lease: ResourceLease,
    owner: { pid: number; processIdentity: string },
  ): Promise<ResourceLease> {
    const current = await readOwner(lease.file);
    if (
      !current ||
      current.leaseId !== lease.owner.leaseId ||
      current.resourceKey !== lease.owner.resourceKey
    ) {
      throw new Error(`Resource lease ownership changed: ${lease.owner.resourceKey}`);
    }
    const rebound: ResourceLeaseOwner = {
      ...current,
      pid: owner.pid,
      processIdentity: owner.processIdentity,
    };
    await atomicWriteJson(lease.file, rebound);
    return { file: lease.file, owner: rebound };
  }

  async isOwnedBy(lease: ResourceLease): Promise<boolean> {
    const current = await readOwner(lease.file);
    return (
      current?.leaseId === lease.owner.leaseId &&
      current.resourceKey === lease.owner.resourceKey &&
      current.pid === lease.owner.pid &&
      current.processIdentity === lease.owner.processIdentity
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
