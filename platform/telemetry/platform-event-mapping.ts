import type { Attributes } from '@opentelemetry/api';

import type { PlatformEventTelemetryEvent } from '../../domains/platform-events/ports.js';

const SAFE_DIAGNOSTIC = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){1,7}$/;

export function safePlatformEventAttributes(event: PlatformEventTelemetryEvent): Attributes {
  const attributes: Attributes = {
    'repoctopus.platform_event.envelope.id': event.envelopeId,
    'repoctopus.platform_event.provider': event.provider,
    'repoctopus.platform_event.source': event.source,
    'repoctopus.platform_event.delivery.id': event.deliveryId,
    'repoctopus.platform_event.type': event.eventType,
    'repoctopus.platform_event.status': event.status,
    'repoctopus.platform_event.attempts': event.attempts,
    'repoctopus.platform_event.state.version': event.stateVersion,
    'repoctopus.platform_event.event.type': event.type,
  };
  if (event.receiptId) attributes['repoctopus.platform_event.receipt.id'] = event.receiptId;
  if (event.diagnostic && SAFE_DIAGNOSTIC.test(event.diagnostic)) {
    attributes['repoctopus.platform_event.diagnostic'] = event.diagnostic;
  }
  return attributes;
}
