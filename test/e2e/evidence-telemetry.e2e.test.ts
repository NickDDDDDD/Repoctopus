import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import {
  commitGitRepository,
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('Evidence OTLP export', () => {
  it.each(['environment', 'workspace YAML'] as const)(
    'exports trace, log and metric signals using %s',
    async (source) => {
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
      const workspace = await createGitRepository(root, 'workspace');
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
      const base = `http://127.0.0.1:${address.port}`;
      const workspaceConfig =
        source === 'workspace YAML'
          ? { ...config, telemetry: { endpoint: `${base}/otel/` } }
          : config;
      await writeFile(path.join(workspace, 'repoctopus.yaml'), stringify(workspaceConfig));
      const environment = {
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: undefined,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: undefined,
      };
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
      await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
      await commitGitRepository(workspace, 'chore: configure evidence workspace');

      try {
        await runCli({
          packageRoot,
          cwd: workspace,
          environment,
          args: [
            'run',
            'start',
            '--workspace',
            workspace,
            '--workflow',
            workflowFile,
            '--run',
            'workflow-run-otlp',
          ],
        });
        const pending = await runCli({
          packageRoot,
          cwd: workspace,
          environment,
          args: ['run', 'next', '--workspace', workspace, '--run', 'workflow-run-otlp'],
        });
        expect(pending.nextActions).toContain(
          'repoctopus run record --run <run-id> --action <action-id> --status succeeded --summary <text> --evidence-attempt <attempt-id>',
        );
        const result = await runCli({
          packageRoot,
          cwd: workspace,
          environment: {
            ...environment,
            OTEL_EXPORTER_OTLP_ENDPOINT: source === 'environment' ? base : undefined,
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
        const prefix = source === 'workspace YAML' ? '/otel' : '';
        expect(new Set(paths)).toEqual(
          new Set([`${prefix}/v1/traces`, `${prefix}/v1/logs`, `${prefix}/v1/metrics`]),
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    30_000,
  );
});
