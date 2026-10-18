import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalServiceAdapter } from '../platform/feedback/service-adapter.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
const servers: Array<http.Server> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
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

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('service feedback', () => {
  it('starts, observes and stops an owned managed service', async () => {
    const workspace = await temporaryDirectory('repoctopus-managed-service-');
    cleanup.push(workspace);
    const port = await freePort();
    const script = `
      const http = require('node:http');
      http.createServer((request, response) => {
        response.writeHead(request.url === '/health' ? 200 : 404, {'content-type':'application/json'});
        response.end(JSON.stringify({status:'UP'}));
      }).listen(${port}, '127.0.0.1', () => console.log('READY'));
    `;
    const session = await new LocalServiceAdapter(workspace).startManaged({
      serviceId: 'api',
      executable: process.execPath,
      args: ['-e', script],
      cwd: workspace,
      startupTimeoutMs: 5000,
      probeIntervalMs: 25,
      resourceKeys: [`port:${port}`],
      readiness: [
        { type: 'tcp', host: '127.0.0.1', port },
        {
          type: 'http',
          url: `http://127.0.0.1:${port}/health`,
          jsonPath: 'status',
          equals: 'UP',
        },
        { type: 'log', pattern: 'READY', stream: 'stdout' },
      ],
    });
    const ready = await session.waitUntilReady();
    expect(ready).toMatchObject({ status: 'ready', trust: 'verified', mode: 'managed' });
    expect(ready.probes.some((probe) => probe.type === 'http' && probe.ok)).toBe(true);
    expect(await canConnect(port)).toBe(true);
    await session.stop();
    for (let attempt = 0; attempt < 20 && (await canConnect(port)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await canConnect(port)).toBe(false);
  });

  it('does not treat an open port as healthy when HTTP health fails', async () => {
    const workspace = await temporaryDirectory('repoctopus-attached-health-');
    cleanup.push(workspace);
    const server = http.createServer((_request, response) => {
      response.writeHead(503).end('not ready');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const observation = await new LocalServiceAdapter(workspace).observeAttached({
      serviceId: 'external',
      startupTimeoutMs: 100,
      probeIntervalMs: 20,
      readiness: [
        { type: 'tcp', host: '127.0.0.1', port },
        { type: 'http', url: `http://127.0.0.1:${port}/health` },
      ],
    });
    expect(observation.status).toBe('timed_out');
    expect(observation.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tcp', ok: true }),
        expect.objectContaining({ type: 'http', ok: false }),
      ]),
    );
    expect(server.listening).toBe(true);
  });

  it('upgrades attached evidence only when build identity matches', async () => {
    const workspace = await temporaryDirectory('repoctopus-attached-identity-');
    cleanup.push(workspace);
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify(request.url === '/identity' ? { build: 'fingerprint' } : { status: 'UP' }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const adapter = new LocalServiceAdapter(workspace);
    const observed = await adapter.observeAttached({
      serviceId: 'external',
      startupTimeoutMs: 1000,
      readiness: [{ type: 'http', url: `http://127.0.0.1:${port}/health` }],
    });
    expect(observed.trust).toBe('observed');
    const verified = await adapter.observeAttached({
      serviceId: 'external',
      startupTimeoutMs: 1000,
      readiness: [{ type: 'http', url: `http://127.0.0.1:${port}/health` }],
      buildIdentity: {
        url: `http://127.0.0.1:${port}/identity`,
        jsonPath: 'build',
        expected: 'fingerprint',
      },
    });
    expect(verified.trust).toBe('verified');
    expect(verified.buildIdentity).toEqual({
      expected: 'fingerprint',
      actual: 'fingerprint',
      matched: true,
    });
    expect(server.listening).toBe(true);
  });
});
