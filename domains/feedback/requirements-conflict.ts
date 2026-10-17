import type { EvidenceExecutionPlan } from './profile.js';
import {
  conflictDecisionsFromVisualResponse,
  type RequirementsConflictDecisionRequest,
  type VisualInspectionResponse,
} from './visual.js';

export interface RequirementsConflictDecisionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionResponse';
  requestId: string;
  snapshotDigest: string;
  selectedOptionId: string;
  comment?: string;
}

export interface TrustedDecisionActor {
  actorId: string;
  source: 'ide' | 'cli';
  authenticated: boolean;
}

export interface RequirementsConflictResolution {
  requestId: string;
  snapshotDigest: string;
  selectedOptionId: string;
  selectedSourceRef: string;
  actorId: string;
  source: TrustedDecisionActor['source'];
  decidedAt: string;
  comment?: string;
}

export type RequirementsConflictPause =
  | {
      status: 'completed';
      decisionRequests: [];
      pausedNodeIds: [];
    }
  | {
      status: 'awaiting_human';
      decisionRequests: RequirementsConflictDecisionRequest[];
      pausedNodeIds: string[];
    };

function affectedNodes(plan: EvidenceExecutionPlan, sourceNodeId: string): string[] {
  const known = new Set(plan.nodes.map((node) => node.id));
  if (!known.has(sourceNodeId)) throw new Error(`Unknown conflict source node: ${sourceNodeId}`);
  const affected = new Set([sourceNodeId]);
  for (const nodeId of plan.order) {
    const node = plan.nodes.find((candidate) => candidate.id === nodeId)!;
    if (node.dependsOn.some((dependency) => affected.has(dependency))) affected.add(nodeId);
  }
  return plan.order.filter((nodeId) => affected.has(nodeId));
}

/**
 * Converts visual authority conflicts into a pause boundary. It deliberately
 * produces no default selection; only the conflicting node and descendants pause.
 */
export function pauseForVisualRequirementsConflicts(input: {
  plan: EvidenceExecutionPlan;
  changeId: string;
  nodeId: string;
  response: VisualInspectionResponse;
}): RequirementsConflictPause {
  const decisionRequests = conflictDecisionsFromVisualResponse({
    changeId: input.changeId,
    nodeId: input.nodeId,
    response: input.response,
  });
  if (decisionRequests.length === 0) {
    return { status: 'completed', decisionRequests: [], pausedNodeIds: [] };
  }
  return {
    status: 'awaiting_human',
    decisionRequests,
    pausedNodeIds: affectedNodes(input.plan, input.nodeId),
  };
}

export function recordRequirementsConflictDecision(input: {
  request: RequirementsConflictDecisionRequest;
  response: RequirementsConflictDecisionResponse;
  actor: TrustedDecisionActor;
  timestamp: string;
}): RequirementsConflictResolution {
  if (!input.actor.authenticated) throw new Error('Requirements conflict decision is not trusted');
  if (
    input.response.apiVersion !== 'repoctopus/v1alpha1' ||
    input.response.kind !== 'HumanDecisionResponse' ||
    input.response.requestId !== input.request.requestId ||
    input.response.snapshotDigest !== input.request.snapshotDigest
  ) {
    throw new Error('Requirements conflict response does not match the pending request');
  }
  const selected = input.request.options.find(
    (option) => option.id === input.response.selectedOptionId,
  );
  if (!selected) throw new Error('Requirements conflict response selected an unknown option');
  return {
    requestId: input.request.requestId,
    snapshotDigest: input.request.snapshotDigest,
    selectedOptionId: selected.id,
    selectedSourceRef: selected.sourceRef,
    actorId: input.actor.actorId,
    source: input.actor.source,
    decidedAt: input.timestamp,
    ...(input.response.comment ? { comment: input.response.comment } : {}),
  };
}
