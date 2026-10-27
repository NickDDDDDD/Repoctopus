import type { ObservationDigest, ObservationEnvelope } from './observation-envelope.js';
import type { TelemetryDestinationKind } from './pipeline-health.js';

export interface StoredObservationEnvelope {
  schemaVersion: 1;
  offset: number;
  envelope: ObservationEnvelope;
}

export interface ObservationDestinationCursor {
  schemaVersion: 1;
  destinationId: string;
  acknowledgedOffset: number;
  acknowledgedEnvelopeId: ObservationDigest | null;
  updatedAt: string;
}

export type ObservationDestinationMode = 'enabled' | 'paused' | 'removed';

export interface ObservationDestinationGap {
  schemaVersion: 1;
  destinationId: string;
  fromOffset: number;
  toOffset: number;
  droppedCount: number;
  droppedBytes: number;
  recordedAt: string;
}

export interface ObservationDestinationSnapshot {
  schemaVersion: 1;
  destination: { id: string; kind: TelemetryDestinationKind };
  mode: ObservationDestinationMode;
  deliverySemantics: 'at-least-once-replay';
  cursor: ObservationDestinationCursor;
  headOffset: number;
  cursorLag: number;
  nextOffset: number;
  backlog: { count: number; bytes: number; oldestAgeMs: number };
  gap: {
    count: number;
    droppedCount: number;
    droppedBytes: number;
    completeHistory: boolean;
  };
  changedAt: string;
}

export interface ObservationRetentionPolicy {
  maxEntries: number;
  maxBytes: number;
  maxAgeMs: number;
}

export interface ObservationRetentionResult {
  retainedCount: number;
  retainedBytes: number;
  droppedCount: number;
  droppedBytes: number;
  gaps: readonly ObservationDestinationGap[];
}

export interface ObservationAcknowledgement {
  destinationId: string;
  offset: number;
  envelopeId: ObservationDigest;
  acknowledgedAt: string;
}

export interface ObservationEnvelopeStore {
  append(envelope: ObservationEnvelope): Promise<StoredObservationEnvelope>;
  readAll(): Promise<readonly StoredObservationEnvelope[]>;
  readPending(destinationId: string, limit?: number): Promise<readonly StoredObservationEnvelope[]>;
  readCursor(destinationId: string): Promise<ObservationDestinationCursor>;
  acknowledge(input: ObservationAcknowledgement): Promise<ObservationDestinationCursor>;
  enableDestination(input: {
    destinationId: string;
    destinationKind: TelemetryDestinationKind;
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot>;
  pauseDestination(input: {
    destinationId: string;
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot>;
  removeDestination(input: {
    destinationId: string;
    changedAt: string;
  }): Promise<ObservationDestinationSnapshot>;
  readDestination(
    destinationId: string,
    observedAt?: string,
  ): Promise<ObservationDestinationSnapshot>;
  readGaps(destinationId: string): Promise<readonly ObservationDestinationGap[]>;
  enforceRetention(
    policy: ObservationRetentionPolicy,
    evaluatedAt: string,
  ): Promise<ObservationRetentionResult>;
}
