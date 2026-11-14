import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';

import { startRun } from '../../domains/engine/loop.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import { ObservationDelivery } from '../../services/observation-delivery.js';
import { WorkflowObservationTelemetry } from '../../services/observation-telemetry.js';
import { compositionFixture, projectFixture, workflowFixture } from '../helpers/fixtures.js';

function event(
  sequence: number,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `managed-event-${sequence}`,
    timestamp: `2026-10-25T00:00:0${sequence}.000Z`,
    type,
    runId: 'run-managed-otlp',
    stateVersion: sequence,
    compositionDigest: compositionFixture().compositionDigest,
    data,
  };
}

describe('managed execution OTLP protocol', () => {
  it('exports replay-stable traces, logs and metrics without execution content', async () => {
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
    if (!address || typeof address === 'string') throw new Error('OTLP receiver did not bind');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-managed-otlp-'));
    const context = new Context();
    try {
      const workflow = workflowFixture();
      const projectSnapshot = projectFixture();
      const run = {
        ...startRun({
          workflow,
          runId: 'run-managed-otlp',
          projectSnapshotDigest: projectSnapshot.digest,
          composition: compositionFixture(),
          timestamp: '2026-10-25T00:00:00.000Z',
        }),
        traceId: '0123456789abcdef0123456789abcdef',
      };
      const secret = 'SECRET-PROMPT-DO-NOT-EXPORT';
      const trajectory = [
        event(1, 'run.started', {}),
        event(2, 'work.claimed', {
          phase: 'build',
          workKind: 'build.execute',
          buildAction: 'execute',
          executionMode: 'subagent-driven-development',
          tddMode: 'tdd',
          isolation: 'worktree',
          workId: 'build.execute:1.1',
          attempt: 1,
          packetDigest: `sha256:${'a'.repeat(64)}`,
          prompt: secret,
          command: `echo ${secret}`,
          path: `C:\\secret\\${secret}.txt`,
          url: `https://example.invalid/${secret}`,
        }),
        event(3, 'work.host-started', {
          phase: 'build',
          workKind: 'build.execute',
          buildAction: 'execute',
          executionMode: 'subagent-driven-development',
          tddMode: 'tdd',
          isolation: 'worktree',
          workId: 'build.execute:1.1',
          attempt: 1,
          invocationId: 'invocation-1',
          hostId: 'host-1',
        }),
        event(4, 'tool.started', {
          operationId: 'operation-1',
          invocationId: 'invocation-1',
          operationKind: 'repository.write',
          arguments: secret,
        }),
        event(5, 'tool.completed', {
          operationId: 'operation-1',
          invocationId: 'invocation-1',
          operationKind: 'repository.write',
          result: 'succeeded',
        }),
        event(6, 'work.host-completed', {
          phase: 'build',
          workKind: 'build.execute',
          buildAction: 'execute',
          executionMode: 'subagent-driven-development',
          tddMode: 'tdd',
          isolation: 'worktree',
          workId: 'build.execute:1.1',
          attempt: 1,
          invocationId: 'invocation-1',
          hostId: 'host-1',
          result: 'succeeded',
          response: secret,
        }),
        event(7, 'work.completed', {
          phase: 'build',
          workKind: 'build.execute',
          buildAction: 'execute',
          executionMode: 'subagent-driven-development',
          tddMode: 'tdd',
          isolation: 'worktree',
          workId: 'build.execute:1.1',
          attempt: 1,
          result: 'succeeded',
        }),
        event(8, 'validator.completed', {
          phase: 'build',
          workKind: 'build.execute',
          buildAction: 'execute',
          executionMode: 'subagent-driven-development',
          tddMode: 'tdd',
          isolation: 'worktree',
          workId: 'build.execute:1.1',
          attempt: 1,
          validatorId: 'build.package-valid',
          result: 'accepted',
        }),
      ];
      const batch: TelemetryBatch = {
        run,
        workflow,
        projectSnapshot,
        events: trajectory,
        trajectory,
      };
      const delivery = new ObservationDelivery(context, { workspaceRoot: directory });
      const telemetry = new WorkflowObservationTelemetry(delivery, {
        REPOCTOPUS_OTLP_DIAGNOSTICS: 'full',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=test',
      });
      await telemetry.export(batch);
      await telemetry.export(batch);

      expect(new Set(requests.map((request) => request.path))).toEqual(
        new Set(['/v1/traces', '/v1/logs', '/v1/metrics']),
      );
      const payload = Buffer.concat(requests.map((request) => request.body)).toString('latin1');
      expect(payload).toContain('repoctopus.work.claimed');
      expect(payload).toContain('repoctopus.observation');
      expect(payload).toContain('repoctopus.work.host-started');
      expect(payload).toContain('repoctopus.tool.completed');
      expect(payload).not.toContain(secret);
      expect(payload).not.toContain('C:\\secret');
      expect(requests).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await context.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
