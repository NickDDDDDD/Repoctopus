import type { ArtifactRef, EvidenceAttempt, EvidenceBundle, EvidenceReceipt } from './types.js';
import type { EvidenceNodeInputSnapshot } from './input-snapshot.js';
import type { EvidenceDerivedInput } from './types.js';

export interface EvidenceInputProofPort {
  captureDerived(
    snapshot: EvidenceNodeInputSnapshot,
    predecessors: ReadonlyMap<string, EvidenceReceipt>,
  ): Promise<EvidenceDerivedInput[]>;
  captureOutputs(snapshot: EvidenceNodeInputSnapshot): Promise<ArtifactRef | null>;
  outputsCurrent(snapshot: EvidenceNodeInputSnapshot, receipt: EvidenceReceipt): Promise<boolean>;
}

export interface PutArtifactOptions {
  artifactType: string;
  mediaType: string;
  redacted: boolean;
}

export interface ArtifactStore {
  put(contents: Uint8Array | string, options: PutArtifactOptions): Promise<ArtifactRef>;
  read(reference: ArtifactRef): Promise<Uint8Array>;
  exists(reference: ArtifactRef): Promise<boolean>;
}

export interface EvidenceStore {
  saveAttempt(attempt: EvidenceAttempt): Promise<void>;
  loadAttempt(attemptId: string): Promise<EvidenceAttempt>;
  saveReceipt(receipt: EvidenceReceipt): Promise<void>;
  loadReceipt(receiptId: string): Promise<EvidenceReceipt>;
  saveBundle(bundle: EvidenceBundle): Promise<void>;
  loadBundle(bundleId: string): Promise<EvidenceBundle>;
  findBundleByAttempt(attemptId: string): Promise<EvidenceBundle | null>;
}

export interface EvidenceJournalEntry {
  schemaVersion: 1;
  sequence: number;
  eventId: string;
  attemptId: string;
  nodeId: string;
  timestamp: string;
  type: 'node.intent' | 'node.completed';
  receiptId?: string;
}

export interface EvidenceJournal {
  recordIntent(attemptId: string, nodeId: string, timestamp: string): Promise<void>;
  recordCompletion(
    attemptId: string,
    nodeId: string,
    receiptId: string,
    timestamp: string,
  ): Promise<void>;
  load(attemptId: string): Promise<EvidenceJournalEntry[]>;
}
