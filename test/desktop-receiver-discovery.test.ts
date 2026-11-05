import { mkdtemp, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DesktopReceiverDiscovery,
  resolveDesktopReceiverDiscoveryRoot,
  type DesktopDiscoverySecurity,
} from '../app/desktop/host/receiver-discovery.js';
import { DesktopOtlpHttpReceiver } from '../app/desktop/host/otlp-http-receiver.js';
import type { ProcessOwnership } from '../platform/process/process-identity.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

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
  const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-discovery-'));
  roots.push(root);
  const security = new SecurityFixture();
  let ownership: ProcessOwnership = 'matched';
  let now = Date.now();
  const discovery = new DesktopReceiverDiscovery({
    root,
    platform: 'win32',
    pid: 4_242,
    maxAgeMs: 45_000,
    now: () => now,
    readIdentity: () => Promise.resolve('win32:test-process-identity'),
    inspectOwnership: () => Promise.resolve(ownership),
    security,
  });
  const connection = {
    schemaVersion: 1 as const,
    endpoint: 'http://127.0.0.1:43191',
    sessionToken: 'valid-session-token-with-at-least-32-characters',
  };
  const handle = await discovery.publish(connection);
  return {
    discovery,
    connection,
    handle,
    security,
    setOwnership: (value: ProcessOwnership) => {
      ownership = value;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe('desktop receiver discovery', () => {
  it('uses the same LocalAppData root for the Runtime probe and Desktop publisher', () => {
    expect(
      resolveDesktopReceiverDiscoveryRoot({ LOCALAPPDATA: 'C:\\Users\\worker\\AppData\\Local' }),
    ).toBe('C:\\Users\\worker\\AppData\\Local\\Repoctopus\\discovery');
    expect(
      resolveDesktopReceiverDiscoveryRoot({
        LOCALAPPDATA: 'C:\\ignored',
        REPOCTOPUS_DESKTOP_DISCOVERY_ROOT: 'D:\\Repoctopus\\..\\receiver\\.',
      }),
    ).toBe('D:\\receiver');
    expect(() =>
      resolveDesktopReceiverDiscoveryRoot({
        LOCALAPPDATA: 'C:\\Users\\worker\\AppData\\Local',
        REPOCTOPUS_DESKTOP_DISCOVERY_ROOT: 'relative',
      }),
    ).toThrow('REPOCTOPUS_DESKTOP_DISCOVERY_ROOT must be an absolute path');
    expect(() => resolveDesktopReceiverDiscoveryRoot({ LOCALAPPDATA: 'relative' })).toThrow(
      'LOCALAPPDATA is required for Windows Desktop discovery',
    );
  });

  it('exposes a credential only after owner, freshness, process and port checks', async () => {
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

  it('refreshes and removes only the publishing Host instance', async () => {
    const test = await fixture();
    test.advance(10_000);
    await test.discovery.refresh(test.handle);
    await expect(test.discovery.discover()).resolves.toMatchObject({ status: 'available' });

    await test.discovery.remove({
      ...test.handle,
      instanceId: '00000000-0000-4000-8000-000000000000',
    });
    await expect(stat(test.discovery.file)).resolves.toBeDefined();
    await test.discovery.remove(test.handle);
    await expect(stat(test.discovery.file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.runIf(process.platform === 'win32')(
    'validates the real Windows owner, process identity and listening port',
    async ({ skip }) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-discovery-real-'));
      roots.push(root);
      const token = 'real-windows-session-token-with-at-least-32-characters';
      const receiver = new DesktopOtlpHttpReceiver({
        sessionToken: token,
        onExport: () => undefined,
      });
      const endpoint = await receiver.start();
      const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
      const netstat = await promisify(execFile)(
        path.join(systemRoot, 'System32', 'netstat.exe'),
        ['-ano', '-p', 'tcp'],
        { windowsHide: true },
      );
      if (!netstat.stdout.includes(`127.0.0.1:${new URL(endpoint).port}`)) {
        await receiver.stop();
        skip('The execution environment does not expose Node sockets in the Windows owner table');
        return;
      }
      const discovery = new DesktopReceiverDiscovery({ root });
      try {
        const handle = await discovery.publish({ schemaVersion: 1, endpoint, sessionToken: token });
        await expect(discovery.discover()).resolves.toEqual({
          status: 'available',
          connection: { schemaVersion: 1, endpoint, sessionToken: token },
        });
        const unauthorized = await fetch(`${endpoint}/v1/logs`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer incorrect-session-token-value',
            'content-type': 'application/json',
          },
          body: '{"resourceLogs":[]}',
        });
        expect(unauthorized.status).toBe(401);
        await discovery.remove(handle);
      } finally {
        await receiver.stop();
      }
    },
    20_000,
  );
});
