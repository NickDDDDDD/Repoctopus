import { createServer } from 'node:http';

import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { WorkflowTelemetryProvider } from '../plugins/run/workflow-telemetry-provider.js';
import {
  ObservationTelemetryProvider,
  REMOTE_OTLP_DESTINATION_ID,
} from '../plugins/telemetry/observation-telemetry-provider.js';
import { FileObservationEnvelopeStore } from '../platform/telemetry/observation-envelope-store.js';
import {
  compositionFixture,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const contexts: Context[] = [];
const cleanup: string[] = [];
const close: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.fiber.dispose()));
  await Promise.all(close.splice(0).map((operation) => operation()));
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});

function batch(): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  const run = startRun({
    workflow,
    runId: 'run-remote-recovery',
    changeId: 'remote-recovery',
    traceId: '2'.repeat(32),
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-10-23T09:10:00.000Z',
  });
  const event: TrajectoryEvent = {
    schemaVersion: 1,
    sequence: 1,
    eventId: 'event-remote-recovery',
    timestamp: run.createdAt,
    type: 'run.started',
    runId: run.runId,
    stateVersion: 0,
    compositionDigest: run.composition.compositionDigest,
    data: {},
  };
  return { run, workflow, projectSnapshot, events: [event], trajectory: [event] };
}

describe('WorkflowTelemetryProvider remote replay', () => {
  it('keeps remote and Desktop cursors independent across failure and recovery', async () => {
    let available = false;
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(available ? 200 : 503, { 'content-type': 'application/json' });
      response.end('{}');
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

    const workspace = await temporaryDirectory('repoctopus-workflow-telemetry-');
    cleanup.push(workspace);
    const context = new Context();
    contexts.push(context);
    new ObservationTelemetryProvider(context, {
      workspaceRoot: workspace,
      environment: {
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
      },
    });
    const telemetry = new WorkflowTelemetryProvider(context);
    const store = new FileObservationEnvelopeStore(workspace);
    const input = batch();

    await expect(telemetry.export(input)).rejects.toThrow('Remote OTLP telemetry replay failed');
    expect(await store.pending(REMOTE_OTLP_DESTINATION_ID)).toHaveLength(1);
    expect(await store.pending('desktop-local')).toHaveLength(1);
    expect((await store.readCursor(REMOTE_OTLP_DESTINATION_ID)).health).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
    });
    expect((await store.readCursor('desktop-local')).health).toEqual({
      status: 'healthy',
      consecutiveFailures: 0,
    });

    await context.observationTelemetry.setDestinationState(REMOTE_OTLP_DESTINATION_ID, 'paused');
    available = true;
    await expect(telemetry.export(input)).resolves.toBeUndefined();
    expect(
      await context.observationTelemetry.destinationStatus(REMOTE_OTLP_DESTINATION_ID),
    ).toMatchObject({
      state: 'paused',
      backlog: { envelopeCount: 1 },
      deliveryGuarantee: 'at-least-once',
    });
    await context.observationTelemetry.setDestinationState(REMOTE_OTLP_DESTINATION_ID, 'enabled');
    await expect(telemetry.export(input)).resolves.toBeUndefined();
    expect(await store.pending(REMOTE_OTLP_DESTINATION_ID)).toEqual([]);
    expect(await store.pending('desktop-local')).toHaveLength(1);
    expect((await store.readCursor(REMOTE_OTLP_DESTINATION_ID)).health).toEqual({
      status: 'healthy',
      consecutiveFailures: 0,
    });
  });
});
