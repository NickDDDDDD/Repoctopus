import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import { mapObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';
import type { LifecycleTelemetryEvent } from '../../services/lifecycle-diagnostics.js';

export function lifecycleObservationAttributes(
  event: LifecycleTelemetryEvent,
): Record<string, ObservationAttributeValue> {
  return {
    'repoctopus.boot.id': event.bootId,
    'repoctopus.composition.digest': event.compositionDigest,
    'repoctopus.lifecycle.type': event.type,
    'repoctopus.lifecycle.phase': event.phase,
    'repoctopus.lifecycle.result': event.result,
    ...(event.pluginId ? { 'repoctopus.plugin.id': event.pluginId } : {}),
    ...(event.service ? { 'repoctopus.service.name': event.service } : {}),
    ...(event.remaining === undefined ? {} : { 'repoctopus.operation.remaining': event.remaining }),
    ...(event.recoverability
      ? { 'repoctopus.operation.recoverability': event.recoverability }
      : {}),
  };
}

function lifecycleSignals(event: LifecycleTelemetryEvent): ObservationSignal[] {
  return [
    {
      kind: 'log',
      name: `repoctopus.${event.type}`,
      severity: event.result === 'failed' || event.result === 'timed_out' ? 'warn' : 'info',
    },
    {
      kind: 'metric',
      name: 'repoctopus.lifecycle.events',
      value: 1,
      unit: 'event',
      aggregation: 'counter',
      attributes: {
        'repoctopus.lifecycle.type': event.type,
        'repoctopus.lifecycle.phase': event.phase,
        'repoctopus.lifecycle.result': event.result,
      },
    },
  ];
}

export function mapLifecycleObservationEnvelope(
  event: LifecycleTelemetryEvent,
): ObservationEnvelope {
  const attributes = lifecycleObservationAttributes(event);
  return mapObservationEnvelope(
    {
      source: {
        domain: 'lifecycle',
        eventId: event.eventId,
        eventType: event.type,
        sequence: event.sequence,
      },
      observedAt: event.timestamp,
      attributes,
    },
    { allowedAttributes: Object.keys(attributes), signals: lifecycleSignals(event) },
  );
}
