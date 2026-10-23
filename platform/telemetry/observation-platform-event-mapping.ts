import { createHash } from 'node:crypto';

import type { PlatformEventTelemetryEvent } from '../../domains/platform-events/ports.js';
import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import { mapObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';

const SAFE_DIAGNOSTIC = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,7}$/u;

export function platformEventObservationAttributes(
  event: PlatformEventTelemetryEvent,
): Record<string, ObservationAttributeValue> {
  return {
    'repoctopus.platform_event.envelope.id': event.envelopeId,
    'repoctopus.platform_event.provider': event.provider,
    'repoctopus.platform_event.source': event.source,
    'repoctopus.platform_event.delivery.id': event.deliveryId,
    'repoctopus.platform_event.type': event.eventType,
    'repoctopus.platform_event.status': event.status,
    'repoctopus.platform_event.attempts': event.attempts,
    'repoctopus.platform_event.state.version': event.stateVersion,
    'repoctopus.platform_event.event.type': event.type,
    ...(event.receiptId ? { 'repoctopus.platform_event.receipt.id': event.receiptId } : {}),
    ...(event.diagnostic && SAFE_DIAGNOSTIC.test(event.diagnostic)
      ? { 'repoctopus.platform_event.diagnostic': event.diagnostic }
      : {}),
  };
}

function platformEventId(event: PlatformEventTelemetryEvent): string {
  return createHash('sha256')
    .update([event.envelopeId, event.type, String(event.stateVersion), event.timestamp].join('\0'))
    .digest('hex');
}

function platformEventSignals(event: PlatformEventTelemetryEvent): ObservationSignal[] {
  return [
    {
      kind: 'log',
      name: `repoctopus.${event.type}`,
      severity:
        event.type === 'platform_event.dead_lettered' ||
        event.type === 'platform_event.retry_scheduled'
          ? 'warn'
          : 'info',
    },
    {
      kind: 'metric',
      name: 'repoctopus.platform_event.events',
      value: 1,
      unit: 'event',
      aggregation: 'counter',
      attributes: {
        'repoctopus.platform_event.event.type': event.type,
        'repoctopus.platform_event.provider': event.provider,
        'repoctopus.platform_event.type': event.eventType,
        'repoctopus.platform_event.status': event.status,
      },
    },
  ];
}

export function mapPlatformEventObservationEnvelope(
  event: PlatformEventTelemetryEvent,
): ObservationEnvelope {
  const attributes = platformEventObservationAttributes(event);
  return mapObservationEnvelope(
    {
      source: {
        domain: 'platform_event',
        eventId: platformEventId(event),
        eventType: event.type,
        sequence: event.stateVersion,
      },
      observedAt: event.timestamp,
      attributes,
    },
    { allowedAttributes: Object.keys(attributes), signals: platformEventSignals(event) },
  );
}
