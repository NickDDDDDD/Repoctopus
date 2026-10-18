import { randomUUID } from 'node:crypto';

import type {
  ApprovalRecord,
  DeliverySnapshot,
  DeliveryState,
  HumanDecisionRequest,
  HumanDecisionResponse,
  TrustedActor,
} from './types.js';

export function initialDeliveryState(changeId: string, timestamp: string): DeliveryState {
  return {
    schemaVersion: 1,
    changeId,
    stateVersion: 0,
    status: 'development',
    snapshot: null,
    decisionRequest: null,
    approval: null,
    actionResults: [],
    mergeEvidence: [],
    platformCapabilities: [],
    updatedAt: timestamp,
  };
}

export function requestDeliveryApproval(
  state: DeliveryState,
  snapshot: DeliverySnapshot,
  timestamp: string,
  requestId: string = randomUUID(),
): DeliveryState {
  if (state.changeId !== snapshot.changeId) throw new Error('Cross-change snapshot rejected');
  if (!['development', 'verification_required', 'rejected'].includes(state.status))
    throw new Error(`Approval cannot be requested from ${state.status}`);
  const request: HumanDecisionRequest = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    requestId,
    decisionType: 'delivery-approval',
    changeId: state.changeId,
    snapshotDigest: snapshot.digest,
    reportDigest: snapshot.reportDigest,
    evidenceBundleIds: snapshot.evidenceBundleIds,
    repositories: snapshot.repositories.map(
      ({ repositoryId, repositoryName, sourceBranch, targetBranch }) => ({
        repositoryId,
        repositoryName,
        sourceBranch,
        targetBranch,
      }),
    ),
    actions: snapshot.plan.map(({ actionId, type, repositoryId }) => ({
      actionId,
      type,
      repositoryId,
    })),
    options: ['approve', 'request_changes', 'reject'],
  };
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: 'awaiting_approval',
    snapshot,
    decisionRequest: request,
    approval: null,
    actionResults: snapshot.plan.map(({ actionId }) => ({
      actionId,
      status: 'pending',
      attempts: 0,
    })),
    platformCapabilities: [],
    updatedAt: timestamp,
  };
}

export function recordHumanDecision(
  state: DeliveryState,
  response: HumanDecisionResponse,
  actor: TrustedActor,
  timestamp: string,
): DeliveryState {
  const request = state.decisionRequest;
  if (state.status !== 'awaiting_approval' || !request || !state.snapshot)
    throw new Error('Delivery is not awaiting approval');
  if (!actor.subject || !actor.provider || !actor.sessionId)
    throw new Error('Trusted actor context is incomplete');
  if (
    response.requestId !== request.requestId ||
    response.snapshotDigest !== request.snapshotDigest
  )
    throw new Error('Decision does not match the pending snapshot');
  const approval: ApprovalRecord = {
    schemaVersion: 1,
    requestId: request.requestId,
    changeId: state.changeId,
    snapshotDigest: state.snapshot.digest,
    decision: response.decision,
    actor,
    decidedAt: timestamp,
    ...(response.comment ? { comment: response.comment } : {}),
  };
  const status = response.decision === 'approve' ? 'approved' : 'rejected';
  return { ...state, stateVersion: state.stateVersion + 1, status, approval, updatedAt: timestamp };
}

export function invalidateApproval(state: DeliveryState, timestamp: string): DeliveryState {
  if (!state.approval) return state;
  return {
    ...state,
    stateVersion: state.stateVersion + 1,
    status: 'verification_required',
    approval: null,
    decisionRequest: null,
    updatedAt: timestamp,
  };
}
