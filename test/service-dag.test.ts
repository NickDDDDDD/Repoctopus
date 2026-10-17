import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { ManagedServiceDagRun, ManagedServiceNode } from '../domains/feedback/service-dag.js';
import { LocalServiceAdapter } from '../platform/feedback/service-adapter.js';
import { ManagedServiceDagRunner } from '../platform/feedback/service-dag-runner.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
const runs: ManagedServiceDagRun[] = [];
afterEach(async () => {
  await Promise.allSettled(runs.splice(0).map((run) => run.close()));
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

function serverNode(input: {
  id: string;
  port: number;
  cwd: string;
  dependsOn?: readonly string[];
  healthy?: boolean;
}): ManagedServiceNode {
  const healthy = input.healthy ?? true;
  const script = healthy
    ? `require('node:http').createServer((_q,r)=>r.end('ok')).listen(${input.port},'127.0.0.1')`
    : 'setInterval(() => {}, 1000)';
  return {
    id: input.id,
    dependsOn: input.dependsOn ?? [],
    request: {
      serviceId: input.id,
      executable: process.execPath,
      args: ['-e', script],
      cwd: input.cwd,
      startupTimeoutMs: healthy ? 3000 : 100,
      probeIntervalMs: 20,
      resourceKeys: [`port:${input.port}`],
      readiness: [{ type: 'tcp', host: '127.0.0.1', port: input.port }],
    },
  };
}

describe('managed service DAG', () => {
  it('starts independent branches, blocks only failed dependents and cleans up in reverse order', async () => {
    const workspace = await temporaryDirectory('repoctopus-service-dag-');
    cleanup.push(workspace);
    const [frontPort, backendPort, dependentPort] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
    ]);
    const run = await new ManagedServiceDagRunner(new LocalServiceAdapter(workspace)).run([
      serverNode({ id: 'front', port: frontPort, cwd: workspace, healthy: false }),
      serverNode({ id: 'backend', port: backendPort, cwd: workspace }),
      serverNode({
        id: 'browser-fixture',
        port: dependentPort,
        cwd: workspace,
        dependsOn: ['front'],
      }),
    ]);
    runs.push(run);

    expect(run.results.get('front')?.status).toBe('timed_out');
    expect(run.results.get('browser-fixture')).toEqual({
      nodeId: 'browser-fixture',
      status: 'blocked',
      blockedBy: ['front'],
    });
    expect(run.results.get('backend')?.status).toBe('ready');
    expect([...run.sessions.keys()]).toEqual(['backend']);
    expect((await run.close()).map((observation) => observation.serviceId)).toEqual(['backend']);
  });

  it('keeps dependencies alive and stops dependents before their providers', async () => {
    const workspace = await temporaryDirectory('repoctopus-service-order-');
    cleanup.push(workspace);
    const [apiPort, appPort] = await Promise.all([freePort(), freePort()]);
    const run = await new ManagedServiceDagRunner(new LocalServiceAdapter(workspace)).run([
      serverNode({ id: 'api', port: apiPort, cwd: workspace }),
      serverNode({ id: 'app', port: appPort, cwd: workspace, dependsOn: ['api'] }),
    ]);
    runs.push(run);
    expect([...run.results.values()].map((result) => result.status)).toEqual(['ready', 'ready']);
    expect((await run.close()).map((observation) => observation.serviceId)).toEqual(['app', 'api']);
  });
});
