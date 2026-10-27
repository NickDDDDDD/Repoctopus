import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { startRun } from '../../domains/engine/loop.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import { OpenTelemetryExporter } from '../../platform/telemetry/opentelemetry/exporter.js';
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
    timestamp: `2026-10-25T00:00:${String(sequence).padStart(2, '0')}.000Z`,
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
    const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
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
      const executionContext = {
        schemaVersion: 1,
        phase: 'build',
        work: { id: 'build:1.1', kind: 'task.implement' },
        attempt: 2,
        checkEpoch: 4,
        task: { id: '1.1', revision: `sha256:${'b'.repeat(64)}` },
      };
      const trajectory = [
        event(1, 'run.started', {}),
        event(2, 'work.claimed', {
          executionContext,
          packetDigest: `sha256:${'a'.repeat(64)}`,
          prompt: secret,
          command: `echo ${secret}`,
          path: `C:\\secret\\${secret}.txt`,
          url: `https://example.invalid/${secret}`,
        }),
        event(3, 'work.host-started', {
          executionContext,
          invocationId: 'invocation-1',
          hostId: 'host-1',
        }),
        event(4, 'tool.started', {
          executionContext,
          operationId: 'operation-1',
          invocationId: 'invocation-1',
          operationKind: 'repository.write',
          arguments: secret,
        }),
        event(5, 'tool.completed', {
          executionContext,
          operationId: 'operation-1',
          invocationId: 'invocation-1',
          operationKind: 'repository.write',
          result: 'succeeded',
        }),
        event(6, 'work.host-completed', {
          executionContext,
          invocationId: 'invocation-1',
          hostId: 'host-1',
          result: 'succeeded',
          response: secret,
        }),
        event(7, 'work.completed', {
          executionContext,
          result: 'succeeded',
        }),
        event(8, 'validator.started', {
          executionContext,
          validatorId: 'build.task-valid',
          operationId: 'validator-operation-1',
        }),
        event(9, 'validator.completed', {
          executionContext,
          validatorId: 'build.task-valid',
          operationId: 'validator-operation-1',
          result: 'accepted',
        }),
        event(10, 'decision.requested', {
          schemaVersion: 1,
          phase: 'design',
          decisionId: 'design-approval-1',
          decisionKind: 'design-approval',
          result: 'requested',
          reason: secret,
        }),
        event(11, 'decision.resolved', {
          schemaVersion: 1,
          phase: 'design',
          decisionId: 'design-approval-1',
          decisionKind: 'design-approval',
          result: 'accepted',
          outcome: 'approve',
          actorId: secret,
          reply: secret,
        }),
        event(12, 'wait.started', {
          phase: 'verify',
          waitId: 'external-wait-1',
          waitKind: 'external-fact',
          reason: secret,
        }),
        event(13, 'wait.ended', {
          phase: 'verify',
          waitId: 'external-wait-1',
          waitKind: 'external-fact',
          result: 'succeeded',
          reason: secret,
        }),
        event(14, 'tool.observation-reported', {
          executionContext,
          invocationId: 'invocation-1',
          toolKind: 'host-tool',
          observationStatus: 'observed',
          prompt: secret,
        }),
        event(15, 'tool.usage-reported', {
          executionContext,
          invocationId: 'invocation-1',
          toolKind: 'host-tool',
          toolCategory: 'test.run',
          result: 'succeeded',
          durationMs: 1_250,
          callCount: 2,
          command: `npm test -- ${secret}`,
          output: secret,
        }),
        event(16, 'model.usage-reported', {
          executionContext,
          invocationId: 'invocation-1',
          toolKind: 'model',
          modelVersion: 'gpt-5.1-2026-10-01',
          inputTokenCount: 1_000,
          outputTokenCount: 250,
          cacheReadTokenCount: 400,
          cacheWriteTokenCount: 100,
          reply: secret,
        }),
        event(17, 'telemetry.delivery-started', {
          destinationId: 'team-signoz',
          destinationKind: 'remote',
          operationId: 'remote-attempt-1',
          cursorOffset: 4,
          headOffset: 10,
          cursorLag: 6,
          backlogCount: 6,
          backlogBytes: 6_000,
          backlogOldestAgeMs: 30_000,
          retryCount: 0,
          gapCount: 0,
          retentionDroppedCount: 0,
          retentionDroppedBytes: 0,
          completeHistory: true,
        }),
        event(18, 'telemetry.delivery-completed', {
          destinationId: 'team-signoz',
          destinationKind: 'remote',
          operationId: 'remote-attempt-1',
          result: 'failed',
          cursorOffset: 4,
          headOffset: 10,
          cursorLag: 6,
          backlogCount: 6,
          backlogBytes: 6_000,
          backlogOldestAgeMs: 31_200,
          retryCount: 1,
          gapCount: 0,
          retentionDroppedCount: 0,
          retentionDroppedBytes: 0,
          completeHistory: true,
          deliveryLatencyMs: 1_200,
        }),
        event(19, 'telemetry.delivery-started', {
          destinationId: 'desktop-current-user',
          destinationKind: 'desktop',
          operationId: 'desktop-attempt-1',
          cursorOffset: 4,
          headOffset: 10,
          cursorLag: 6,
          backlogCount: 6,
          backlogBytes: 6_000,
          backlogOldestAgeMs: 30_000,
          retryCount: 0,
          gapCount: 0,
          retentionDroppedCount: 0,
          retentionDroppedBytes: 0,
          completeHistory: true,
        }),
        event(20, 'telemetry.delivery-completed', {
          destinationId: 'desktop-current-user',
          destinationKind: 'desktop',
          operationId: 'desktop-attempt-1',
          result: 'delivered',
          cursorOffset: 10,
          headOffset: 10,
          cursorLag: 0,
          backlogCount: 0,
          backlogBytes: 0,
          backlogOldestAgeMs: 0,
          retryCount: 0,
          gapCount: 0,
          retentionDroppedCount: 0,
          retentionDroppedBytes: 0,
          completeHistory: true,
          deliveryLatencyMs: 80,
        }),
        event(21, 'telemetry.receiver-evaluated', {
          destinationId: 'desktop-current-user',
          destinationKind: 'desktop',
          result: 'accepted',
          cursorOffset: 10,
          headOffset: 10,
          cursorLag: 0,
          backlogCount: 0,
          backlogBytes: 0,
          backlogOldestAgeMs: 0,
          retryCount: 0,
          gapCount: 0,
          retentionDroppedCount: 0,
          retentionDroppedBytes: 0,
          completeHistory: true,
          receiverLatencyMs: 12,
        }),
        event(22, 'telemetry.gap-recorded', {
          destinationId: 'team-signoz',
          destinationKind: 'remote',
          result: 'dropped',
          cursorOffset: 4,
          headOffset: 12,
          cursorLag: 8,
          backlogCount: 5,
          backlogBytes: 4_200,
          backlogOldestAgeMs: 18_000,
          retryCount: 1,
          gapCount: 1,
          retentionDroppedCount: 3,
          retentionDroppedBytes: 2_400,
          completeHistory: false,
          droppedCount: 3,
          droppedBytes: 2_400,
        }),
      ];
      const batch: TelemetryBatch = {
        run,
        workflow,
        projectSnapshot,
        events: trajectory,
        trajectory,
      };
      const exporter = new OpenTelemetryExporter({ timeoutMillis: 5_000, environment: 'test' });
      await exporter.export(batch);
      await exporter.export(batch);

      expect(new Set(requests.map((request) => request.path))).toEqual(
        new Set(['/v1/traces', '/v1/logs', '/v1/metrics']),
      );
      const payload = Buffer.concat(requests.map((request) => request.body)).toString('latin1');
      expect(payload).toContain('repoctopus.work.claimed');
      expect(payload).toContain('repoctopus.work.execution.events');
      expect(payload).toContain('repoctopus.host');
      expect(payload).toContain('repoctopus.tool');
      expect(payload).toContain('repoctopus.decision');
      expect(payload).toContain('repoctopus.wait');
      expect(payload).toContain('repoctopus.execution.duration_ms');
      expect(payload).toContain('repoctopus.decision.kind');
      expect(payload).toContain('repoctopus.wait.kind');
      expect(payload).toContain('repoctopus.workflow.health.duration');
      expect(payload).toContain('repoctopus.workflow.health.events');
      expect(payload).toContain('repoctopus.tool.observations');
      expect(payload).toContain('repoctopus.tool.calls');
      expect(payload).toContain('repoctopus.tool.duration');
      expect(payload).toContain('repoctopus.model.tokens');
      expect(payload).toContain('repoctopus.tool.category');
      expect(payload).toContain('test.run');
      expect(payload).toContain('gpt-5.1-2026-10-01');
      expect(payload).toContain('repoctopus.telemetry.cursor.lag');
      expect(payload).toContain('repoctopus.telemetry.backlog.count');
      expect(payload).toContain('repoctopus.telemetry.retention.dropped_count');
      expect(payload).toContain('repoctopus.telemetry.delivery.latency');
      expect(payload).toContain('repoctopus.telemetry.receiver.events');
      expect(payload).toContain('repoctopus.validator');
      expect(payload).toContain('repoctopus.execution.check_epoch');
      expect(payload).toContain('repoctopus.execution.task.id');
      expect(payload).not.toContain(secret);
      expect(payload).not.toContain('C:\\secret');
      const metricPayload = Buffer.concat(
        requests.filter((request) => request.path === '/v1/metrics').map((request) => request.body),
      ).toString('latin1');
      expect(metricPayload).not.toContain('team-signoz');
      expect(metricPayload).not.toContain('desktop-current-user');
      const traces = requests.filter((request) => request.path === '/v1/traces');
      expect(traces.length).toBeGreaterThan(0);
      const spans = traces.flatMap((request) => {
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
      const runSpan = spans.find((span) => span.name === 'repoctopus.run');
      const validatorSpan = spans.find((span) => span.name === 'repoctopus.validator');
      expect(BigInt(runSpan!.endTimeUnixNano!) - BigInt(runSpan!.startTimeUnixNano!)).toBe(
        21_000_000_000n,
      );
      expect(
        BigInt(validatorSpan!.endTimeUnixNano!) - BigInt(validatorSpan!.startTimeUnixNano!),
      ).toBe(1_000_000_000n);
      expect(traces.length % 2).toBe(0);
      const replayOffset = traces.length / 2;
      for (let index = 0; index < replayOffset; index += 1) {
        expect(traces[index]!.body.equals(traces[index + replayOffset]!.body)).toBe(true);
      }
    } finally {
      if (previous === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
