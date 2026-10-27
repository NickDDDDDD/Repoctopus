export const TELEMETRY_DESTINATION_KINDS = ['remote', 'desktop'] as const;
export const TELEMETRY_DELIVERY_RESULTS = ['delivered', 'failed', 'rejected'] as const;
export const TELEMETRY_RECEIVER_RESULTS = ['accepted', 'rejected'] as const;

export type TelemetryDestinationKind = (typeof TELEMETRY_DESTINATION_KINDS)[number];
export type TelemetryDeliveryResult = (typeof TELEMETRY_DELIVERY_RESULTS)[number];
export type TelemetryReceiverResult = (typeof TELEMETRY_RECEIVER_RESULTS)[number];

export interface TelemetryDestinationHealth {
  schemaVersion: 1;
  destination: { id: string; kind: TelemetryDestinationKind };
  cursorOffset: number;
  headOffset: number;
  cursorLag: number;
  backlog: { count: number; bytes: number; oldestAgeMs: number };
  lastResult: 'idle' | TelemetryDeliveryResult;
  retryCount: number;
  gapCount: number;
  retentionDroppedCount: number;
  retentionDroppedBytes: number;
  completeHistory: boolean;
  lastDeliveryLatencyMs?: number;
  receiver?: { result: TelemetryReceiverResult; latencyMs: number };
  observedAt: string;
}

interface PipelineFactBase {
  schemaVersion: 1;
  destinationId: string;
  destinationKind: TelemetryDestinationKind;
  cursorOffset: number;
  headOffset: number;
  cursorLag: number;
  backlogCount: number;
  backlogBytes: number;
  backlogOldestAgeMs: number;
  retryCount: number;
  gapCount: number;
  retentionDroppedCount: number;
  retentionDroppedBytes: number;
  completeHistory: boolean;
  observedAt: string;
}

export type TelemetryPipelineHealthFact =
  | (PipelineFactBase & {
      eventName: 'telemetry.delivery-started';
      operationId: string;
    })
  | (PipelineFactBase & {
      eventName: 'telemetry.delivery-completed';
      operationId: string;
      result: TelemetryDeliveryResult;
      deliveryLatencyMs: number;
    })
  | (PipelineFactBase & {
      eventName: 'telemetry.receiver-evaluated';
      result: TelemetryReceiverResult;
      receiverLatencyMs: number;
    })
  | (PipelineFactBase & {
      eventName: 'telemetry.gap-recorded';
      result: 'dropped';
      droppedCount: number;
      droppedBytes: number;
    });

export type TelemetryHealthMetricKind =
  | 'cursor-lag'
  | 'backlog-count'
  | 'backlog-bytes'
  | 'backlog-oldest-age'
  | 'retry-count'
  | 'gap-count'
  | 'retention-dropped-count'
  | 'retention-dropped-bytes'
  | 'delivery-latency';

export interface TelemetryDestinationMetricSample {
  instrument: 'gauge' | 'histogram';
  kind: TelemetryHealthMetricKind;
  destinationKind: TelemetryDestinationKind;
  result: TelemetryDestinationHealth['lastResult'];
  value: number;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const SENSITIVE_ID = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key)/iu;

function nonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Telemetry ${name} must be a non-negative safe integer`);
  }
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Telemetry ${name} must be a positive safe integer`);
  }
}

function timestamp(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Telemetry ${name} is invalid`);
}

function assertSnapshot(input: {
  cursorOffset: number;
  headOffset: number;
  backlogCount: number;
  backlogBytes: number;
  oldestAgeMs: number;
}): void {
  nonNegativeInteger(input.cursorOffset, 'cursor');
  nonNegativeInteger(input.headOffset, 'head');
  nonNegativeInteger(input.backlogCount, 'backlog count');
  nonNegativeInteger(input.backlogBytes, 'backlog bytes');
  nonNegativeInteger(input.oldestAgeMs, 'backlog oldest age');
  if (input.cursorOffset > input.headOffset) {
    throw new Error('Telemetry cursor cannot advance beyond the head');
  }
  const lag = input.headOffset - input.cursorOffset;
  if (
    (lag === 0 &&
      (input.backlogCount !== 0 || input.backlogBytes !== 0 || input.oldestAgeMs !== 0)) ||
    (input.backlogCount === 0 && (input.backlogBytes !== 0 || input.oldestAgeMs !== 0))
  ) {
    throw new Error('Telemetry backlog facts are inconsistent with the cursor lag');
  }
}

function assertObservedAfter(previous: string, next: string): void {
  timestamp(next, 'observedAt');
  if (Date.parse(next) < Date.parse(previous)) {
    throw new Error('Telemetry health observation cannot move backwards in time');
  }
}

function factBase(state: TelemetryDestinationHealth): PipelineFactBase {
  return {
    schemaVersion: 1,
    destinationId: state.destination.id,
    destinationKind: state.destination.kind,
    cursorOffset: state.cursorOffset,
    headOffset: state.headOffset,
    cursorLag: state.cursorLag,
    backlogCount: state.backlog.count,
    backlogBytes: state.backlog.bytes,
    backlogOldestAgeMs: state.backlog.oldestAgeMs,
    retryCount: state.retryCount,
    gapCount: state.gapCount,
    retentionDroppedCount: state.retentionDroppedCount,
    retentionDroppedBytes: state.retentionDroppedBytes,
    completeHistory: state.completeHistory,
    observedAt: state.observedAt,
  };
}

function nextSnapshot(
  state: TelemetryDestinationHealth,
  input: {
    cursorOffset: number;
    headOffset: number;
    backlogCount: number;
    backlogBytes: number;
    oldestAgeMs: number;
    observedAt: string;
  },
): TelemetryDestinationHealth {
  assertSnapshot(input);
  assertObservedAfter(state.observedAt, input.observedAt);
  if (input.headOffset < state.headOffset) {
    throw new Error('Telemetry head cannot regress');
  }
  return {
    ...state,
    cursorOffset: input.cursorOffset,
    headOffset: input.headOffset,
    cursorLag: input.headOffset - input.cursorOffset,
    backlog: {
      count: input.backlogCount,
      bytes: input.backlogBytes,
      oldestAgeMs: input.oldestAgeMs,
    },
    observedAt: input.observedAt,
  };
}

export function createTelemetryDestinationHealth(input: {
  destinationId: string;
  destinationKind: TelemetryDestinationKind;
  cursorOffset: number;
  headOffset: number;
  backlogCount: number;
  backlogBytes: number;
  oldestAgeMs: number;
  observedAt: string;
}): TelemetryDestinationHealth {
  if (!SAFE_ID.test(input.destinationId) || SENSITIVE_ID.test(input.destinationId)) {
    throw new Error('Telemetry destination identity is invalid');
  }
  if (!TELEMETRY_DESTINATION_KINDS.includes(input.destinationKind)) {
    throw new Error('Telemetry destination kind is invalid');
  }
  timestamp(input.observedAt, 'observedAt');
  assertSnapshot(input);
  return {
    schemaVersion: 1,
    destination: { id: input.destinationId, kind: input.destinationKind },
    cursorOffset: input.cursorOffset,
    headOffset: input.headOffset,
    cursorLag: input.headOffset - input.cursorOffset,
    backlog: {
      count: input.backlogCount,
      bytes: input.backlogBytes,
      oldestAgeMs: input.oldestAgeMs,
    },
    lastResult: 'idle',
    retryCount: 0,
    gapCount: 0,
    retentionDroppedCount: 0,
    retentionDroppedBytes: 0,
    completeHistory: true,
    observedAt: input.observedAt,
  };
}

export function startTelemetryDelivery(
  state: TelemetryDestinationHealth,
  input: { operationId: string; observedAt: string },
): TelemetryPipelineHealthFact {
  if (!SAFE_ID.test(input.operationId) || SENSITIVE_ID.test(input.operationId)) {
    throw new Error('Telemetry delivery operation is invalid');
  }
  assertObservedAfter(state.observedAt, input.observedAt);
  return {
    ...factBase({ ...state, observedAt: input.observedAt }),
    eventName: 'telemetry.delivery-started',
    operationId: input.operationId,
  };
}

export function completeTelemetryDelivery(
  state: TelemetryDestinationHealth,
  input: {
    operationId: string;
    result: TelemetryDeliveryResult;
    acknowledgedOffset?: number;
    headOffset: number;
    backlogCount: number;
    backlogBytes: number;
    oldestAgeMs: number;
    deliveryLatencyMs: number;
    observedAt: string;
  },
): { state: TelemetryDestinationHealth; fact: TelemetryPipelineHealthFact } {
  if (!SAFE_ID.test(input.operationId) || SENSITIVE_ID.test(input.operationId)) {
    throw new Error('Telemetry delivery operation is invalid');
  }
  if (!TELEMETRY_DELIVERY_RESULTS.includes(input.result)) {
    throw new Error('Telemetry delivery result is invalid');
  }
  nonNegativeInteger(input.deliveryLatencyMs, 'delivery latency');
  const delivered = input.result === 'delivered';
  if (delivered && input.acknowledgedOffset === undefined) {
    throw new Error('Delivered telemetry requires an acknowledged cursor');
  }
  if (!delivered && input.acknowledgedOffset !== undefined) {
    throw new Error('Failed telemetry delivery cannot advance its cursor');
  }
  const cursorOffset = input.acknowledgedOffset ?? state.cursorOffset;
  if (cursorOffset < state.cursorOffset) throw new Error('Telemetry cursor cannot regress');
  let next = nextSnapshot(state, {
    cursorOffset,
    headOffset: input.headOffset,
    backlogCount: input.backlogCount,
    backlogBytes: input.backlogBytes,
    oldestAgeMs: input.oldestAgeMs,
    observedAt: input.observedAt,
  });
  next = {
    ...next,
    lastResult: input.result,
    retryCount: delivered ? 0 : state.retryCount + 1,
    lastDeliveryLatencyMs: input.deliveryLatencyMs,
  };
  return {
    state: next,
    fact: {
      ...factBase(next),
      eventName: 'telemetry.delivery-completed',
      operationId: input.operationId,
      result: input.result,
      deliveryLatencyMs: input.deliveryLatencyMs,
    },
  };
}

export function recordTelemetryRetentionDrop(
  state: TelemetryDestinationHealth,
  input: {
    droppedCount: number;
    droppedBytes: number;
    headOffset: number;
    backlogCount: number;
    backlogBytes: number;
    oldestAgeMs: number;
    observedAt: string;
  },
): { state: TelemetryDestinationHealth; fact: TelemetryPipelineHealthFact } {
  positiveInteger(input.droppedCount, 'retention dropped count');
  positiveInteger(input.droppedBytes, 'retention dropped bytes');
  let next = nextSnapshot(state, {
    cursorOffset: state.cursorOffset,
    headOffset: input.headOffset,
    backlogCount: input.backlogCount,
    backlogBytes: input.backlogBytes,
    oldestAgeMs: input.oldestAgeMs,
    observedAt: input.observedAt,
  });
  next = {
    ...next,
    gapCount: state.gapCount + 1,
    retentionDroppedCount: state.retentionDroppedCount + input.droppedCount,
    retentionDroppedBytes: state.retentionDroppedBytes + input.droppedBytes,
    completeHistory: false,
  };
  return {
    state: next,
    fact: {
      ...factBase(next),
      eventName: 'telemetry.gap-recorded',
      result: 'dropped',
      droppedCount: input.droppedCount,
      droppedBytes: input.droppedBytes,
    },
  };
}

export function recordTelemetryReceiverEvaluation(
  state: TelemetryDestinationHealth,
  input: {
    result: TelemetryReceiverResult;
    receiverLatencyMs: number;
    observedAt: string;
  },
): { state: TelemetryDestinationHealth; fact: TelemetryPipelineHealthFact } {
  if (state.destination.kind !== 'desktop') {
    throw new Error('Telemetry Receiver facts belong to a desktop destination');
  }
  if (!TELEMETRY_RECEIVER_RESULTS.includes(input.result)) {
    throw new Error('Telemetry Receiver result is invalid');
  }
  nonNegativeInteger(input.receiverLatencyMs, 'Receiver latency');
  assertObservedAfter(state.observedAt, input.observedAt);
  const next: TelemetryDestinationHealth = {
    ...state,
    receiver: { result: input.result, latencyMs: input.receiverLatencyMs },
    observedAt: input.observedAt,
  };
  return {
    state: next,
    fact: {
      ...factBase(next),
      eventName: 'telemetry.receiver-evaluated',
      result: input.result,
      receiverLatencyMs: input.receiverLatencyMs,
    },
  };
}

export function telemetryDestinationMetricSamples(
  state: TelemetryDestinationHealth,
): readonly TelemetryDestinationMetricSample[] {
  const common = {
    destinationKind: state.destination.kind,
    result: state.lastResult,
  };
  return [
    { instrument: 'gauge', kind: 'cursor-lag', value: state.cursorLag, ...common },
    { instrument: 'gauge', kind: 'backlog-count', value: state.backlog.count, ...common },
    { instrument: 'gauge', kind: 'backlog-bytes', value: state.backlog.bytes, ...common },
    {
      instrument: 'gauge',
      kind: 'backlog-oldest-age',
      value: state.backlog.oldestAgeMs,
      ...common,
    },
    { instrument: 'gauge', kind: 'retry-count', value: state.retryCount, ...common },
    { instrument: 'gauge', kind: 'gap-count', value: state.gapCount, ...common },
    {
      instrument: 'gauge',
      kind: 'retention-dropped-count',
      value: state.retentionDroppedCount,
      ...common,
    },
    {
      instrument: 'gauge',
      kind: 'retention-dropped-bytes',
      value: state.retentionDroppedBytes,
      ...common,
    },
    ...(state.lastDeliveryLatencyMs === undefined
      ? []
      : [
          {
            instrument: 'histogram' as const,
            kind: 'delivery-latency' as const,
            value: state.lastDeliveryLatencyMs,
            ...common,
          },
        ]),
  ];
}
