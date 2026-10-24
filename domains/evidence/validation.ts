import {
  EVIDENCE_API_VERSION,
  type ArtifactRef,
  type EvidenceAttempt,
  type EvidenceBundle,
  type EvidenceReceipt,
} from './types.js';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertVersion(value: Record<string, unknown>): void {
  if (value.apiVersion !== EVIDENCE_API_VERSION) {
    throw new Error(`Unsupported evidence apiVersion: ${String(value.apiVersion)}`);
  }
}

function assertCompositionDigest(value: Record<string, unknown>, label: string): void {
  if (
    typeof value.compositionDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value.compositionDigest)
  ) {
    throw new Error(`${label}.compositionDigest must be a sha256 digest`);
  }
}

export function parseArtifactRef(value: unknown): ArtifactRef {
  const item = record(value, 'ArtifactRef');
  assertVersion(item);
  if (item.kind !== 'ArtifactRef' || typeof item.sha256 !== 'string') {
    throw new Error('Invalid ArtifactRef');
  }
  return structuredClone(item) as unknown as ArtifactRef;
}

export function parseEvidenceReceipt(value: unknown): EvidenceReceipt {
  const item = record(value, 'EvidenceReceipt');
  assertVersion(item);
  assertCompositionDigest(item, 'EvidenceReceipt');
  if (item.kind !== 'EvidenceReceipt' || typeof item.receiptId !== 'string') {
    throw new Error('Invalid EvidenceReceipt');
  }
  if (!Array.isArray(item.artifacts)) throw new Error('EvidenceReceipt.artifacts must be an array');
  item.artifacts.forEach(parseArtifactRef);
  return structuredClone(item) as unknown as EvidenceReceipt;
}

export function parseEvidenceAttempt(value: unknown): EvidenceAttempt {
  const item = record(value, 'EvidenceAttempt');
  assertVersion(item);
  assertCompositionDigest(item, 'EvidenceAttempt');
  if (item.kind !== 'EvidenceAttempt' || typeof item.attemptId !== 'string') {
    throw new Error('Invalid EvidenceAttempt');
  }
  return structuredClone(item) as unknown as EvidenceAttempt;
}

export function parseEvidenceBundle(value: unknown): EvidenceBundle {
  const item = record(value, 'EvidenceBundle');
  assertVersion(item);
  assertCompositionDigest(item, 'EvidenceBundle');
  if (item.kind !== 'EvidenceBundle' || typeof item.bundleId !== 'string') {
    throw new Error('Invalid EvidenceBundle');
  }
  if (!Array.isArray(item.checks) || !Array.isArray(item.receiptIds)) {
    throw new Error('Invalid EvidenceBundle collections');
  }
  if (item.verificationReport !== undefined) parseArtifactRef(item.verificationReport);
  return structuredClone(item) as unknown as EvidenceBundle;
}
