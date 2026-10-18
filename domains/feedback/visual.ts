import { createHash, randomUUID } from 'node:crypto';

import type { ArtifactRef } from '../evidence/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export interface VisualInspectionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'VisualInspectionRequest';
  requestId: string;
  screenshot: ArtifactRef;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  page: { url: string; title?: string };
  criteria: Array<{ id: string; text: string; sourceRef?: string }>;
  designReferences: ArtifactRef[];
}

export interface RequirementsConflict {
  conflictId: string;
  summary: string;
  impact: string;
  sources: Array<{
    sourceType: 'openspec' | 'design' | 'api-contract' | 'other';
    sourceRef: string;
    requirement: string;
  }>;
}

export interface VisualFinding {
  findingId: string;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  region?: { x: number; y: number; width: number; height: number };
  evidenceRefs: string[];
  conflict?: RequirementsConflict;
}

export interface VisualInspectionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'VisualInspectionResponse';
  responseId: string;
  requestId: string;
  screenshotSha256: string;
  findings: VisualFinding[];
}

export interface VisualInspectionAdapter {
  inspect(request: VisualInspectionRequest): Promise<VisualInspectionResponse | null>;
}

export type VisualInspectionResult =
  | { status: 'incomplete'; request: VisualInspectionRequest; response: null }
  | {
      status: 'completed';
      request: VisualInspectionRequest;
      response: VisualInspectionResponse;
    };

export interface RequirementsConflictDecisionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  requestId: string;
  decisionType: 'requirements-conflict';
  changeId: string;
  nodeId: string;
  snapshotDigest: string;
  conflict: RequirementsConflict;
  options: Array<{ id: string; label: string; sourceRef: string }>;
}

export function createVisualInspectionRequest(
  input: Omit<VisualInspectionRequest, 'apiVersion' | 'kind' | 'requestId'> & {
    requestId?: string;
  },
): VisualInspectionRequest {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'VisualInspectionRequest',
    requestId: input.requestId ?? randomUUID(),
    screenshot: input.screenshot,
    viewport: input.viewport,
    page: input.page,
    criteria: input.criteria,
    designReferences: input.designReferences,
  };
}

export function validateVisualInspectionResponse(
  request: VisualInspectionRequest,
  response: VisualInspectionResponse,
): void {
  if (
    response.apiVersion !== 'repoctopus/v1alpha1' ||
    response.kind !== 'VisualInspectionResponse'
  ) {
    throw new Error('Unsupported VisualInspectionResponse envelope');
  }
  if (response.requestId !== request.requestId) {
    throw new Error('Visual response requestId does not match the current request');
  }
  if (response.screenshotSha256 !== request.screenshot.sha256) {
    throw new Error('Visual response screenshot does not match the current artifact');
  }
  for (const finding of response.findings) {
    if (
      finding.evidenceRefs.length === 0 ||
      !finding.evidenceRefs.includes(request.screenshot.sha256)
    ) {
      throw new Error(
        `Visual finding lacks the current screenshot reference: ${finding.findingId}`,
      );
    }
  }
}

export async function collectVisualInspection(
  request: VisualInspectionRequest,
  adapter?: VisualInspectionAdapter,
): Promise<VisualInspectionResult> {
  if (!adapter) return { status: 'incomplete', request, response: null };
  const response = await adapter.inspect(request);
  if (!response) return { status: 'incomplete', request, response: null };
  validateVisualInspectionResponse(request, response);
  return { status: 'completed', request, response };
}

export function createRequirementsConflictDecision(input: {
  changeId: string;
  nodeId: string;
  conflict: RequirementsConflict;
  requestId?: string;
}): RequirementsConflictDecisionRequest {
  if (input.conflict.sources.length < 2) {
    throw new Error('A requirements conflict needs at least two authority sources');
  }
  const snapshotDigest = `sha256:${createHash('sha256')
    .update(canonicalJson(input.conflict))
    .digest('hex')}`;
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    requestId: input.requestId ?? randomUUID(),
    decisionType: 'requirements-conflict',
    changeId: input.changeId,
    nodeId: input.nodeId,
    snapshotDigest,
    conflict: input.conflict,
    options: input.conflict.sources.map((source, index) => ({
      id: `source-${index + 1}`,
      label: `采用 ${source.sourceType}: ${source.sourceRef}`,
      sourceRef: source.sourceRef,
    })),
  };
}

export function conflictDecisionsFromVisualResponse(input: {
  changeId: string;
  nodeId: string;
  response: VisualInspectionResponse;
}): RequirementsConflictDecisionRequest[] {
  return input.response.findings
    .filter(
      (finding): finding is VisualFinding & { conflict: RequirementsConflict } =>
        finding.conflict !== undefined,
    )
    .map((finding) =>
      createRequirementsConflictDecision({
        changeId: input.changeId,
        nodeId: input.nodeId,
        conflict: finding.conflict,
      }),
    );
}
