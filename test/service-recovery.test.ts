import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { ManagedServiceSession } from '../domains/feedback/service.js';
import { LocalServiceAdapter } from '../platform/feedback/service-adapter.js';
import { ManagedServiceRegistry } from '../platform/feedback/managed-service-registry.js';
import { inspectProcessOwnership } from '../platform/process/process-identity.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
const sessions: ManagedServiceSession[] = [];

afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map((session) => session.stop()));
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('managed service recovery', () => {
  it('records an early exit and releases all owned resources', async () => {
    const workspace = await temporaryDirectory('repoctopus-service-exit-');
    cleanup.push(workspace);
    const adapter = new LocalServiceAdapter(workspace);
    const session = await adapter.startManaged({
      serviceId: 'early-exit',
      executable: process.execPath,
      args: ['-e', "setTimeout(() => process.exit(7), 150); console.log('STARTED')"],
      cwd: workspace,
      startupTimeoutMs: 2000,
      probeIntervalMs: 25,
      readiness: [{ type: 'log', pattern: 'NEVER_READY' }],
    });
    sessions.push(session);
    const observation = await session.waitUntilReady();
    expect(observation.status).toBe('failed');
    expect(observation.exitCode).toBe(7);
    await session.stop();
    expect(await adapter.recoverManaged('early-exit')).toMatchObject({ status: 'not_found' });
  });

  it('times out and stops a process that never becomes ready', async () => {
    const workspace = await temporaryDirectory('repoctopus-service-timeout-');
    cleanup.push(workspace);
    const adapter = new LocalServiceAdapter(workspace);
    const session = await adapter.startManaged({
      serviceId: 'timeout',
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: workspace,
      startupTimeoutMs: 80,
      probeIntervalMs: 20,
      readiness: [{ type: 'log', pattern: 'NEVER_READY' }],
    });
    sessions.push(session);
    expect((await session.waitUntilReady()).status).toBe('timed_out');
    const serviceProcess = session.snapshot().process!;
    await session.stop();
    expect(await inspectProcessOwnership(serviceProcess.pid, serviceProcess.identity!)).toBe(
      'not_running',
    );
  });

  it('recovers an interrupted managed service only when its leases and identity match', async () => {
    const workspace = await temporaryDirectory('repoctopus-service-recover-');
    cleanup.push(workspace);
    const port = await freePort();
    const script = `
      require('node:http').createServer((_request, response) => response.end('ok'))
        .listen(${port}, '127.0.0.1', () => console.log('READY'));
    `;
    const owner = new LocalServiceAdapter(workspace);
    const session = await owner.startManaged({
      serviceId: 'recoverable',
      executable: process.execPath,
      args: ['-e', script],
      cwd: workspace,
      startupTimeoutMs: 3000,
      probeIntervalMs: 25,
      resourceKeys: [`port:${port}`],
      readiness: [{ type: 'tcp', host: '127.0.0.1', port }],
    });
    sessions.push(session);
    expect((await session.waitUntilReady()).status).toBe('ready');
    const serviceProcess = session.snapshot().process!;

    const recovered = await new LocalServiceAdapter(workspace).recoverManaged('recoverable');
    expect(recovered.process).toEqual(serviceProcess);
    if (recovered.status === 'orphan') {
      expect(recovered.diagnostic).toBe('Process identity could not be verified');
      expect(
        ['matched', 'unknown'],
        'An unverifiable recovered process must remain alive for its original owner to clean up',
      ).toContain(await inspectProcessOwnership(serviceProcess.pid, serviceProcess.identity!));
      await session.stop();
    } else {
      expect(recovered.status, recovered.diagnostic).toBe('terminated');
      expect(await inspectProcessOwnership(serviceProcess.pid, serviceProcess.identity!)).toBe(
        'not_running',
      );
    }
    expect(await new ManagedServiceRegistry(workspace).load('recoverable')).toBeNull();
  });

  it('reports an orphan and refuses to kill a reused or mismatched PID', async () => {
    const workspace = await temporaryDirectory('repoctopus-service-orphan-');
    cleanup.push(workspace);
    const owner = new LocalServiceAdapter(workspace);
    const session = await owner.startManaged({
      serviceId: 'identity-mismatch',
      executable: process.execPath,
      args: ['-e', "console.log('READY'); setInterval(() => {}, 1000)"],
      cwd: workspace,
      startupTimeoutMs: 3000,
      probeIntervalMs: 25,
      readiness: [{ type: 'log', pattern: 'READY' }],
    });
    sessions.push(session);
    expect((await session.waitUntilReady()).status).toBe('ready');
    const registry = new ManagedServiceRegistry(workspace);
    const registration = (await registry.load('identity-mismatch'))!;
    await registry.save({ ...registration, processIdentity: 'reused:identity' });

    const recovered = await new LocalServiceAdapter(workspace).recoverManaged('identity-mismatch');
    expect(recovered).toMatchObject({ status: 'orphan' });
    const serviceProcess = session.snapshot().process!;
    expect(await inspectProcessOwnership(serviceProcess.pid, serviceProcess.identity!)).toBe(
      'matched',
    );
  });
});
