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
}

export interface EvidenceAttempt {
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

export interface EvidenceBundle {
  apiVersion: typeof EVIDENCE_API_VERSION;
  kind: 'EvidenceBundle';
  bundleId: string;
  compositionDigest: string;
  attemptId: string;
  profileId: string;
  inputFingerprint: string;
  createdAt: string;
  outcome: GateOutcome;
  checks: EvidenceCheck[];
  receiptIds: string[];
  artifactDigests: string[];
  verificationReport?: ArtifactRef;
  findings: EvidenceFinding[];
}

export interface EvidenceGateProjection {
  schemaVersion: 1;
  kind: 'EvidenceGateProjection';
  workflowRunId: string | null;
  workflowActionId: string | null;
  workflowStepId: string | null;
  workflowStateVersion: number | null;
  compositionDigest: string;
  profileId: string;
  bundleId: string;
  inputFingerprint: string;
  outcome: GateOutcome;
  status: 'satisfied' | 'blocked';
  reason: string;
}
