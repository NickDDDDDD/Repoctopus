import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { assertEvidenceDependencyRecord, createEvidenceDependencyRecord } from './dependencies.js';
import { evidenceInputDigest } from './input-snapshot.js';
import { validateEvidenceReceiptIdentity } from './receipt.js';
import { aggregateGateOutcome } from './gate.js';
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
  if (
    item.schemaVersion !== 1 ||
    typeof item.sourceFingerprint !== 'string' ||
    !Array.isArray(item.derivedInputs) ||
    !('outputManifest' in item)
  )
    throw new Error('Unsupported EvidenceReceipt schemaVersion or input proof');
  assertEvidenceDependencyRecord(item.dependencies, 'receipt', item.receiptId);
  if (!validateEvidenceReceiptIdentity(item as unknown as EvidenceReceipt))
    throw new Error('EvidenceReceipt identity does not match its facts and dependencies');
  if (item.outputManifest !== null) parseArtifactRef(item.outputManifest);
  return structuredClone(item) as unknown as EvidenceReceipt;
}

export function parseEvidenceAttempt(value: unknown): EvidenceAttempt {
  const item = record(value, 'EvidenceAttempt');
  assertVersion(item);
  assertCompositionDigest(item, 'EvidenceAttempt');
  if (item.kind !== 'EvidenceAttempt' || typeof item.attemptId !== 'string') {
    throw new Error('Invalid EvidenceAttempt');
  }
  if (item.schemaVersion !== 1) throw new Error('Unsupported EvidenceAttempt schemaVersion');
  assertEvidenceDependencyRecord(item.dependencies, 'attempt', item.attemptId);
  return structuredClone(item) as unknown as EvidenceAttempt;
}

export function parseEvidenceBundle(value: unknown): EvidenceBundle {
  const item = record(value, 'EvidenceBundle');
  assertVersion(item);
  assertCompositionDigest(item, 'EvidenceBundle');
  if (item.kind !== 'EvidenceBundle' || typeof item.bundleId !== 'string') {
    throw new Error('Invalid EvidenceBundle');
  }
  if (item.schemaVersion !== 3 || !('acceptanceTrace' in item)) {
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
  assertEvidenceDependencyRecord(item.dependencies, 'bundle', item.bundleId);
  const expectedDependencies = createEvidenceDependencyRecord({
    subjectKind: 'bundle',
    subjectId: item.bundleId,
    dependencies: [
      { partition: 'implementation-content', identity: evidenceInputDigest(item.inputFingerprint) },
    ],
    dependsOnEvidenceIds: receiptIds,
  });
  if (canonicalJson(item.dependencies) !== canonicalJson(expectedDependencies))
    throw new Error('EvidenceBundle dependencies do not match its receipts');
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
