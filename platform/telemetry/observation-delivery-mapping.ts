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

function isStateForEvent(state: ObservableDeliveryState, event: DeliveryEvent): boolean {
  return state.changeId === event.changeId && state.stateVersion === event.stateVersion;
}

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

function safeId(value: unknown): string | undefined {
  const safe = scalar(value);
  return typeof safe === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/u.test(safe)
    ? safe
    : undefined;
}

function addCurrentDecisionFacts(
  attributes: Record<string, ObservationAttributeValue>,
  state: ObservableDeliveryState,
  event: DeliveryEvent,
): void {
  // A Delivery exporter may be asked to replay an older event with the latest state. State facts
  // are trustworthy for this event only when their persisted versions match.
  if (!isStateForEvent(state, event)) return;
  const request = state.decisionRequest;
  if (state.status === 'awaiting_approval' && request) {
    const requestId = safeId(request.requestId);
    if (!requestId) return;
    attributes['repoctopus.stage.name'] = 'delivery-approval';
    attributes['repoctopus.task.id'] = requestId;
    attributes['repoctopus.task.type'] = 'human-decision';
    attributes['repoctopus.task.status'] = 'blocked';
    attributes['repoctopus.blocker.category'] = 'human-decision';
    attributes['repoctopus.blocker.request.id'] = requestId;
    attributes['repoctopus.next_action.id'] = requestId;
    attributes['repoctopus.next_action.type'] = 'review-human-decision';
    attributes['repoctopus.next_action.stage'] = 'delivery-approval';
    return;
  }
  const approval = state.approval;
  if (event.type !== 'delivery.decided' || !approval) return;
  const requestId = safeId(approval.requestId);
  if (requestId) {
    attributes['repoctopus.stage.name'] = 'delivery-approval';
    attributes['repoctopus.task.id'] = requestId;
    attributes['repoctopus.task.type'] = 'human-decision';
    attributes['repoctopus.task.status'] = 'completed';
  }
  const subject = safeId(approval.actor.subject);
  const provider = safeId(approval.actor.provider);
  if (subject) {
    attributes['repoctopus.execution.subject.kind'] = 'human';
    attributes['repoctopus.execution.subject.id'] = subject;
  }
  if (provider) attributes['repoctopus.execution.subject.provider'] = provider;
}

export function deliveryObservationAttributes(
  state: ObservableDeliveryState,
  event: DeliveryEvent,
): Record<string, ObservationAttributeValue> {
  const attributes: Record<string, ObservationAttributeValue> = {
    'repoctopus.change.id': event.changeId,
    'repoctopus.delivery.change.id': event.changeId,
    'repoctopus.delivery.state.version': event.stateVersion,
    'repoctopus.delivery.event.id': event.eventId,
    'repoctopus.delivery.event.type': event.type,
  };
  if (isStateForEvent(state, event)) {
    attributes['repoctopus.delivery.state'] = state.status;
    attributes['repoctopus.delivery.repository.count'] = repositoryCount(state);
    if (state.snapshot) {
      attributes['repoctopus.composition.digest'] = state.snapshot.compositionDigest;
    }
  }
  for (const [key, value] of Object.entries(event.data)) {
    if (!SAFE_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const safe = scalar(value);
    if (safe !== undefined) attributes[`repoctopus.delivery.${key}`] = safe;
  }
  addCurrentDecisionFacts(attributes, state, event);
  return attributes;
}

function deliverySignals(
  state: ObservableDeliveryState,
  event: DeliveryEvent,
): ObservationSignal[] {
  const result = typeof event.data.result === 'string' ? event.data.result : undefined;
  const deliveryState = isStateForEvent(state, event) ? state.status : 'unknown';
  return [
    {
      kind: 'log',
      name: `repoctopus.${event.type}`,
      severity:
        result?.includes('failed') ||
        deliveryState === 'repair_required' ||
        deliveryState === 'rejected'
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
        'repoctopus.delivery.state': deliveryState,
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
