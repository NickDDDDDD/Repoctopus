import type { EvidenceGateProjection } from '../evidence/types.js';
import type { EvidenceGatePort } from './types.js';

/**
 * Evaluate the evidence immediately before a protected Runtime transition.
 *
 * A manually reported success cannot advance a protected step. Evidence is
 * re-evaluated against the current inputs at the point of use.
 */
export async function requireSatisfiedEvidenceGate(options: {
  gate: EvidenceGatePort | undefined;
  workflowRunId: string;
  workflowActionId: string;
  workflowStepId: string;
  workflowStateVersion: number;
  profileId: string;
  attemptId: string | undefined;
  compositionDigest: string;
}): Promise<EvidenceGateProjection> {
  if (!options.attemptId) {
    throw new Error(`Evidence profile ${options.profileId} requires a Runtime evidence attempt`);
  }
  if (!options.gate) {
    throw new Error(`Evidence Gate is not configured for profile ${options.profileId}`);
  }
  const projection = await options.gate.evaluate({
    workflowRunId: options.workflowRunId,
    workflowActionId: options.workflowActionId,
    workflowStepId: options.workflowStepId,
    workflowStateVersion: options.workflowStateVersion,
    profileId: options.profileId,
    attemptId: options.attemptId,
  });
  if (projection.workflowRunId !== options.workflowRunId) {
    throw new Error(`Evidence attempt ${options.attemptId} is bound to another workflow run`);
  }
  if (projection.workflowActionId !== options.workflowActionId) {
    throw new Error(`Evidence attempt ${options.attemptId} is bound to another workflow action`);
  }
  if (projection.workflowStepId !== options.workflowStepId) {
    throw new Error(`Evidence attempt ${options.attemptId} is bound to another workflow step`);
  }
  if (projection.workflowStateVersion !== options.workflowStateVersion) {
    throw new Error(`Evidence attempt ${options.attemptId} is bound to a stale workflow state`);
  }
  if (projection.profileId !== options.profileId) {
    throw new Error(
      `Evidence attempt ${options.attemptId} does not satisfy profile ${options.profileId}`,
    );
  }
  if (projection.compositionDigest !== options.compositionDigest) {
    throw new Error(`Evidence attempt ${options.attemptId} was produced by another composition`);
  }
  if (projection.status !== 'satisfied') {
    throw new Error(`Evidence Gate blocked the transition: ${projection.reason}`);
  }
  return projection;
}
