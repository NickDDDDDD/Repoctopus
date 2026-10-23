export type ObservationDestinationState = 'enabled' | 'paused' | 'removed';

export interface ObservationRetentionPolicy {
  maxEnvelopes: number;
  maxBytes: number;
  maxAgeMs?: number;
  maxGapRecords: number;
}

export interface ObservationRetentionGap {
  gapId: `sha256:${string}`;
  reason: 'retention-limit' | 'destination-removed';
  envelopeCount: number;
  bytes: number;
  firstObservedAt: string;
  lastObservedAt: string;
  recordedAt: string;
}

export interface ObservationDestinationHealth {
  status: 'healthy' | 'degraded';
  consecutiveFailures: number;
  lastFailureAt?: string;
  lastFailureCode?: string;
}

export interface ObservationDestinationCursor {
  schemaVersion: 2;
  destinationId: string;
  state: ObservationDestinationState;
  acknowledged: Record<string, string>;
  gaps: ObservationRetentionGap[];
  droppedEnvelopeCount: number;
  droppedBytes: number;
  health: ObservationDestinationHealth;
  updatedAt: string;
}

export interface ObservationDestinationStatus {
  schemaVersion: 1;
  destinationId: string;
  state: ObservationDestinationState;
  deliveryGuarantee: 'at-least-once';
  health: ObservationDestinationHealth;
  backlog: {
    envelopeCount: number;
    bytes: number;
    oldestObservedAt?: string;
    newestObservedAt?: string;
  };
  incomplete: boolean;
  gaps: ObservationRetentionGap[];
  droppedEnvelopeCount: number;
  droppedBytes: number;
  updatedAt: string;
}
