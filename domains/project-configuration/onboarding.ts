import { createHash, randomUUID } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import { hashProjectConfig, parseSharedProjectConfig } from './config.js';
import type { WorkspaceEntrySkillPlan } from './entry-skills.js';
import type {
  DetectionUnresolvedItem,
  ProjectConfigReconcileDiff,
  ProjectDetectionDraft,
  OpenSpecStoreBindingProposal,
} from './detection.js';
import { reconcileProjectConfig } from './reconcile.js';
import type { EffectiveProjectConfig, SharedProjectConfig } from './types.js';
import { compileEvidenceProfile } from '../feedback/profile.js';
import { resolveAcceptanceCoverage } from '../change-lifecycle/acceptance-coverage.js';
import type { SpecificationTask } from '../specification/types.js';

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
  entrySkills?: WorkspaceEntrySkillPlan[];
  profileUpdate?: { workspaceRoot: string; profileId: string };
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
  entrySkills?: WorkspaceEntrySkillPlan[];
  profileUpdate?: { workspaceRoot: string; profileId: string };
}): string {
  return `sha256:${createHash('sha256').update(canonicalJson(input)).digest('hex')}`;
}

function assertVerifyProfileReady(candidate: SharedProjectConfig, profileId: string): void {
  const profile = candidate.profiles.find((item) => item.id === profileId);
  if (!profile) return;
  const hasRequiredCoverage = profile?.nodes.some(
    (node) => node.required && (node.covers?.length ?? 0) > 0,
  );
  if (!hasRequiredCoverage) {
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
  if ((input.completedCandidate as { kind?: unknown } | null)?.kind === 'ProjectDetectionDraft') {
    throw new Error(
      'Candidate must be a RepoctopusWorkspace configuration. Use candidateConfig from the detection draft, or use project init.',
    );
  }
  const candidateConfig = parseSharedProjectConfig(input.completedCandidate);
  assertVerifyProfileReady(candidateConfig, 'verify');
  const storeBinding = input.draft.storeBinding;
  if (!storeBinding) {
    throw new Error(
      'Project detection draft is missing its Workspace Store binding. Run project init from the Workspace Git root.',
    );
  }
  if (
    !['registered-exact', 'healthy-unregistered', 'missing-root'].includes(
      storeBinding.root.disposition,
    )
  ) {
    throw new Error(
      `OpenSpec Root blocks project configuration approval: ${storeBinding.root.diagnosticCode ?? storeBinding.root.disposition}`,
    );
  }
  const configured = candidateConfig.specificationProvider?.store;
  if (
    !configured ||
    configured.id !== storeBinding.storeId ||
    configured.repositoryId !== storeBinding.workspaceRepositoryId
  ) {
    throw new Error('Candidate Specification Store does not match the detected binding proposal');
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
  return configurationRequest(input.requestId ?? randomUUID(), {
    draftId: input.draft.draftId,
    baseConfigDigest: input.draft.baseConfigDigest,
    candidateConfigDigest,
    candidateConfig,
    reconcile,
    unresolved: input.draft.unresolved,
    storeBinding: structuredClone(input.draft.storeBinding),
    ...(input.draft.entrySkills ? { entrySkills: structuredClone(input.draft.entrySkills) } : {}),
  });
}

function configurationRequest(
  requestId: string,
  candidate: Parameters<typeof projectConfigurationSnapshotDigest>[0],
): ProjectConfigurationDecisionRequest {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'HumanDecisionRequest',
    requestId,
    decisionType: 'project-configuration',
    ...candidate,
    snapshotDigest: projectConfigurationSnapshotDigest(candidate),
    options: ['approve', 'request_changes', 'reject'],
  };
}

export function createVerifyProfileDecision(input: {
  workspaceRoot: string;
  current: EffectiveProjectConfig;
  profile: unknown;
  run?: { profileId: string; tasks: readonly SpecificationTask[] };
}): ProjectConfigurationDecisionRequest {
  const profileId = (input.profile as { id?: unknown } | null)?.id;
  if (typeof profileId !== 'string' || !profileId.trim()) {
    throw new Error('Expected a single Verify Profile with an id and nodes');
  }
  if (input.run && input.run.profileId !== profileId) {
    throw new Error(`This Run requires Verify Profile '${input.run.profileId}'`);
  }
  const base = input.current.shared;
  const candidateConfig = parseSharedProjectConfig({
    ...base,
    profiles: [...base.profiles.filter(({ id }) => id !== profileId), input.profile],
  });
  assertVerifyProfileReady(candidateConfig, profileId);
  const plan = compileEvidenceProfile({ ...input.current, shared: candidateConfig }, profileId);
  if (input.run) resolveAcceptanceCoverage(input.run.tasks, plan);
  const requestId = randomUUID();
  return configurationRequest(requestId, {
    draftId: requestId,
    baseConfigDigest: hashProjectConfig(base),
    candidateConfigDigest: hashProjectConfig(candidateConfig),
    candidateConfig,
    reconcile: reconcileProjectConfig(base, candidateConfig),
    unresolved: [],
    storeBinding: null,
    profileUpdate: { workspaceRoot: input.workspaceRoot, profileId },
  });
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
    ...(input.request.entrySkills ? { entrySkills: input.request.entrySkills } : {}),
    ...(input.request.profileUpdate ? { profileUpdate: input.request.profileUpdate } : {}),
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
