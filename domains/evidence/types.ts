import type { EvidenceDependencyRecord } from './dependencies.js';

export const EVIDENCE_API_VERSION = 'repoctopus/v1alpha1' as const;

export type EvidenceTrust = 'verified' | 'observed';
export type EvidenceFreshness = 'fresh' | 'reused' | 'superseded';
export type EvidenceNodeStatus = 'passed' | 'failed' | 'incomplete' | 'blocked';
export type GateOutcome = 'passed' | 'failed' | 'incomplete' | 'passed_with_warnings';

export interface ArtifactRef {
  apiVersion: typeof EVIDENCE_API_VERSION;
  kind: 'ArtifactRef';
  sha256: string;
  size: number;
  mediaType: string;
  artifactType: string;
  redacted: boolean;
}

export interface EvidenceFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  artifactRefs?: string[];
}

export interface EvidenceReceipt {
  schemaVersion: 1;
  apiVersion: typeof EVIDENCE_API_VERSION;
  kind: 'EvidenceReceipt';
  receiptId: string;
  compositionDigest: string;
  attemptId: string;
  nodeId: string;
  adapter: string;
  trust: EvidenceTrust;
  freshness: EvidenceFreshness;
  status: Exclude<EvidenceNodeStatus, 'blocked'>;
  inputFingerprint: string;
  startedAt: string;
  completedAt: string;
  exitCode?: number;
  process?: { pid: number; identity?: string };
  validUntil?: string;
  sourceReceiptId?: string;
  artifacts: ArtifactRef[];
  findings: EvidenceFinding[];
  dependencies: EvidenceDependencyRecord;
  sourceFingerprint: string;
  derivedInputs: EvidenceDerivedInput[];
  outputManifest: ArtifactRef | null;
}

export interface EvidenceDerivedInput {
  producerId: string;
  producerReceiptId: string;
  manifest: ArtifactRef;
  contentDigest: `sha256:${string}`;
}

export interface EvidenceAttempt {
  schemaVersion: 1;
  apiVersion: typeof EVIDENCE_API_VERSION;
  kind: 'EvidenceAttempt';
  attemptId: string;
  compositionDigest: string;
  profileId: string;
  inputFingerprint: string;
  startedAt: string;
  completedAt?: string;
  receiptIds: string[];
  status: 'running' | 'completed' | 'superseded';
  dependencies: EvidenceDependencyRecord;
}

export interface EvidenceCheck {
  nodeId: string;
  required: boolean;
  status: EvidenceNodeStatus;
  trust?: EvidenceTrust;
  freshness?: EvidenceFreshness;
  receiptId?: string;
  blockedBy?: string[];
}

export interface EvidenceAcceptanceContext {
  verificationInputDigest: `sha256:${string}`;
  acceptanceSetHash: `sha256:${string}`;
  acceptanceIds: readonly `acceptance-${string}`[];
  acceptanceCoverage: readonly {
    acceptanceId: `acceptance-${string}`;
    nodeIds: readonly string[];
  }[];
}

export interface AcceptanceTraceEntry {
  acceptanceId: `acceptance-${string}`;
  status: 'passed' | 'failed' | 'missing';
  nodeIds: string[];
  receiptIds: string[];
}

export interface AcceptanceTrace {
  schemaVersion: 1;
  verificationInputDigest: `sha256:${string}`;
  acceptanceSetHash: `sha256:${string}`;
  total: number;
  passed: number;
  failed: number;
  missing: number;
  entries: AcceptanceTraceEntry[];
  digest: `sha256:${string}`;
}

export interface EvidenceBundle {
  schemaVersion: 3;
  apiVersion: typeof EVIDENCE_API_VERSION;
  kind: 'EvidenceBundle';
  bundleId: string;
  compositionDigest: string;
  attemptId: string;
  profileId: string;
  inputFingerprint: string;
  createdAt: string;
  outcome: GateOutcome;
  acceptanceTrace: AcceptanceTrace | null;
  checks: EvidenceCheck[];
  receiptIds: string[];
  artifactDigests: string[];
  verificationReport?: ArtifactRef;
  findings: EvidenceFinding[];
  dependencies: EvidenceDependencyRecord;
}

export interface EvidenceGateProjection {
  schemaVersion: 3;
  kind: 'EvidenceGateProjection';
  workflowRunId: string | null;
  workflowActionId: string | null;
  workflowStepId: string | null;
  workflowStateVersion: number | null;
  checkEpoch: number | null;
  compositionDigest: string;
  profileId: string;
  bundleId: string;
  inputFingerprint: string;
  verificationInputDigest: `sha256:${string}` | null;
  acceptanceSetHash: `sha256:${string}` | null;
  outcome: GateOutcome;
  status: 'satisfied' | 'blocked';
  reason: string;
  dependencies: EvidenceDependencyRecord;
}
