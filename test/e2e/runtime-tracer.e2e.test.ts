import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  commitGitRepository,
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('multi-process runtime and OTLP delivery', () => {
  it('resumes a durable run, reports content drift and exports all OTLP signals', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? '');
      request.resume();
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OTLP test server did not bind');

    const root = await temporaryDirectory('repoctopus-tracer-');
    cleanup.push(root);
    const project = path.join(root, 'project');
    const workspace = await createGitRepository(project, 'workspace');
    const front = await createGitRepository(project, 'front');
    await createGitRepository(project, 'backend');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'runtime-tracer', repositoryId: 'workspace' },
        repositories: [
          { id: 'workspace', path: '.' },
          { id: 'front', path: '../front' },
          { id: 'backend', path: '../backend' },
        ],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'front',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await commitGitRepository(workspace, 'chore: configure runtime workspace');
    const environment = {
      ...process.env,
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      REPOCTOPUS_ENVIRONMENT: 'e2e',
      REPOCTOPUS_OTLP_DIAGNOSTICS: 'full',
    };

    try {
      const started = await runCli({
        packageRoot: repositoryRoot,
        cwd: workspace,
        environment,
        args: ['run', 'start', '--workspace', workspace, '--run', 'run-e2e-runtime'],
      });
      expect(started).toMatchObject({ protocolVersion: 1, ok: true, runId: 'run-e2e-runtime' });
      const proposed = await runCli<{ state: { pendingActionId: string } }>({
        packageRoot: repositoryRoot,
        cwd: workspace,
        environment,
        args: ['run', 'next', '--workspace', workspace, '--run', 'run-e2e-runtime'],
      });
      const actionId = proposed.result!.state.pendingActionId;
      const recorded = await runCli({
        packageRoot: repositoryRoot,
        cwd: workspace,
        environment,
        args: [
          'run',
          'record',
          '--workspace',
          workspace,
          '--run',
          'run-e2e-runtime',
          '--action',
          actionId,
          '--status',
          'succeeded',
          '--summary',
          'first process completed',
          '--event-id',
          'event-e2e-recorded',
        ],
      });
      expect(recorded.ok).toBe(true);

      await writeFile(path.join(front, 'changed.txt'), 'worktree changed');
      const resumed = await runCli<{
        state: { reconciliationRequired: boolean };
        reconciliation: {
          changed: boolean;
          changeClass: 'same' | 'content' | 'identity';
          requiresReconciliation: boolean;
        };
      }>({
        packageRoot: repositoryRoot,
        cwd: workspace,
        environment,
        args: ['run', 'resume', '--workspace', workspace, '--run', 'run-e2e-runtime'],
      });
      expect(resumed.result).toMatchObject({
        state: { reconciliationRequired: false },
        reconciliation: {
          changed: true,
          changeClass: 'content',
          requiresReconciliation: false,
        },
      });
      const doctor = await runCli({
        packageRoot: repositoryRoot,
        cwd: workspace,
        environment,
        args: ['doctor', '--workspace', workspace, '--run', 'run-e2e-runtime'],
      });
      expect(doctor.result).toMatchObject({ healthy: true, telemetryBacklog: 0 });
      expect(new Set(paths)).toEqual(new Set(['/v1/traces', '/v1/logs', '/v1/metrics']));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 120_000);
});
