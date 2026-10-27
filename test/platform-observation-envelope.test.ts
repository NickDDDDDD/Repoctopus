import { describe, expect, it } from 'vitest';

import type { DeliveryEvent } from '../domains/delivery/ports.js';
import { initialDeliveryState } from '../domains/delivery/state.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { LifecycleTelemetryEvent } from '../services/lifecycle-diagnostics.js';
import {
  mapDeliveryObservationEnvelope,
  mapLifecycleObservationEnvelopes,
  mapTelemetryPipelineObservationEnvelopes,
} from '../platform/telemetry/platform-observation-mapping.js';
import { encodeObservationEnvelopes } from '../platform/telemetry/opentelemetry/envelope-encoder.js';
import { startRun } from '../domains/engine/loop.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

describe('platform observation envelope mapping', () => {
  it('maps App lifecycle through the same destination-neutral envelope and encoder', () => {
    const events: LifecycleTelemetryEvent[] = [
      {
        type: 'app.lifecycle',
        bootId: 'boot-1',
        compositionDigest: `sha256:${'a'.repeat(64)}`,
        timestamp: '2026-10-27T09:00:00.000Z',
        phase: 'active',
        result: 'succeeded',
      },
    ];

    const envelopes = mapLifecycleObservationEnvelopes(events);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      source: { eventName: 'app.lifecycle' },
      records: [
        { signal: 'log' },
        { signal: 'span', strategy: 'point' },
        {
          signal: 'metric',
          instrument: 'counter',
          attributes: { 'lifecycle.type': 'app', phase: 'active', result: 'succeeded' },
        },
      ],
    });
    expect(encodeObservationEnvelopes(envelopes)).toEqual(
      encodeObservationEnvelopes(mapLifecycleObservationEnvelopes(events)),
    );
  });

  it('maps Delivery once and keeps private event data out of every destination', () => {
    const state = initialDeliveryState('delivery-change', '2026-10-27T09:00:00.000Z');
    const event: DeliveryEvent = {
      schemaVersion: 1,
      eventId: 'delivery-event-1',
      changeId: state.changeId,
      stateVersion: state.stateVersion,
      timestamp: state.updatedAt,
      type: 'delivery.action',
      data: {
        actionId: 'action-1',
        actionType: 'git.push',
        result: 'failed',
        body: 'private report',
        token: 'ghp_12345678901234567890',
        path: 'C:\\private\\workspace',
      },
    };

    const envelope = mapDeliveryObservationEnvelope(state, event);
    const remote = encodeObservationEnvelopes([envelope]);
    const desktop = encodeObservationEnvelopes([envelope]);
    expect(desktop).toEqual(remote);
    expect(remote.logs[0]).toMatchObject({
      eventName: 'repoctopus.delivery.action',
      attributes: {
        'repoctopus.delivery.action_id': 'action-1',
        'repoctopus.delivery.action_type': 'git.push',
        'repoctopus.delivery.result': 'failed',
      },
    });
    expect(remote.metrics[0]).toMatchObject({
      name: 'repoctopus.delivery.events',
      attributes: {
        'repoctopus.delivery.event.type': 'delivery.action',
        'repoctopus.delivery.state': 'development',
      },
    });
    expect(JSON.stringify(remote)).not.toMatch(/private report|ghp_|private\\workspace/u);
  });

  it('maps telemetry pipeline events without the Workflow exporter interpreting them', () => {
    const workflow = workflowFixture();
    const projectSnapshot = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-platform-envelope',
      projectSnapshotDigest: projectSnapshot.digest,
      composition: compositionFixture(),
      timestamp: '2026-10-27T09:00:00.000Z',
      traceId: '2'.repeat(32),
    });
    const started = {
      schemaVersion: 1 as const,
      sequence: 1,
      eventId: 'pipeline-started',
      timestamp: '2026-10-27T09:00:01.000Z',
      type: 'telemetry.delivery-started' as const,
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: compositionFixture().compositionDigest,
      data: {
        operationId: 'pipeline-operation-1',
        destinationId: 'desktop-user',
        destinationKind: 'desktop',
      },
    };
    const completed = {
      ...started,
      sequence: 2,
      eventId: 'pipeline-completed',
      timestamp: '2026-10-27T09:00:01.250Z',
      type: 'telemetry.delivery-completed' as const,
      stateVersion: 2,
      data: {
        ...started.data,
        result: 'delivered',
        deliveryLatencyMs: 250,
        cursorLag: 0,
        backlogCount: 0,
        backlogBytes: 0,
        backlogOldestAgeMs: 0,
        retryCount: 0,
        gapCount: 0,
        retentionDroppedCount: 0,
        retentionDroppedBytes: 0,
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot,
      events: [completed],
      trajectory: [started, completed],
    };

    const envelopes = mapTelemetryPipelineObservationEnvelopes(batch);
    expect(envelopes).toHaveLength(1);
    const signals = encodeObservationEnvelopes(envelopes);
    expect(signals.spans[0]).toMatchObject({
      name: 'repoctopus.delivery',
      startTime: '2026-10-27T09:00:01.000Z',
      endTime: '2026-10-27T09:00:01.250Z',
    });
    expect(signals.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'repoctopus.telemetry.delivery.latency', value: 250 }),
        expect.objectContaining({ name: 'repoctopus.telemetry.cursor.lag', value: 0 }),
        expect.objectContaining({ name: 'repoctopus.telemetry.backlog.count', value: 0 }),
      ]),
    );
    expect(JSON.stringify(signals.metrics)).not.toContain('desktop-user');
  });
});
