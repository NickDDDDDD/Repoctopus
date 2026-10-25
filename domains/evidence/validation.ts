import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
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
  if (item.schemaVersion !== 2 || !('acceptanceTrace' in item)) {
    throw new Error('Unsupported EvidenceBundle schemaVersion');
  }
  if (
    !Array.isArray(item.checks) ||
    !Array.isArray(item.receiptIds) ||
    item.receiptIds.some((receiptId) => typeof receiptId !== 'string')
  ) {
    throw new Error('Invalid EvidenceBundle collections');
  }
  const receiptIds = item.receiptIds as string[];
  if (item.acceptanceTrace !== null) {
    const trace = record(item.acceptanceTrace, 'EvidenceBundle.acceptanceTrace');
    if (
      trace.schemaVersion !== 1 ||
      !Array.isArray(trace.entries) ||
      typeof trace.digest !== 'string'
    ) {
      throw new Error('Invalid EvidenceBundle Acceptance Trace');
    }
    const entries = trace.entries.map((entry, index) =>
      record(entry, `EvidenceBundle.acceptanceTrace.entries[${index}]`),
    );
    const acceptanceIds = entries.map((entry) => entry.acceptanceId);
    if (
      acceptanceIds.some((id) => typeof id !== 'string') ||
      new Set(acceptanceIds).size !== acceptanceIds.length ||
      entries.some(
        (entry) =>
          !Array.isArray(entry.receiptIds) ||
          (entry.receiptIds as unknown[]).some(
            (receiptId) => typeof receiptId !== 'string' || !receiptIds.includes(receiptId),
          ),
      )
    ) {
      throw new Error('EvidenceBundle Acceptance Trace has invalid identity references');
    }
    const { digest, ...base } = trace;
    const expected = `sha256:${createHash('sha256').update(canonicalJson(base)).digest('hex')}`;
    if (digest !== expected) throw new Error('EvidenceBundle Acceptance Trace digest mismatch');
  }
  if (item.verificationReport !== undefined) parseArtifactRef(item.verificationReport);
  return structuredClone(item) as unknown as EvidenceBundle;
}
