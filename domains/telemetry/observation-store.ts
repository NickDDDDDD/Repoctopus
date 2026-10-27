import type { ObservationDigest, ObservationEnvelope } from './observation-envelope.js';

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

export interface ObservationAcknowledgement {
  destinationId: string;
  offset: number;
  envelopeId: ObservationDigest;
  acknowledgedAt: string;
}

export interface ObservationEnvelopeStore {
  append(envelope: ObservationEnvelope): Promise<StoredObservationEnvelope>;
  readAll(): Promise<readonly StoredObservationEnvelope[]>;
  readPending(
    destinationId: string,
    limit?: number,
  ): Promise<readonly StoredObservationEnvelope[]>;
  readCursor(destinationId: string): Promise<ObservationDestinationCursor>;
  acknowledge(input: ObservationAcknowledgement): Promise<ObservationDestinationCursor>;
}
