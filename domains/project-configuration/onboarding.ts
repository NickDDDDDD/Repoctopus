import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { hashProjectConfig, parseSharedProjectConfig } from './config.js';
import type {
  DetectionUnresolvedItem,
  ProjectConfigReconcileDiff,
  ProjectDetectionDraft,
  OpenSpecStoreBindingProposal,
} from './detection.js';
import { reconcileProjectConfig } from './reconcile.js';
import type { SharedProjectConfig } from './types.js';

export type ProjectConfigurationDecision = 'approve' | 'request_changes' | 'reject';

export interface ProjectConfigurationDecisionRequest {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionRequest';
  requestId: string;
  decisionType: 'project-configuration';
  draftId: string;
  snapshotDigest: string;
  baseConfigDigest: string | null;
  candidateConfigDigest: string;
  candidateConfig: SharedProjectConfig;
  reconcile: ProjectConfigReconcileDiff | null;
  unresolved: DetectionUnresolvedItem[];
  storeBinding: OpenSpecStoreBindingProposal | null;
  options: ProjectConfigurationDecision[];
}

export interface ProjectConfigurationDecisionResponse {
  apiVersion: 'repoctopus/v1alpha1';
  kind: 'HumanDecisionResponse';
  requestId: string;
  snapshotDigest: string;
  decision: ProjectConfigurationDecision;
  comment?: string;
}

export interface ProjectConfigurationDecisionActor {
  actorId: string;
  source: 'ide' | 'cli';
  authenticated: boolean;
}

export interface ProjectConfigurationDecisionRecord {
  requestId: string;
  draftId: string;
  snapshotDigest: string;
  candidateConfigDigest: string;
  decision: ProjectConfigurationDecision;
  actorId: string;
  source: ProjectConfigurationDecisionActor['source'];
  decidedAt: string;
  comment?: string;
}

function projectConfigurationSnapshotDigest(input: {
  draftId: string;
  baseConfigDigest: string | null;
  candidateConfigDigest: string;
  candidateConfig: SharedProjectConfig;
  reconcile: ProjectConfigReconcileDiff | null;
  unresolved: DetectionUnresolvedItem[];
  storeBinding: OpenSpecStoreBindingProposal | null;
}): string {
  return `sha256:${createHash('sha256').update(canonicalJson(input)).digest('hex')}`;
}

function assertDefaultVerifyProfileReady(candidate: SharedProjectConfig): void {
  const profile = candidate.profiles.find((item) => item.id === 'verify');
  const hasRequiredCoverage = profile?.nodes.some(
    (node) => node.required && (node.covers?.length ?? 0) > 0,
  );
  if (!profile || !hasRequiredCoverage) {
    throw new Error(
      'Default verify Profile requires at least one required coverage selector before approval',
    );
  }
}

export function createProjectConfigurationDecision(input: {
  draft: ProjectDetectionDraft;
  completedCandidate: unknown;
  currentConfig: SharedProjectConfig | null;
  requestId?: string;
}): ProjectConfigurationDecisionRequest {
  const candidateConfig = parseSharedProjectConfig(input.completedCandidate);
  assertDefaultVerifyProfileReady(candidateConfig);
  if (input.draft.storeBinding) {
    if (
      !['registered-exact', 'healthy-unregistered', 'missing-root'].includes(
        input.draft.storeBinding.root.disposition,
      )
    ) {
      throw new Error(
        `OpenSpec Root blocks project configuration approval: ${input.draft.storeBinding.root.diagnosticCode ?? input.draft.storeBinding.root.disposition}`,
      );
    }
    const configured = candidateConfig.specificationProvider?.store;
    if (
      !configured ||
      configured.id !== input.draft.storeBinding.storeId ||
      configured.repositoryId !== input.draft.storeBinding.workspaceRepositoryId
    ) {
      throw new Error('Candidate Specification Store does not match the detected binding proposal');
    }
  }
  const currentDigest = input.currentConfig ? hashProjectConfig(input.currentConfig) : null;
  if (currentDigest !== input.draft.baseConfigDigest) {
    throw new Error(
      'Shared project configuration changed after detection; run project detect again',
    );
  }
  const candidateConfigDigest = hashProjectConfig(candidateConfig);
  const reconcile = input.currentConfig
    ? reconcileProjectConfig(input.currentConfig, candidateConfig)
    : null;
  const snapshotDigest = projectConfigurationSnapshotDigest({
    draftId: input.draft.draftId,
    baseConfigDigest: input.draft.baseConfigDigest,
    candidateConfigDigest,
    candidateConfig,
    reconcile,
    unresolved: input.draft.unresolved,
    storeBinding: input.draft.storeBinding,
  });
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    requestId: input.requestId ?? randomUUID(),
    decisionType: 'project-configuration',
    draftId: input.draft.draftId,
    snapshotDigest,
    baseConfigDigest: input.draft.baseConfigDigest,
    candidateConfigDigest,
    candidateConfig,
    reconcile,
    unresolved: input.draft.unresolved,
    storeBinding: structuredClone(input.draft.storeBinding),
    options: ['approve', 'request_changes', 'reject'],
  };
}

export function recordProjectConfigurationDecision(input: {
  request: ProjectConfigurationDecisionRequest;
  response: ProjectConfigurationDecisionResponse;
  actor: ProjectConfigurationDecisionActor;
  timestamp: string;
}): ProjectConfigurationDecisionRecord {
  if (!input.actor.authenticated) throw new Error('Project configuration decision is not trusted');
  const candidateConfig = parseSharedProjectConfig(input.request.candidateConfig);
  const candidateConfigDigest = hashProjectConfig(candidateConfig);
  const snapshotDigest = projectConfigurationSnapshotDigest({
    draftId: input.request.draftId,
    baseConfigDigest: input.request.baseConfigDigest,
    candidateConfigDigest: input.request.candidateConfigDigest,
    candidateConfig,
    reconcile: input.request.reconcile,
    unresolved: input.request.unresolved,
    storeBinding: input.request.storeBinding,
  });
  if (
    candidateConfigDigest !== input.request.candidateConfigDigest ||
    snapshotDigest !== input.request.snapshotDigest
  ) {
    throw new Error('Pending project configuration request no longer matches its snapshot');
  }
  if (
    input.response.apiVersion !== 'repoctopus/v1alpha1' ||
    input.response.kind !== 'HumanDecisionResponse' ||
    input.response.requestId !== input.request.requestId ||
    input.response.snapshotDigest !== input.request.snapshotDigest
  ) {
    throw new Error('Project configuration response does not match the pending request');
  }
  if (!input.request.options.includes(input.response.decision)) {
    throw new Error('Project configuration response selected an unknown decision');
  }
  return {
    requestId: input.request.requestId,
    draftId: input.request.draftId,
    snapshotDigest: input.request.snapshotDigest,
    candidateConfigDigest: input.request.candidateConfigDigest,
    decision: input.response.decision,
    actorId: input.actor.actorId,
    source: input.actor.source,
    decidedAt: input.timestamp,
    ...(input.response.comment ? { comment: input.response.comment } : {}),
  };
}
