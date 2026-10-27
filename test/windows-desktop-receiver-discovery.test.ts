import { promises as fs } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopOtlpHttpReceiver } from '../app/desktop/host/otlp-http-receiver.js';
import {
  WindowsDesktopReceiverDiscovery,
  type DesktopDiscoverySecurity,
} from '../platform/desktop/windows-receiver-discovery.js';
import type { ProcessOwnership } from '../platform/process/process-identity.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const roots: string[] = [];
const receivers: DesktopOtlpHttpReceiver[] = [];

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((receiver) => receiver.stop()));
  await Promise.all(roots.splice(0).map((root) => removeTemporaryDirectory(root)));
});

class SecurityFixture implements DesktopDiscoverySecurity {
  owner = true;
  listeningPid: number | null = 4_242;

  secureDirectory(): Promise<void> {
    return Promise.resolve();
  }

  secureFile(): Promise<void> {
    return Promise.resolve();
  }

  isCurrentUserOwner(): Promise<boolean> {
    return Promise.resolve(this.owner);
  }

  listeningProcessId(): Promise<number | null> {
    return Promise.resolve(this.listeningPid);
  }
}

async function fixture() {
  const root = await temporaryDirectory('repoctopus-desktop-discovery-');
  roots.push(root);
  const security = new SecurityFixture();
  let ownership: ProcessOwnership = 'matched';
  let now = Date.now();
  const discovery = new WindowsDesktopReceiverDiscovery({
    root,
    platform: 'win32',
    pid: 4_242,
    maxAgeMs: 45_000,
    now: () => now,
    readIdentity: () => Promise.resolve('win32-test:host-creation-time'),
    inspectOwnership: () => Promise.resolve(ownership),
    security,
  });
  const receiver = new DesktopOtlpHttpReceiver({
    sessionToken: 'legitimate-session-token-with-enough-entropy',
    onExport: () => undefined,
  });
  receivers.push(receiver);
  const endpoint = await receiver.start();
  const connection = {
    schemaVersion: 1 as const,
    endpoint,
    sessionToken: 'legitimate-session-token-with-enough-entropy',
  };
  const handle = await discovery.publish(connection);
  return {
    discovery,
    handle,
    receiver,
    security,
    connection,
    setOwnership: (next: ProcessOwnership) => {
      ownership = next;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe('Windows Desktop Receiver discovery', () => {
  it('returns a credential only after owner, freshness, process and port validation', async () => {
    const test = await fixture();

    await expect(test.discovery.discover()).resolves.toEqual({
      status: 'available',
      connection: test.connection,
    });

    test.security.owner = false;
    const forged = await test.discovery.discover();
    expect(forged).toEqual({ status: 'unavailable', reason: 'wrong-owner' });
    expect(JSON.stringify(forged)).not.toContain(test.connection.sessionToken);

    test.security.owner = true;
    test.setOwnership('not_running');
    await expect(test.discovery.discover()).resolves.toEqual({
      status: 'unavailable',
      reason: 'process-mismatch',
    });

    test.setOwnership('matched');
    test.security.listeningPid = 9_999;
    await expect(test.discovery.discover()).resolves.toEqual({
      status: 'unavailable',
      reason: 'port-owner-mismatch',
    });

    test.security.listeningPid = 4_242;
    test.advance(45_001);
    await expect(test.discovery.discover()).resolves.toEqual({
      status: 'unavailable',
      reason: 'stale',
    });
  });

  it('does not let a wrong credential mutate projection state or leak either credential', async () => {
    const test = await fixture();
    const before = test.receiver.snapshot();
    const response = await fetch(`${test.connection.endpoint}/v1/logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-repoctopus-session': 'wrong-session-token-with-enough-entropy',
      },
      body: JSON.stringify({ resourceLogs: [] }),
    });

    expect(response.status).toBe(401);
    expect(test.receiver.snapshot()).toEqual({
      ...before,
      rejectedCount: before.rejectedCount + 1,
    });
    expect(JSON.stringify(test.receiver.snapshot())).not.toContain(test.connection.sessionToken);
    expect(JSON.stringify(test.receiver.snapshot())).not.toContain('wrong-session-token');
  });

  it('refreshes and removes only the publishing Host instance', async () => {
    const test = await fixture();
    test.advance(10_000);
    await test.discovery.refresh(test.handle);
    await expect(test.discovery.discover()).resolves.toMatchObject({ status: 'available' });

    const forgedHandle = { ...test.handle, instanceId: '00000000-0000-4000-8000-000000000000' };
    await test.discovery.remove(forgedHandle);
    await expect(fs.stat(test.discovery.file)).resolves.toBeDefined();

    await test.discovery.remove(test.handle);
    await expect(fs.stat(test.discovery.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
