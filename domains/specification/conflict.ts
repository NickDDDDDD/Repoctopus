import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  SpecificationConflict,
  SpecificationConflictDecisionRequest,
  SpecificationConflictDecisionResponse,
  SpecificationConflictResolution,
} from './types.js';

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function requestSpecificationConflictDecision(
  conflict: SpecificationConflict,
  requestId: string = randomUUID(),
): SpecificationConflictDecisionRequest {
  if (conflict.sources.length < 2) throw new Error('A requirements conflict needs two sources');
  if (conflict.affectedStepIds.length === 0) {
    throw new Error('A requirements conflict must identify affected steps');
  }
  const options = conflict.sources.map((source) => ({
    id: `select:${source.sourceId}`,
    label: source.summary,
    sourceId: source.sourceId,
    sourceRef: source.reference,
  }));
  const snapshotDigest = digest({ conflict, options });
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    decisionType: 'requirements-conflict',
    requestId,
    changeId: conflict.changeId,
    snapshotDigest,
    conflict: structuredClone(conflict),
    pausedStepIds: [...conflict.affectedStepIds],
    options,
  };
}

export function resolveSpecificationConflict(input: {
  request: SpecificationConflictDecisionRequest;
  response: SpecificationConflictDecisionResponse;
  timestamp: string;
}): SpecificationConflictResolution {
  const { request, response } = input;
  if (
    response.apiVersion !== 'repoctopus/v1alpha1' ||
    response.kind !== 'HumanDecisionResponse' ||
    response.requestId !== request.requestId ||
    response.snapshotDigest !== request.snapshotDigest
  ) {
    throw new Error('Requirements conflict response does not match the pending request');
  }
  const selected = request.options.find((option) => option.id === response.selectedOptionId);
  if (!selected) throw new Error('Requirements conflict response selected an unknown source');
  if (!/^sha256:[a-f0-9]{64}$/u.test(response.authorityUpdateDigest)) {
    throw new Error('Requirements conflict resolution requires an authority update digest');
  }
  return {
    conflictId: request.conflict.conflictId,
    selectedSourceId: selected.sourceId,
    authorityUpdateDigest: response.authorityUpdateDigest,
    resolvedAt: input.timestamp,
  };
}
