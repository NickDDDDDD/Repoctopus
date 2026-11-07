import type { EvidenceGateProjection } from '../evidence/types.js';
import type { ChangeLifecycleSnapshot } from './transition.js';

export interface AcceptedVerifyGate {
  runId: string;
  workId: string;
  inputDigest: `sha256:${string}`;
  attemptId: string;
  bundleId: string;
  evidenceInputFingerprint: string;
  checkEpoch: number;
}

export interface RejectedVerifyGate {
  workId: string;
  inputDigest: `sha256:${string}`;
  evidenceInputFingerprint: string;
  attemptId: string;
  bundleId: string | null;
  reason: string;
  result: 'implementation-failure' | 'evidence-unavailable' | 'evidence-drift';
  checkEpoch: number;
}

export function acceptVerifyGate(input: {
  runId: string;
  lifecycle: ChangeLifecycleSnapshot;
  gate: EvidenceGateProjection;
  attemptId: string;
  checkEpoch: number;
}): AcceptedVerifyGate {
  const { lifecycle, gate } = input;
  const work = lifecycle.currentWork;
  const verification = lifecycle.verificationInput;
  if (
    lifecycle.phase !== 'verify' ||
    lifecycle.status !== 'running' ||
    !work ||
    work.kind !== 'evidence.verify' ||
    !verification
  ) {
    throw new Error('Change Run has no active Verify Work');
  }
  if (verification.runId !== input.runId) {
    throw new Error('Verification input belongs to another Change Run');
  }
  if (work.inputDigest !== verification.digest) {
    throw new Error('Verify Work input digest does not match the immutable verification input');
  }
  if (gate.workflowRunId !== input.runId) {
    throw new Error(`Evidence attempt ${input.attemptId} is bound to another workflow run`);
  }
  if (gate.workflowActionId !== work.workId) {
    throw new Error(`Evidence attempt ${input.attemptId} is bound to another Verify Work`);
  }
  if (gate.workflowStepId !== 'verify') {
    throw new Error(`Evidence attempt ${input.attemptId} is not bound to the Verify phase`);
  }
  if (gate.checkEpoch !== input.checkEpoch || lifecycle.checkEpoch !== input.checkEpoch) {
    throw new Error(`Evidence attempt ${input.attemptId} is bound to a stale checkEpoch`);
  }
  if (gate.profileId !== verification.evidenceProfile.id) {
    throw new Error(`Evidence attempt ${input.attemptId} uses another Evidence Profile`);
  }
  if (gate.inputFingerprint !== verification.evidenceProfile.fingerprintDigest) {
    throw new Error(
      `Evidence attempt ${input.attemptId} was produced from stale verification inputs`,
    );
  }
  if (gate.compositionDigest !== verification.compositionDigest) {
    throw new Error(`Evidence attempt ${input.attemptId} was produced by another composition`);
  }
  if (
    gate.verificationInputDigest !== verification.digest ||
    gate.acceptanceSetHash !== verification.acceptanceSetHash
  ) {
    throw new Error(`Evidence attempt ${input.attemptId} has no matching Acceptance Trace`);
  }
  if (gate.status !== 'satisfied') {
    throw new Error(`Evidence Gate blocked the transition: ${gate.reason}`);
  }
  return {
    runId: input.runId,
    workId: work.workId,
    inputDigest: verification.digest,
    attemptId: input.attemptId,
    bundleId: gate.bundleId,
    evidenceInputFingerprint: gate.inputFingerprint,
    checkEpoch: input.checkEpoch,
  };
}

export function rejectVerifyGate(input: {
  runId: string;
  lifecycle: ChangeLifecycleSnapshot;
  gate: EvidenceGateProjection;
  attemptId: string;
  checkEpoch: number;
  result?: RejectedVerifyGate['result'];
}): RejectedVerifyGate {
  const { lifecycle, gate } = input;
  const work = lifecycle.currentWork;
  const verification = lifecycle.verificationInput;
  if (
    lifecycle.phase !== 'verify' ||
    lifecycle.status !== 'running' ||
    !work ||
    work.kind !== 'evidence.verify' ||
    !verification
  ) {
    throw new Error('Change Run has no active Verify Work');
  }
  if (
    gate.workflowRunId !== input.runId ||
    gate.workflowActionId !== work.workId ||
    gate.workflowStepId !== 'verify'
  ) {
    throw new Error(`Evidence attempt ${input.attemptId} is bound to another Run or Verify Work`);
  }
  if (gate.checkEpoch !== input.checkEpoch || lifecycle.checkEpoch !== input.checkEpoch) {
    throw new Error(`Evidence attempt ${input.attemptId} is bound to a stale checkEpoch`);
  }
  if (
    gate.profileId !== verification.evidenceProfile.id ||
    gate.compositionDigest !== verification.compositionDigest
  ) {
    throw new Error(
      `Evidence attempt ${input.attemptId} has an incompatible verification identity`,
    );
  }
  if (gate.status !== 'blocked') {
    throw new Error(`Evidence attempt ${input.attemptId} is not a rejected Gate`);
  }
  return {
    workId: work.workId,
    inputDigest: verification.digest,
    evidenceInputFingerprint: gate.inputFingerprint,
    attemptId: input.attemptId,
    bundleId: gate.bundleId,
    reason: gate.reason,
    result: input.result ?? 'implementation-failure',
    checkEpoch: input.checkEpoch,
  };
}
