import { createHash } from 'node:crypto';

import type { DeliveryEvent } from '../../domains/delivery/ports.js';
import type { DeliveryState } from '../../domains/delivery/types.js';
import type { TelemetryBatch } from '../../domains/runtime/types.js';
import {
  createObservationEnvelope,
  type ObservationEnvelope,
  type ObservationEnvelopeInput,
} from '../../domains/telemetry/observation-envelope.js';
import { observationEventSchema } from '../../domains/telemetry/observation-contract.js';
import { canonicalJson } from '../../domains/workflow-contract/canonical.js';
import type { LifecycleTelemetryEvent } from '../../services/lifecycle-diagnostics.js';
import { safeDeliveryAttributes } from './delivery-mapping.js';
import { mapTrajectoryObservationEnvelope } from './workflow-observation-mapping.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function traceId(identity: string): string {
  return digest(identity).slice(0, 32);
}

function spanId(identity: string): string {
  return digest(identity).slice(0, 16);
}

function snakeCaseAttributeName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function lifecycleType(event: LifecycleTelemetryEvent): 'app' | 'plugin' | 'operation-drain' {
  if (event.type === 'app.lifecycle') return 'app';
  if (event.type === 'plugin.lifecycle') return 'plugin';
  return 'operation-drain';
}

function lifecycleIdentity(event: LifecycleTelemetryEvent): string {
  return `lifecycle:${digest(canonicalJson(event))}`;
}

function mapLifecycleEvent(event: LifecycleTelemetryEvent): ObservationEnvelope {
  const eventId = lifecycleIdentity(event);
  const input: ObservationEnvelopeInput = {
    source: {
      eventId,
      eventName: event.type,
      observedAt: event.timestamp,
    },
    correlation: {
      traceId: traceId(event.bootId),
      spanId: spanId(eventId),
    },
    resourceAttributes: {
      'service.name': 'repoctopus-lifecycle',
      'service.version': '0.1.0',
      'repoctopus.composition.digest': event.compositionDigest,
    },
    recordAttributes: {
      'repoctopus.boot.id': event.bootId,
      'repoctopus.lifecycle.type': event.type,
      'repoctopus.lifecycle.phase': event.phase,
      'repoctopus.lifecycle.result': event.result,
      ...(event.pluginId ? { 'repoctopus.plugin.id': event.pluginId } : {}),
      ...(event.service ? { 'repoctopus.service.name': event.service } : {}),
      ...(event.remaining === undefined
        ? {}
        : { 'repoctopus.operation.remaining': event.remaining }),
      ...(event.recoverability
        ? { 'repoctopus.operation.recoverability': event.recoverability }
        : {}),
    },
    metric: {
      value: 1,
      attributes: {
        'lifecycle.type': lifecycleType(event),
        phase: event.phase,
        result: event.result,
      },
    },
  };
  return createObservationEnvelope(input);
}

export function mapLifecycleObservationEnvelopes(
  events: readonly LifecycleTelemetryEvent[],
): readonly ObservationEnvelope[] {
  return events.map((event) => mapLifecycleEvent(event));
}

function deliveryMetricAttributes(
  state: DeliveryState,
  event: DeliveryEvent,
): Record<string, string | number | boolean> {
  const schema = observationEventSchema(event.type);
  const candidates: Record<string, unknown> = {
    'delivery.event.type': event.type,
    'delivery.state': state.status,
    'delivery.action.type': event.data.actionType,
    result: event.data.result,
  };
  const result: Record<string, string | number | boolean> = {};
  for (const [dimension, allowed] of Object.entries(schema.metric.dimensions)) {
    const value = candidates[dimension];
    if (
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') &&
      allowed.some((candidate) => candidate === value)
    ) {
      result[dimension] = value;
    }
  }
  return result;
}

export function mapDeliveryObservationEnvelope(
  state: DeliveryState,
  event: DeliveryEvent,
): ObservationEnvelope {
  const attributes = Object.fromEntries(
    Object.entries(safeDeliveryAttributes(state, event)).map(([key, value]) => [
      snakeCaseAttributeName(key),
      value,
    ]),
  );
  return createObservationEnvelope({
    source: {
      eventId: event.eventId,
      eventName: event.type,
      observedAt: event.timestamp,
    },
    correlation: {
      traceId: traceId(event.changeId),
      spanId: spanId(`${event.changeId}\0${event.eventId}`),
    },
    resourceAttributes: {
      'service.name': 'repoctopus-delivery',
      'service.version': '0.1.0',
      ...(state.snapshot
        ? { 'repoctopus.composition.digest': state.snapshot.compositionDigest }
        : {}),
    },
    recordAttributes: attributes,
    metric: {
      value: 1,
      attributes: deliveryMetricAttributes(state, event),
    },
  });
}

export function mapTelemetryPipelineObservationEnvelopes(
  batch: TelemetryBatch,
): readonly ObservationEnvelope[] {
  return batch.events
    .filter((event) => {
      try {
        return observationEventSchema(event.type).category === 'telemetry-pipeline';
      } catch {
        return false;
      }
    })
    .map((event) => mapTrajectoryObservationEnvelope(batch, event))
    .filter((envelope): envelope is ObservationEnvelope => envelope !== null);
}
