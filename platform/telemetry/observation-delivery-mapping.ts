import type { DeliveryEvent } from '../../domains/delivery/ports.js';
import type { DeliveryState, DeliveryStateV3 } from '../../domains/delivery/types.js';
import type {
  ObservationAttributeValue,
  ObservationEnvelope,
  ObservationSignal,
} from '../../domains/telemetry/observation-envelope.js';
import { mapObservationEnvelope } from '../../domains/telemetry/observation-envelope.js';

const SAFE_KEYS = new Set([
  'actionId',
  'actionType',
  'businessDeliveryCount',
  'decision',
  'mergedCount',
  'mergeRequestCount',
  'receiptDigest',
  'repositoryCount',
  'result',
  'runId',
  'snapshotDigest',
]);
const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|secret|token|api[-_]?key|environment|body|report|path|url)/iu;
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;

type ObservableDeliveryState = DeliveryState | DeliveryStateV3;

function scalar(value: unknown): ObservationAttributeValue | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (
    typeof value === 'string' &&
    value.length <= 256 &&
    !value.includes('\n') &&
    !value.includes('\r') &&
    !SENSITIVE_VALUE.test(value) &&
    !ABSOLUTE_PATH.test(value)
  ) {
    return value;
  }
  return undefined;
}

function repositoryCount(state: ObservableDeliveryState): number {
  if (!state.snapshot) return 0;
  return state.snapshot.schemaVersion === 3
    ? state.snapshot.businessDeliveries.length
    : state.snapshot.repositories.length;
}

export function deliveryObservationAttributes(
  state: ObservableDeliveryState,
  event: DeliveryEvent,
): Record<string, ObservationAttributeValue> {
  const attributes: Record<string, ObservationAttributeValue> = {
    'repoctopus.delivery.change.id': state.changeId,
    'repoctopus.delivery.state': state.status,
    'repoctopus.delivery.state.version': state.stateVersion,
    'repoctopus.delivery.event.id': event.eventId,
    'repoctopus.delivery.event.type': event.type,
    'repoctopus.delivery.repository.count': repositoryCount(state),
  };
  if (state.snapshot) {
    attributes['repoctopus.composition.digest'] = state.snapshot.compositionDigest;
  }
  for (const [key, value] of Object.entries(event.data)) {
    if (!SAFE_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const safe = scalar(value);
    if (safe !== undefined) attributes[`repoctopus.delivery.${key}`] = safe;
  }
  return attributes;
}

function deliverySignals(
  state: ObservableDeliveryState,
  event: DeliveryEvent,
): ObservationSignal[] {
  const result = typeof event.data.result === 'string' ? event.data.result : undefined;
  return [
    {
      kind: 'log',
      name: `repoctopus.${event.type}`,
      severity:
        result?.includes('failed') ||
        state.status === 'repair_required' ||
        state.status === 'rejected'
          ? 'warn'
          : 'info',
    },
    {
      kind: 'metric',
      name: 'repoctopus.delivery.events',
      value: 1,
      unit: 'event',
      aggregation: 'counter',
      attributes: {
        'repoctopus.delivery.event.type': event.type,
        'repoctopus.delivery.state': state.status,
      },
    },
  ];
}

export function mapDeliveryObservationEnvelope(
  state: ObservableDeliveryState,
  event: DeliveryEvent,
): ObservationEnvelope {
  const attributes = deliveryObservationAttributes(state, event);
  return mapObservationEnvelope(
    {
      source: {
        domain: 'delivery',
        eventId: event.eventId,
        eventType: event.type,
        sequence: event.stateVersion,
      },
      observedAt: event.timestamp,
      attributes,
    },
    { allowedAttributes: Object.keys(attributes), signals: deliverySignals(state, event) },
  );
}
