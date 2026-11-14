import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
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

function batch(): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  const run = startRun({
    workflow,
    runId: 'otlp-config-run',
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-11-02T00:00:00.000Z',
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
    data: {
      workflowName: run.workflowName,
      workflowVersion: run.workflowVersion,
      workflowRunResult: 'started',
    },
  };
  return { run, workflow, projectSnapshot, events: [started], trajectory: [started] };
}

describe('OTLP deployment protocol', () => {
  it('uses unified and per-signal endpoints, headers, resources, and no-endpoint disablement', async () => {
    const requests: Array<{
      path: string;
      authorization?: string;
      tenant?: string;
      body: string;
    }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({
          path: request.url ?? '',
          ...(typeof request.headers.authorization === 'string'
            ? { authorization: request.headers.authorization }
            : {}),
          ...(typeof request.headers['x-tenant'] === 'string'
            ? { tenant: request.headers['x-tenant'] }
            : {}),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OTLP receiver did not bind');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-otlp-config-'));
    const context = new Context();
    try {
      const base = `http://127.0.0.1:${address.port}`;
      const delivery = new ObservationDelivery(context, { workspaceRoot: directory });
      const telemetry = new WorkflowObservationTelemetry(delivery, {
        REPOCTOPUS_OTLP_DIAGNOSTICS: 'full',
        OTEL_EXPORTER_OTLP_ENDPOINT: `${base}/otel`,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${base}/custom-traces`,
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20opaque,x-tenant=platform',
        OTEL_SERVICE_NAME: 'company-repoctopus',
        OTEL_RESOURCE_ATTRIBUTES:
          'service.namespace=developer-platform,deployment.environment.name=test',
      });
      await telemetry.export(batch());

      expect(new Set(requests.map((item) => item.path))).toEqual(
        new Set(['/custom-traces', '/otel/v1/logs', '/otel/v1/metrics']),
      );
      expect(requests.every((item) => item.authorization === 'Bearer opaque')).toBe(true);
      expect(requests.every((item) => item.tenant === 'platform')).toBe(true);
      expect(requests.every((item) => item.body.includes('company-repoctopus'))).toBe(true);
      expect(requests.every((item) => item.body.includes('developer-platform'))).toBe(true);
      expect(JSON.stringify(requests)).not.toContain('OTEL_EXPORTER_OTLP_HEADERS');

      const disabledDirectory = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-otlp-disabled-'));
      const disabledContext = new Context();
      try {
        const disabledDelivery = new ObservationDelivery(disabledContext, {
          workspaceRoot: disabledDirectory,
        });
        await new WorkflowObservationTelemetry(disabledDelivery, {}).export(batch());
        expect(requests).toHaveLength(3);
        expect(await disabledDelivery.health('remote')).toMatchObject({ mode: 'removed' });
      } finally {
        await disabledContext.fiber.dispose();
        await rm(disabledDirectory, { recursive: true, force: true });
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await context.fiber.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
