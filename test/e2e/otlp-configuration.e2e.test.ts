import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { startRun } from '../../domains/engine/loop.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import {
  OpenTelemetryExporter,
  telemetryFromEnvironment,
} from '../../platform/telemetry/opentelemetry/exporter.js';
import { compositionFixture, projectFixture, workflowFixture } from '../helpers/fixtures.js';

function batch(): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  const run = startRun({
    workflow,
    runId: 'otlp-config-run',
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-11-02T00:00:00.000Z',
    traceId: '1'.repeat(32),
  });
  const started: TrajectoryEvent = {
    schemaVersion: 1,
    sequence: 1,
    eventId: 'otlp-config-started',
    timestamp: run.createdAt,
    type: 'run.started',
    runId: run.runId,
    stateVersion: 1,
    compositionDigest: run.composition.compositionDigest,
    data: {},
  };
  return { run, workflow, projectSnapshot, events: [started], trajectory: [started] };
}

describe('OTLP deployment protocol', () => {
  it('uses standard unified endpoint, signal override, headers, and explicit process environment', async () => {
    const requests: Array<{ path: string; authorization?: string; tenant?: string }> = [];
    const server = createServer((request, response) => {
      requests.push({
        path: request.url ?? '',
        ...(typeof request.headers.authorization === 'string'
          ? { authorization: request.headers.authorization }
          : {}),
        ...(typeof request.headers['x-tenant'] === 'string'
          ? { tenant: request.headers['x-tenant'] }
          : {}),
      });
      request.resume();
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/x-protobuf' });
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OTLP receiver did not bind');
    try {
      const base = `http://127.0.0.1:${address.port}`;
      await new OpenTelemetryExporter({
        timeoutMillis: 5_000,
        processEnvironment: {
          OTEL_EXPORTER_OTLP_ENDPOINT: `${base}/otel`,
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${base}/custom-traces`,
          OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20opaque,x-tenant=platform',
          OTEL_SERVICE_NAME: 'company-repoctopus',
        },
      }).export(batch());
      expect(new Set(requests.map((item) => item.path))).toEqual(
        new Set(['/custom-traces', '/otel/v1/logs', '/otel/v1/metrics']),
      );
      expect(requests.every((item) => item.authorization === 'Bearer opaque')).toBe(true);
      expect(requests.every((item) => item.tenant === 'platform')).toBe(true);

      const before = requests.length;
      await telemetryFromEnvironment({}).export(batch());
      expect(requests).toHaveLength(before);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
