import type { ArtifactRef, EvidenceAttempt, EvidenceBundle, EvidenceReceipt } from './types.js';

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
}
