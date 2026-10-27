import { describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { encodeObservationEnvelopes } from '../platform/telemetry/opentelemetry/envelope-encoder.js';
import { mapWorkflowObservationEnvelopes } from '../platform/telemetry/workflow-observation-mapping.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

function hostEvent(
  sequence: number,
  type: 'work.host-started' | 'work.host-completed',
  timestamp: string,
  result?: 'succeeded',
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `host-event-${sequence}`,
    timestamp,
    type,
    runId: 'run-envelope-mapping',
    stateVersion: sequence,
    compositionDigest: compositionFixture().compositionDigest,
    data: {
      executionContext: {
        schemaVersion: 1,
        phase: 'build',
        work: { id: 'build:4.1', kind: 'task.implement' },
        attempt: 1,
        checkEpoch: 7,
        task: { id: '4.1', revision: `sha256:${'a'.repeat(64)}` },
      },
      invocationId: 'invocation-envelope-1',
      hostId: 'external:runner-1',
      ...(result ? { result } : {}),
      prompt: 'private prompt must never leave the mapper',
      path: 'C:\\private\\workspace',
    },
  };
}

describe('Workflow observation envelope mapping', () => {
  it('maps once and gives remote and desktop identical OTLP signal semantics', () => {
    const workflow = workflowFixture();
    const projectSnapshot = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-envelope-mapping',
      projectSnapshotDigest: projectSnapshot.digest,
      composition: compositionFixture(),
      timestamp: '2026-10-27T07:00:00.000Z',
      traceId: '1'.repeat(32),
    });
    const started = hostEvent(1, 'work.host-started', '2026-10-27T07:00:01.000Z');
    const completed = hostEvent(2, 'work.host-completed', '2026-10-27T07:00:02.250Z', 'succeeded');
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot,
      events: [completed],
      trajectory: [started, completed],
    };

    const envelopes = mapWorkflowObservationEnvelopes(batch);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      source: { eventId: 'host-event-2', eventName: 'work.host-completed' },
      records: [
        { signal: 'log' },
        {
          signal: 'span',
          strategy: 'boundary-end',
          operation: 'host',
          operationId: 'invocation-envelope-1',
        },
        { signal: 'metric', instrument: 'histogram', value: 1_250 },
      ],
    });

    const remote = encodeObservationEnvelopes(envelopes);
    const desktop = encodeObservationEnvelopes(envelopes);
    expect(desktop).toEqual(remote);
    expect(remote.logs[0]).toMatchObject({
      eventName: 'repoctopus.work.host-completed',
      traceId: '1'.repeat(32),
      spanId: remote.spans[0]?.spanId,
      attributes: {
        'repoctopus.observation.envelope_id': envelopes[0]?.envelopeId,
        'repoctopus.execution.work.id': 'build:4.1',
      },
    });
    expect(remote.metrics[0]).toMatchObject({
      name: 'repoctopus.work.execution.duration',
      value: 1_250,
      attributes: {
        'repoctopus.execution.phase': 'build',
        'repoctopus.execution.work.kind': 'task.implement',
        'repoctopus.execution.result': 'succeeded',
      },
    });
    expect(JSON.stringify(remote.metrics)).not.toMatch(/run-envelope|build:4\.1|runner-1/u);
    expect(JSON.stringify(remote)).not.toMatch(/private prompt|private\\workspace/u);
  });

  it('leaves telemetry pipeline events on their dedicated migration path', () => {
    const workflow = workflowFixture();
    const projectSnapshot = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-envelope-mapping',
      projectSnapshotDigest: projectSnapshot.digest,
      composition: compositionFixture(),
      timestamp: '2026-10-27T07:00:00.000Z',
      traceId: '1'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'delivery-event-1',
      timestamp: '2026-10-27T07:00:01.000Z',
      type: 'telemetry.delivery-completed',
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: compositionFixture().compositionDigest,
      data: {
        operationId: 'delivery-operation-1',
        destinationKind: 'desktop',
        result: 'delivered',
      },
    };

    expect(
      mapWorkflowObservationEnvelopes({
        run,
        workflow,
        projectSnapshot,
        events: [event],
        trajectory: [event],
      }),
    ).toEqual([]);
  });
});
