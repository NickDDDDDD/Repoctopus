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
        attempt: 1,
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
        event(8, 'validator.completed', {
          executionContext,
          validatorId: 'build.task-valid',
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
      expect(payload).toContain('repoctopus.execution.check_epoch');
      expect(payload).toContain('repoctopus.execution.task.id');
      expect(payload).not.toContain(secret);
      expect(payload).not.toContain('C:\\secret');
      const traces = requests.filter((request) => request.path === '/v1/traces');
      expect(traces.length).toBeGreaterThan(0);
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
