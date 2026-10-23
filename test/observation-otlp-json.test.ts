import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { EvidenceTelemetryBatch } from '../domains/evidence/telemetry.js';
import type { ObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import {
  ObservationOtlpJsonDestination,
  observationOtlpJsonConfigFromEnvironment,
} from '../platform/telemetry/observation-otlp-json.js';
import { mapWorkflowObservationEnvelope } from '../platform/telemetry/observation-workflow-mapping.js';
import { mapEvidenceObservationEnvelope } from '../platform/telemetry/observation-evidence-mapping.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

interface CapturedRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Readonly<Record<string, unknown>>;
}

const close: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(close.splice(0).map((operation) => operation()));
});

async function receiver(): Promise<{ origin: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        path: request.url ?? '',
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Readonly<
          Record<string, unknown>
        >,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test receiver did not bind');
  close.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

function workflowBatch(): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  const run = startRun({
    workflow,
    runId: 'run-shared-encoder',
    changeId: 'shared-encoder',
    traceId: '1'.repeat(32),
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-10-23T09:00:00.000Z',
  });
  const started: TrajectoryEvent = {
    schemaVersion: 1,
    sequence: 1,
    eventId: 'event-run-started',
    timestamp: run.createdAt,
    type: 'run.started',
    runId: run.runId,
    stateVersion: 0,
    compositionDigest: run.composition.compositionDigest,
    data: {},
  };
  const proposed: TrajectoryEvent = {
    ...started,
    sequence: 2,
    eventId: 'event-action-proposed',
    timestamp: '2026-10-23T09:00:01.000Z',
    type: 'action.proposed',
    stateVersion: 1,
    data: { action: { id: 'action-1', type: 'checkpoint', ref: 'verified', stepId: 'inspect' } },
  };
  const completed: TrajectoryEvent = {
    ...started,
    sequence: 3,
    eventId: 'event-action-completed',
    timestamp: '2026-10-23T09:00:01.250Z',
    type: 'action.completed',
    stateVersion: 2,
    data: { actionId: 'action-1', result: 'succeeded' },
  };
  return {
    run,
    workflow,
    projectSnapshot,
    events: [started, completed],
    trajectory: [started, proposed, completed],
  };
}

function evidenceBatch(): EvidenceTelemetryBatch {
  return {
    schemaVersion: 1,
    runId: 'run-shared-evidence',
    attemptId: 'attempt-shared-evidence',
    profileId: 'verify',
    compositionDigest: `sha256:${'a'.repeat(64)}`,
    events: [
      {
        schemaVersion: 1,
        sequence: 1,
        eventId: 'evidence-node-shared-encoder',
        type: 'evidence.node.completed',
        timestamp: '2026-10-23T09:01:00.000Z',
        runId: 'run-shared-evidence',
        attemptId: 'attempt-shared-evidence',
        data: {
          nodeId: 'build',
          receiptId: 'receipt-reused',
          sourceReceiptId: 'receipt-original',
          adapter: 'command/local',
          trust: 'verified',
          freshness: 'reused',
          status: 'passed',
          durationMs: 25,
        },
      },
      {
        schemaVersion: 1,
        sequence: 2,
        eventId: 'evidence-gate-shared-encoder',
        type: 'evidence.gate.evaluated',
        timestamp: '2026-10-23T09:01:01.000Z',
        runId: 'run-shared-evidence',
        attemptId: 'attempt-shared-evidence',
        data: { bundleId: 'bundle-1', outcome: 'passed', gateStatus: 'satisfied' },
      },
    ],
  };
}

function byPath(requests: readonly CapturedRequest[]): Map<string, CapturedRequest> {
  return new Map(requests.map((request) => [request.path, request]));
}

describe('shared Observation OTLP JSON encoder', () => {
  it('sends byte-equivalent Trace, Log and Metric payloads to remote and Desktop targets', async () => {
    const remote = await receiver();
    const desktop = await receiver();
    const batch = workflowBatch();
    const envelopes = batch.events.map((event) => mapWorkflowObservationEnvelope(batch, event));
    const remoteConfig = observationOtlpJsonConfigFromEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: remote.origin,
      OTEL_EXPORTER_OTLP_HEADERS: 'x-repoctopus-test=remote',
    });
    if (!remoteConfig) throw new Error('Remote config was not created');

    await Promise.all([
      new ObservationOtlpJsonDestination(remoteConfig).deliver(envelopes),
      new ObservationOtlpJsonDestination({
        origin: desktop.origin,
        authorization: 'Bearer desktop-session',
      }).deliver(envelopes),
    ]);

    const remoteByPath = byPath(remote.requests);
    const desktopByPath = byPath(desktop.requests);
    expect([...remoteByPath.keys()].sort()).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces']);
    expect([...desktopByPath.keys()].sort()).toEqual([...remoteByPath.keys()].sort());
    for (const path of remoteByPath.keys()) {
      expect(desktopByPath.get(path)?.body).toEqual(remoteByPath.get(path)?.body);
    }
    expect(remoteByPath.get('/v1/traces')?.headers['x-repoctopus-test']).toBe('remote');
    expect(desktopByPath.get('/v1/traces')?.headers.authorization).toBe('Bearer desktop-session');

    const serialized = JSON.stringify(remote.requests.map((request) => request.body));
    for (const envelope of envelopes) {
      expect(serialized).toContain(envelope.envelopeId);
      expect(serialized).toContain(envelope.digest);
    }
    expect(serialized).toContain('repoctopus.workflow.events');
    expect(serialized).toContain('repoctopus.workflow.step.duration');
    expect(serialized).toContain('"histogram"');
    expect(serialized).toContain(`"traceId":"${'1'.repeat(32)}"`);

    const metrics = JSON.stringify(remoteByPath.get('/v1/metrics')?.body);
    expect(metrics).not.toContain('repoctopus.run.id');
    expect(metrics).not.toContain('repoctopus.change.id');
    expect(metrics).not.toContain('repoctopus.envelope.id');
  });

  it('sends the same Evidence projection to remote and Desktop targets', async () => {
    const remote = await receiver();
    const desktop = await receiver();
    const batch = evidenceBatch();
    const envelopes = batch.events.map((event) => mapEvidenceObservationEnvelope(batch, event));
    const remoteConfig = observationOtlpJsonConfigFromEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: remote.origin,
    });
    if (!remoteConfig) throw new Error('Remote config was not created');

    await Promise.all([
      new ObservationOtlpJsonDestination(remoteConfig).deliver(envelopes),
      new ObservationOtlpJsonDestination({
        origin: desktop.origin,
        authorization: 'Bearer desktop-session',
      }).deliver(envelopes),
    ]);

    const remoteByPath = byPath(remote.requests);
    const desktopByPath = byPath(desktop.requests);
    expect([...remoteByPath.keys()].sort()).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces']);
    for (const path of remoteByPath.keys()) {
      expect(desktopByPath.get(path)?.body).toEqual(remoteByPath.get(path)?.body);
    }
    const payload = JSON.stringify(remote.requests.map((request) => request.body));
    expect(payload).toContain('receipt-original');
    expect(payload).toContain('reused');
    expect(payload).toContain('repoctopus.evidence.node.duration');
  });

  it('encodes lifecycle, platform event, Delivery and Post-merge envelopes identically for both destinations', async () => {
    const remote = await receiver();
    const desktop = await receiver();
    const golden = JSON.parse(
      await readFile(
        new URL('./fixtures/telemetry/remaining-domain-envelopes.v1.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, ObservationEnvelope>;
    const envelopes = Object.values(golden);
    const remoteConfig = observationOtlpJsonConfigFromEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: remote.origin,
    });
    if (!remoteConfig) throw new Error('Remote config was not created');

    await Promise.all([
      new ObservationOtlpJsonDestination(remoteConfig).deliver(envelopes),
      new ObservationOtlpJsonDestination({
        origin: desktop.origin,
        authorization: 'Bearer desktop-session',
      }).deliver(envelopes),
    ]);

    const remoteByPath = byPath(remote.requests);
    const desktopByPath = byPath(desktop.requests);
    expect([...remoteByPath.keys()].sort()).toEqual(['/v1/logs', '/v1/metrics', '/v1/traces']);
    for (const path of remoteByPath.keys()) {
      expect(desktopByPath.get(path)?.body).toEqual(remoteByPath.get(path)?.body);
    }
    const payload = JSON.stringify(remote.requests.map((request) => request.body));
    expect(payload).toContain('repoctopus.lifecycle.events');
    expect(payload).toContain('repoctopus.platform_event.events');
    expect(payload).toContain('repoctopus.delivery.events');
    expect(payload).toContain('repoctopus.post_merge.receipt.kind');
  });

  it('honors complete signal-specific endpoints and rejects partial delivery configuration', () => {
    expect(
      observationOtlpJsonConfigFromEnvironment({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/custom/traces',
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:4318/custom/logs',
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://127.0.0.1:4318/custom/metrics',
        OTEL_EXPORTER_OTLP_HEADERS: 'x-common=one',
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-signal=two',
      }),
    ).toEqual({
      targets: {
        traces: {
          url: 'http://127.0.0.1:4318/custom/traces',
          headers: { 'x-common': 'one', 'x-signal': 'two' },
        },
        logs: {
          url: 'http://127.0.0.1:4318/custom/logs',
          headers: { 'x-common': 'one' },
        },
        metrics: {
          url: 'http://127.0.0.1:4318/custom/metrics',
          headers: { 'x-common': 'one' },
        },
      },
    });
    expect(() =>
      observationOtlpJsonConfigFromEnvironment({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',
      }),
    ).toThrow('requires a common endpoint or explicit endpoints for all signals');
  });
});
