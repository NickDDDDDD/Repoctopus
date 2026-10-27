import { createHash } from 'node:crypto';

import type { TelemetryBatch } from '../../domains/runtime/types.js';
import {
  createObservationEnvelope,
  type ObservationEnvelope,
  type ObservationEnvelopeInput,
} from '../../domains/telemetry/observation-envelope.js';
import { observationEventSchema } from '../../domains/telemetry/observation-contract.js';
import type { TrajectoryEvent } from '../../domains/trajectory/types.js';
import { executionMetricAttributes, safeEventAttributes } from './opentelemetry/mapping.js';

const END_BOUNDARIES: Partial<Record<TrajectoryEvent['type'], TrajectoryEvent['type']>> = {
  'work.host-completed': 'work.host-started',
  'decision.resolved': 'decision.requested',
  'wait.ended': 'wait.started',
  'tool.completed': 'tool.started',
  'validator.completed': 'validator.started',
  'reconcile.completed': 'reconcile.started',
  'telemetry.delivery-completed': 'telemetry.delivery-started',
};

const OPERATION_ID_KEYS = [
  'invocationId',
  'decisionId',
  'waitId',
  'operationId',
  'validatorId',
  'reconcileId',
] as const;

function operationId(event: TrajectoryEvent): string | undefined {
  for (const key of OPERATION_ID_KEYS) {
    const value = event.data[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function sameBoundary(left: TrajectoryEvent, right: TrajectoryEvent): boolean {
  const leftIdentity = operationId(left);
  return leftIdentity !== undefined && leftIdentity === operationId(right);
}

function metricValue(batch: TelemetryBatch, event: TrajectoryEvent): number {
  const startType = END_BOUNDARIES[event.type];
  if (!startType) return 1;
  const started = batch.trajectory.find(
    (candidate) => candidate.type === startType && sameBoundary(event, candidate),
  );
  return started ? Math.max(0, Date.parse(event.timestamp) - Date.parse(started.timestamp)) : 0;
}

function snakeCaseAttributeName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function recordAttributes(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(safeEventAttributes(batch, event)).map(([key, value]) => [
      snakeCaseAttributeName(key),
      value as string | number | boolean,
    ]),
  );
}

const METRIC_ATTRIBUTE_SOURCES: Readonly<Record<string, string>> = {
  phase: 'repoctopus.execution.phase',
  'work.kind': 'repoctopus.execution.work.kind',
  result: 'repoctopus.execution.result',
  continuation: 'repoctopus.execution.continuation',
  'task.result': 'repoctopus.task.result',
  'recovery.kind': 'repoctopus.recovery.kind',
  'skill.role': 'repoctopus.execution.skill_role',
  'decision.kind': 'repoctopus.decision.kind',
  'wait.kind': 'repoctopus.wait.kind',
  'tool.kind': 'repoctopus.tool.kind',
  'tool.category': 'repoctopus.tool.category',
  'observation.status': 'repoctopus.tool.observation.status',
  'evidence.result': 'repoctopus.evidence.outcome',
  'destination.kind': 'repoctopus.telemetry.destination.kind',
};

function metricAttributes(
  event: TrajectoryEvent,
  attributes: Readonly<Record<string, string | number | boolean>>,
): Record<string, string | number | boolean> {
  const schema = observationEventSchema(event.type);
  const execution = executionMetricAttributes(event);
  const candidates = {
    ...attributes,
    ...(execution
      ? Object.fromEntries(
          Object.entries(execution).map(([key, value]) => [
            snakeCaseAttributeName(key),
            value as string | number | boolean,
          ]),
        )
      : {}),
  };
  const result: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(schema.metric.dimensions)) {
    const source = METRIC_ATTRIBUTE_SOURCES[key];
    const value =
      key === 'result'
        ? (candidates['repoctopus.execution.result'] ?? candidates['repoctopus.telemetry.result'])
        : source
          ? candidates[source]
          : undefined;
    const allowed = schema.metric.dimensions[key] ?? [];
    if (value !== undefined && allowed.some((candidate) => candidate === value)) {
      result[key] = value;
    }
  }
  return result;
}

const PIPELINE_MEASUREMENT_SOURCES: Readonly<Record<string, string>> = {
  'repoctopus.telemetry.cursor.lag': 'cursorLag',
  'repoctopus.telemetry.backlog.count': 'backlogCount',
  'repoctopus.telemetry.backlog.bytes': 'backlogBytes',
  'repoctopus.telemetry.backlog.oldest_age': 'backlogOldestAgeMs',
  'repoctopus.telemetry.retry.count': 'retryCount',
  'repoctopus.telemetry.gap.count': 'gapCount',
  'repoctopus.telemetry.retention.dropped_count': 'retentionDroppedCount',
  'repoctopus.telemetry.retention.dropped_bytes': 'retentionDroppedBytes',
};

function pipelineMeasurements(
  event: TrajectoryEvent,
  attributes: Readonly<Record<string, string | number | boolean>>,
) {
  const schema = observationEventSchema(event.type);
  const boundedAttributes = metricAttributes(event, attributes);
  const measurements = [];
  if (
    event.type === 'telemetry.delivery-completed' &&
    schema.metric.measurements['repoctopus.telemetry.delivery.events']
  ) {
    measurements.push({
      name: 'repoctopus.telemetry.delivery.events',
      instrument: 'counter' as const,
      value: 1,
      attributes: boundedAttributes,
    });
  }
  for (const [name, source] of Object.entries(PIPELINE_MEASUREMENT_SOURCES)) {
    const definition = schema.metric.measurements[name];
    const value = event.data[source];
    if (definition && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      measurements.push({
        name,
        instrument: definition.instrument,
        value,
        attributes: boundedAttributes,
      });
    }
  }
  return measurements;
}

function spanId(batch: TelemetryBatch, event: TrajectoryEvent): string {
  const identity = operationId(event) ?? event.eventId;
  return createHash('sha256').update(`${batch.run.runId}\0${identity}`).digest('hex').slice(0, 16);
}

export function mapTrajectoryObservationEnvelope(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): ObservationEnvelope | null {
  let schema;
  try {
    schema = observationEventSchema(event.type);
  } catch {
    return null;
  }
  const identity = operationId(event);
  if (
    (schema.span.strategy === 'boundary-start' || schema.span.strategy === 'boundary-end') &&
    identity === undefined
  ) {
    return null;
  }
  const attributes = recordAttributes(batch, event);
  const input: ObservationEnvelopeInput = {
    source: {
      eventId: event.eventId,
      eventName: event.type,
      observedAt: event.timestamp,
    },
    correlation: {
      traceId: batch.run.traceId,
      spanId: spanId(batch, event),
      ...(identity === undefined ? {} : { operationId: identity }),
    },
    resourceAttributes: {
      'service.name': 'repoctopus-runtime',
      'service.version': '0.1.0',
      'repoctopus.workspace.id': batch.projectSnapshot.projectId,
    },
    recordAttributes: attributes,
    ...(schema.metric.instrument === 'none'
      ? {}
      : {
          metric: {
            value: metricValue(batch, event),
            attributes: metricAttributes(event, attributes),
            ...(schema.category === 'telemetry-pipeline'
              ? { measurements: pipelineMeasurements(event, attributes) }
              : {}),
          },
        }),
  };
  return createObservationEnvelope(input);
}

/** Maps only persisted schema-v1 Workflow observations; legacy events stay on their legacy path. */
export function mapWorkflowObservationEnvelopes(
  batch: TelemetryBatch,
): readonly ObservationEnvelope[] {
  return batch.events
    .filter((event) => {
      try {
        return observationEventSchema(event.type).category !== 'telemetry-pipeline';
      } catch {
        return true;
      }
    })
    .map((event) => mapTrajectoryObservationEnvelope(batch, event))
    .filter((envelope): envelope is ObservationEnvelope => envelope !== null);
}
