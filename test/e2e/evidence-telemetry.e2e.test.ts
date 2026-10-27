import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SharedProjectConfig } from '../../domains/project-configuration/types.js';
import type { EvidenceTelemetryBatch } from '../../domains/evidence/telemetry.js';
import { OpenTelemetryEvidenceExporter } from '../../platform/telemetry/opentelemetry/evidence-exporter.js';
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
  it('uses controlled Evidence boundaries instead of zero-length attempt and node Spans', async () => {
    const requests: Array<{ path: string; body: Buffer }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OTLP fixture did not bind');
    const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
    try {
      const batch: EvidenceTelemetryBatch = {
        schemaVersion: 1,
        runId: 'run-controlled',
        attemptId: 'attempt-controlled',
        profileId: 'verify',
        compositionDigest: `sha256:${'a'.repeat(64)}`,
        events: [
          {
            schemaVersion: 1,
            sequence: 1,
            eventId: 'attempt-started',
            type: 'evidence.attempt.started',
            timestamp: '2026-01-01T00:00:01.000Z',
            runId: 'run-controlled',
            attemptId: 'attempt-controlled',
            data: { profileId: 'verify' },
          },
          {
            schemaVersion: 1,
            sequence: 2,
            eventId: 'node-completed',
            type: 'evidence.node.completed',
            timestamp: '2026-01-01T00:00:07.000Z',
            runId: 'run-controlled',
            attemptId: 'attempt-controlled',
            data: { nodeId: 'tests', adapter: 'command', status: 'passed', durationMs: 4_000 },
          },
          {
            schemaVersion: 1,
            sequence: 3,
            eventId: 'attempt-completed',
            type: 'evidence.attempt.completed',
            timestamp: '2026-01-01T00:00:10.000Z',
            runId: 'run-controlled',
            attemptId: 'attempt-controlled',
            data: { status: 'completed', durationMs: 9_000 },
          },
        ],
      };
      await new OpenTelemetryEvidenceExporter({ timeoutMillis: 5_000 }).export(batch);
      const spans = requests
        .filter((request) => request.path === '/v1/traces')
        .flatMap((request) => {
          const body = JSON.parse(request.body.toString('utf8')) as {
            resourceSpans?: Array<{
              scopeSpans?: Array<{
                spans?: Array<{
                  name?: string;
                  startTimeUnixNano?: string;
                  endTimeUnixNano?: string;
                }>;
              }>;
            }>;
          };
          return (body.resourceSpans ?? []).flatMap((resource) =>
            (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? []),
          );
        });
      const duration = (name: string) => {
        const span = spans.find((candidate) => candidate.name === name)!;
        return BigInt(span.endTimeUnixNano!) - BigInt(span.startTimeUnixNano!);
      };
      expect(duration('repoctopus.evidence.node')).toBe(4_000_000_000n);
      expect(duration('repoctopus.evidence.attempt')).toBe(9_000_000_000n);
      expect(Buffer.concat(requests.map((request) => request.body)).toString('latin1')).toContain(
        'repoctopus.evidence.attempt.duration',
      );
    } finally {
      if (previous === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

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
    await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
    await commitGitRepository(workspace, 'chore: configure evidence workspace');

    try {
      await runCli({
        packageRoot,
        cwd: workspace,
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
