import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('Evidence OTLP export', () => {
  it('exports trace, log and metric signals after local Evidence is durable', async () => {
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
    if (!address || typeof address === 'string') throw new Error('OTLP fixture did not bind');

    const root = await temporaryDirectory('repoctopus-evidence-otlp-');
    cleanup.push(root);
    await createGitRepository(root, 'app');
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    const config: SharedProjectConfig = {
      apiVersion: 'repoctopus/v1alpha1',
      kind: 'RepoctopusWorkspace',
      workspace: { id: 'otlp-evidence', repositoryId: 'workspace' },
      repositories: [
        { id: 'workspace', path: '.' },
        { id: 'app', path: '../app' },
      ],
      profiles: [
        {
          id: 'verify',
          nodes: [
            {
              id: 'build',
              type: 'command',
              repository: 'app',
              dependsOn: [],
              required: true,
              executable: process.execPath,
              args: ['-e', "process.stdout.write('ok')"],
              timeoutMs: 5000,
              cache: false,
            },
          ],
        },
      ],
    };
    await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
    const workflowFile = path.join(workspace, 'evidence-workflow.yaml');
    await writeFile(
      workflowFile,
      `apiVersion: repoctopus/v1alpha1
kind: Workflow
metadata:
  name: evidence-telemetry
  version: 1.0.0
  description: Evidence telemetry binding fixture
entry: verify
steps:
  - id: verify
    action:
      type: checkpoint
      ref: verified
      summary: Verify the fixture
      evidenceProfile: verify
    onSuccess: null
guardrails:
  allowedActionTypes: [checkpoint]
  allowedRefs: [verified]
  confirmationRequiredFor: []
  maxIterations: 2
  maxRetriesPerAction: 1
`,
    );

    try {
      await runCli({
        packageRoot,
        cwd: workspace,
        args: [
          'run',
          'start',
          '--workspace',
          workspace,
          '--project-root',
          root,
          '--workflow',
          workflowFile,
          '--run',
          'workflow-run-otlp',
        ],
      });
      const pending = await runCli({
        packageRoot,
        cwd: workspace,
        args: ['run', 'next', '--workspace', workspace, '--run', 'workflow-run-otlp'],
      });
      expect(pending.nextActions).toContain(
        'repoctopus run record --run <run-id> --action <action-id> --status succeeded --summary <text> --evidence-attempt <attempt-id>',
      );
      const result = await runCli({
        packageRoot,
        cwd: workspace,
        environment: {
          ...process.env,
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        },
        args: [
          'evidence',
          'run',
          '--workspace',
          workspace,
          '--profile',
          'verify',
          '--workflow-run',
          'workflow-run-otlp',
        ],
      });
      expect(result).toMatchObject({
        ok: true,
        result: {
          bundle: { outcome: 'passed' },
          telemetry: { status: 'exported' },
        },
      });
      expect(new Set(paths)).toEqual(new Set(['/v1/traces', '/v1/logs', '/v1/metrics']));
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30_000);
});
