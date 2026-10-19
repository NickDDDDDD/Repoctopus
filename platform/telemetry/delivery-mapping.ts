import type { Attributes } from '@opentelemetry/api';

import type { DeliveryEvent } from '../../domains/delivery/ports.js';
import type { DeliveryState } from '../../domains/delivery/types.js';

const SAFE_KEYS = new Set([
  'actionId',
  'actionType',
  'decision',
  'mergedCount',
  'mergeRequestCount',
  'repositoryCount',
  'result',
  'snapshotDigest',
]);
const SENSITIVE_KEY =
  /(authorization|cookie|credential|password|secret|token|api[-_]?key|environment|body|report|path|url)/i;
const SENSITIVE_VALUE = /(bearer\s+|gh[opusr]_[a-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i;

export function safeDeliveryAttributes(state: DeliveryState, event: DeliveryEvent): Attributes {
  const attributes: Attributes = {
    'repoctopus.delivery.change.id': state.changeId,
    'repoctopus.delivery.state': state.status,
    'repoctopus.delivery.state.version': state.stateVersion,
    'repoctopus.delivery.event.id': event.eventId,
    'repoctopus.delivery.event.type': event.type,
    'repoctopus.delivery.repository.count': state.snapshot?.repositories.length ?? 0,
    ...(state.snapshot
      ? { 'repoctopus.composition.digest': state.snapshot.compositionDigest }
      : {}),
  };
  for (const [key, value] of Object.entries(event.data)) {
    if (!SAFE_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === 'string' && value.length <= 256 && !SENSITIVE_VALUE.test(value))
      attributes[`repoctopus.delivery.${key}`] = value;
    else if (typeof value === 'number' && Number.isFinite(value))
      attributes[`repoctopus.delivery.${key}`] = value;
    else if (typeof value === 'boolean') attributes[`repoctopus.delivery.${key}`] = value;
  }
  return attributes;
}
