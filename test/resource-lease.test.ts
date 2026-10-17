import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';

import {
  FileResourceLeaseManager,
  ResourceLeaseConflictError,
} from '../platform/runtime/resource-lease.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('resource lease', () => {
  it('prevents concurrent ownership and permits acquisition after release', async () => {
    const workspace = await temporaryDirectory('repoctopus-lease-');
    cleanup.push(workspace);
    const manager = new FileResourceLeaseManager(workspace);
    const first = await manager.acquire('port:5173');
    await expect(manager.acquire('port:5173')).rejects.toBeInstanceOf(ResourceLeaseConflictError);
    await manager.release(first);
    const second = await manager.acquire('port:5173');
    expect(second.owner.leaseId).not.toBe(first.owner.leaseId);
    await manager.release(second);
  });

  it('takes over a lease only after its owner is proven dead', async () => {
    const workspace = await temporaryDirectory('repoctopus-stale-lease-');
    cleanup.push(workspace);
    const manager = new FileResourceLeaseManager(workspace);
    await manager.writeLeaseForRecovery({
      schemaVersion: 1,
      leaseId: 'stale-owner',
      resourceKey: 'browser:managed',
      pid: 999_999_999,
      hostname: os.hostname(),
      createdAt: '2000-01-01T00:00:00.000Z',
      processIdentity: 'dead:identity',
    });
    const acquired = await manager.acquire('browser:managed');
    expect(acquired.owner.leaseId).not.toBe('stale-owner');
    await manager.release(acquired);
  });
});
