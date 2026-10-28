import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { SpecificationTaskSet } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';

export type Digest = `sha256:${string}`;
export type ExecutionIsolation = 'current' | 'branch' | 'worktree';
export type BuildExecutionMode = 'autonomous' | 'subagent-driven-development';
export type BuildTddMode = 'tdd' | 'direct';
export type BuildReviewMode = 'standard';
export type BuildActionKind = 'configure' | 'plan' | 'plan-evidence' | 'execute' | 'check';

const ISOLATIONS = new Set<ExecutionIsolation>(['current', 'branch', 'worktree']);
const EXECUTION_MODES = new Set<BuildExecutionMode>(['autonomous', 'subagent-driven-development']);
const TDD_MODES = new Set<BuildTddMode>(['tdd', 'direct']);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const GIT_HEAD = /^[a-f0-9]{40,64}$/u;
const MAX_PACKAGES = 256;
const MAX_ITEMS = 256;
const MAX_TEXT = 512;

function digest(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function text(value: string, label: string, maximum = MAX_TEXT): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters`);
  }
  return normalized;
}

function unique(values: readonly string[], label: string, maximum = MAX_ITEMS): string[] {
  if (values.length > maximum) throw new Error(`${label} exceeds ${maximum} items`);
  const normalized = values.map((value) => text(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate entries`);
  }
  return normalized.sort();
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export interface ExecutionWorkspaceIntent {
  schemaVersion: 1;
  workspaceId: string;
  changeId: string;
  isolation: ExecutionIsolation;
  targetBranch: string | null;
  semanticDigest: Digest;
  intentId: string;
}

export interface ExecutionRepositoryBinding {
  repositoryId: string;
  checkoutPath: string;
  branch: string;
  head: string;
  worktreeId: string | null;
  workspaceOwned: boolean;
}

export interface ExecutionWorkspaceBinding {
  schemaVersion: 1;
  intentDigest: Digest;
  isolation: ExecutionIsolation;
  repositories: readonly ExecutionRepositoryBinding[];
  semanticDigest: Digest;
  localDigest: Digest;
  bindingId: string;
}

export function createExecutionWorkspaceIntent(input: {
  workspaceId: string;
  changeId: string;
  isolation: ExecutionIsolation;
  targetBranch?: string | null;
}): ExecutionWorkspaceIntent {
  if (!ISOLATIONS.has(input.isolation)) throw new Error('Unsupported execution isolation');
  const targetBranch = input.targetBranch?.trim() || null;
  if (input.isolation === 'branch' && !targetBranch) {
    throw new Error('Branch isolation requires a target branch');
  }
  const stable = {
    schemaVersion: 1 as const,
    workspaceId: text(input.workspaceId, 'Workspace identity'),
    changeId: text(input.changeId, 'Change identity'),
    isolation: input.isolation,
    targetBranch,
  };
  const semanticDigest = digest(stable);
  return deepFreeze({
    ...stable,
    semanticDigest,
    intentId: `workspace-intent:${semanticDigest.slice(-24)}`,
  }) as ExecutionWorkspaceIntent;
}

export function createExecutionWorkspaceBinding(input: {
  intent: ExecutionWorkspaceIntent;
  repositories: readonly ExecutionRepositoryBinding[];
}): ExecutionWorkspaceBinding {
  if (!SHA256.test(input.intent.semanticDigest))
    throw new Error('Workspace intent digest is invalid');
  if (input.repositories.length === 0 || input.repositories.length > MAX_ITEMS) {
    throw new Error('Execution workspace binding requires bounded repositories');
  }
  const repositories = input.repositories
    .map((entry) => ({
      repositoryId: text(entry.repositoryId, 'Repository identity'),
      checkoutPath: text(entry.checkoutPath, 'Checkout path', 4096),
      branch: text(entry.branch, 'Repository branch'),
      head: text(entry.head, 'Repository head'),
      worktreeId: entry.worktreeId?.trim() || null,
      workspaceOwned: entry.workspaceOwned,
    }))
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  if (new Set(repositories.map((entry) => entry.repositoryId)).size !== repositories.length) {
    throw new Error('Execution workspace binding contains duplicate repositories');
  }
  for (const repository of repositories) {
    if (!isAbsolute(repository.checkoutPath)) throw new Error('Checkout path must be absolute');
    if (!GIT_HEAD.test(repository.head)) throw new Error('Repository head must be a Git object id');
    if (!repository.workspaceOwned) throw new Error('Repository checkout is not Workspace-owned');
    if (input.intent.isolation === 'worktree' && !repository.worktreeId) {
      throw new Error('Worktree isolation requires worktree ownership facts');
    }
    if (input.intent.isolation === 'current' && repository.worktreeId) {
      throw new Error('Current isolation cannot claim a linked worktree');
    }
    if (input.intent.targetBranch && repository.branch !== input.intent.targetBranch) {
      throw new Error('Repository branch does not match the Workspace intent');
    }
  }
  const portable = {
    schemaVersion: 1 as const,
    intentDigest: input.intent.semanticDigest,
    isolation: input.intent.isolation,
    repositories: repositories.map(({ checkoutPath: _checkoutPath, ...entry }) => entry),
  };
  const semanticDigest = digest(portable);
  const localDigest = digest({ ...portable, repositories });
  return deepFreeze({
    ...portable,
    repositories,
    semanticDigest,
    localDigest,
    bindingId: `workspace-binding:${semanticDigest.slice(-24)}`,
  }) as ExecutionWorkspaceBinding;
}

export interface BuildConfigurationProposal {
  schemaVersion: 1;
  workspaceIntent: ExecutionWorkspaceIntent;
  executionMode: BuildExecutionMode;
  tddMode: BuildTddMode;
  reviewMode: BuildReviewMode;
  isolation: ExecutionIsolation;
  bindingDigest: Digest;
  bindingSemanticDigest: Digest;
  hostId: string;
  hostCapabilities: readonly string[];
  semanticDigest: Digest;
  proposalId: string;
}

export interface BuildConfiguration extends BuildConfigurationProposal {
  configurationId: string;
  approval: {
    requestId: string;
    actorId: string;
    decidedAt: string;
    proposalDigest: Digest;
  };
}

export function createBuildConfigurationProposal(input: {
  intent: ExecutionWorkspaceIntent;
  binding: ExecutionWorkspaceBinding;
  executionMode: BuildExecutionMode;
  tddMode: BuildTddMode;
  reviewMode: BuildReviewMode;
  hostId: string;
  hostCapabilities: readonly string[];
}): BuildConfigurationProposal {
  if (!EXECUTION_MODES.has(input.executionMode))
    throw new Error('Unsupported Build execution mode');
  if (!TDD_MODES.has(input.tddMode)) throw new Error('Unsupported Build TDD mode');
  if (input.reviewMode !== 'standard') throw new Error('Build review mode must be standard');
  if (
    input.binding.intentDigest !== input.intent.semanticDigest ||
    input.binding.isolation !== input.intent.isolation
  ) {
    throw new Error('Execution workspace binding does not match the approved intent');
  }
  const hostCapabilities = unique(input.hostCapabilities, 'Host capabilities');
  const requiredCapability =
    input.executionMode === 'autonomous' ? 'build.autonomous' : 'subagent.dispatch.attested';
  if (!hostCapabilities.includes(requiredCapability)) {
    throw new Error(`Selected execution mode requires ${requiredCapability}`);
  }
  const stable = {
    schemaVersion: 1 as const,
    workspaceIntent: input.intent,
    executionMode: input.executionMode,
    tddMode: input.tddMode,
    reviewMode: input.reviewMode,
    isolation: input.intent.isolation,
    bindingDigest: input.binding.localDigest,
    bindingSemanticDigest: input.binding.semanticDigest,
    hostId: text(input.hostId, 'Host identity'),
    hostCapabilities,
  };
  const semanticDigest = digest(stable);
  return deepFreeze({
    ...stable,
    semanticDigest,
    proposalId: `build-configuration-proposal:${semanticDigest.slice(-24)}`,
  }) as BuildConfigurationProposal;
}

export function acceptBuildConfiguration(input: {
  proposal: BuildConfigurationProposal;
  requestId: string;
  actorId: string;
  decidedAt: string;
}): BuildConfiguration {
  const decidedAt = new Date(input.decidedAt);
  if (Number.isNaN(decidedAt.valueOf())) throw new Error('Configuration approval time is invalid');
  return deepFreeze({
    ...input.proposal,
    configurationId: `build-configuration:${input.proposal.semanticDigest.slice(-24)}`,
    approval: {
      requestId: text(input.requestId, 'Decision request identity'),
      actorId: text(input.actorId, 'Decision actor identity'),
      decidedAt: decidedAt.toISOString(),
      proposalDigest: input.proposal.semanticDigest,
    },
  }) as BuildConfiguration;
}

export interface WorkPackageWriteScope {
  repositoryId: string;
  paths: readonly string[];
}

export interface WorkPackageCandidate {
  packageKey: string;
  taskIds: readonly string[];
  repositoryIds: readonly string[];
  writeScopes: readonly WorkPackageWriteScope[];
  acceptanceRefs: readonly string[];
  expectedOutcomes: readonly string[];
  validatorProfile: string;
  dependsOn: readonly string[];
}

export interface WorkPackage {
  schemaVersion: 1;
  packageId: string;
  packageKey: string;
  taskIds: readonly string[];
  repositoryIds: readonly string[];
  writeScopes: readonly WorkPackageWriteScope[];
  acceptanceRefs: readonly string[];
  expectedOutcomes: readonly string[];
  validatorProfile: string;
  dependsOn: readonly string[];
  digest: Digest;
}

export interface BuildPlan {
  schemaVersion: 1;
  runId: string;
  planId: string;
  revision: number;
  configurationId: string;
  configurationDigest: Digest;
  planningDigest: Digest;
  taskSetDigest: Digest;
  packages: readonly WorkPackage[];
  digest: Digest;
}

function assertAcyclic(packages: readonly WorkPackage[]): void {
  const byId = new Map(packages.map((entry) => [entry.packageId, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (packageId: string) => {
    if (visiting.has(packageId)) throw new Error('Build Plan package dependency cycle detected');
    if (visited.has(packageId)) return;
    const current = byId.get(packageId);
    if (!current) throw new Error(`Build Plan references unknown package dependency: ${packageId}`);
    visiting.add(packageId);
    for (const dependency of current.dependsOn) visit(dependency);
    visiting.delete(packageId);
    visited.add(packageId);
  };
  for (const entry of packages) visit(entry.packageId);
}

export function createBuildPlan(input: {
  runId: string;
  revision: number;
  configuration: BuildConfiguration;
  planningDigest: Digest;
  tasks: SpecificationTaskSet;
  candidate: { packages: readonly WorkPackageCandidate[] };
}): BuildPlan {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Build Plan revision must be a positive safe integer');
  }
  if (!SHA256.test(input.planningDigest)) throw new Error('Planning digest is invalid');
  if (input.candidate.packages.length === 0) throw new Error('Build Plan must cover every Task');
  if (input.candidate.packages.length > MAX_PACKAGES)
    throw new Error('Build Plan has too many packages');
  const keys = input.candidate.packages.map((entry) => text(entry.packageKey, 'Package key'));
  if (new Set(keys).size !== keys.length)
    throw new Error('Build Plan contains duplicate package key');
  const taskIds = new Set(input.tasks.tasks.map((task) => task.taskId));
  const acceptanceIds = new Set<string>(
    input.tasks.tasks.flatMap((task) => task.acceptanceCriteria.map((item) => item.acceptanceId)),
  );
  const prepared = input.candidate.packages.map((candidate) => {
    const stable = {
      schemaVersion: 1 as const,
      packageKey: text(candidate.packageKey, 'Package key'),
      taskIds: unique(candidate.taskIds, 'Package Task references'),
      repositoryIds: unique(candidate.repositoryIds, 'Package repository references'),
      writeScopes: candidate.writeScopes
        .map((scope) => ({
          repositoryId: text(scope.repositoryId, 'Write scope repository identity'),
          paths: unique(scope.paths, 'Write scope paths'),
        }))
        .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
      acceptanceRefs: unique(candidate.acceptanceRefs, 'Package acceptance references'),
      expectedOutcomes: unique(candidate.expectedOutcomes, 'Package expected outcomes'),
      validatorProfile: text(candidate.validatorProfile, 'Package validator profile'),
    };
    if (stable.taskIds.some((taskId) => !taskIds.has(taskId))) {
      throw new Error('Build Plan package references an unknown Task');
    }
    if (stable.acceptanceRefs.some((acceptanceId) => !acceptanceIds.has(acceptanceId))) {
      throw new Error('Build Plan package references unknown acceptance criteria');
    }
    if (stable.repositoryIds.length === 0 || stable.writeScopes.length === 0) {
      throw new Error('Build Plan package requires repository and write scope boundaries');
    }
    if (stable.writeScopes.some((scope) => !stable.repositoryIds.includes(scope.repositoryId))) {
      throw new Error('Build Plan write scope exceeds package repository bindings');
    }
    const packageDigest = digest(stable);
    return {
      ...stable,
      packageId: `work-package:${packageDigest.slice(-24)}`,
      dependsOnKeys: unique(candidate.dependsOn, 'Package dependencies'),
      digest: packageDigest,
    };
  });
  const byKey = new Map(prepared.map((entry) => [entry.packageKey, entry.packageId]));
  const packages: WorkPackage[] = prepared.map(({ dependsOnKeys, ...entry }) => ({
    ...entry,
    dependsOn: dependsOnKeys.map((key) => {
      const packageId = byKey.get(key);
      if (!packageId) throw new Error(`Build Plan references unknown package dependency: ${key}`);
      return packageId;
    }),
  }));
  assertAcyclic(packages);
  const covered = new Set(packages.flatMap((entry) => entry.taskIds));
  if ([...taskIds].some((taskId) => !covered.has(taskId))) {
    throw new Error('Build Plan must cover every Task');
  }
  const stable = {
    schemaVersion: 1 as const,
    runId: text(input.runId, 'Run identity'),
    revision: input.revision,
    configurationId: input.configuration.configurationId,
    configurationDigest: input.configuration.semanticDigest,
    planningDigest: input.planningDigest,
    taskSetDigest: input.tasks.digest,
    packages,
  };
  const planDigest = digest(stable);
  return deepFreeze({
    ...stable,
    planId: `build-plan:${planDigest.slice(-24)}`,
    digest: planDigest,
  }) as BuildPlan;
}

export interface BuildPlanValidation {
  accepted: boolean;
  diagnostics: readonly string[];
  inputDigest: Digest;
}

export function validateBuildPlan(input: {
  plan: BuildPlan;
  configuration: BuildConfiguration;
  tasks: SpecificationTaskSet;
}): BuildPlanValidation {
  const diagnostics: string[] = [];
  if (input.plan.configurationId !== input.configuration.configurationId) {
    diagnostics.push('configuration identity drifted');
  }
  if (input.plan.configurationDigest !== input.configuration.semanticDigest) {
    diagnostics.push('configuration digest drifted');
  }
  if (input.plan.taskSetDigest !== input.tasks.digest) diagnostics.push('Task set drifted');
  const taskIds = new Set(input.tasks.tasks.map((task) => task.taskId));
  const covered = new Set(input.plan.packages.flatMap((entry) => entry.taskIds));
  if ([...taskIds].some((taskId) => !covered.has(taskId)))
    diagnostics.push('Task coverage incomplete');
  try {
    assertAcyclic(input.plan.packages);
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  return deepFreeze({
    accepted: diagnostics.length === 0,
    diagnostics,
    inputDigest: digest({
      plan: input.plan.digest,
      configuration: input.configuration.semanticDigest,
      tasks: input.tasks.digest,
    }),
  }) as BuildPlanValidation;
}

export interface BuildProtocolState {
  schemaVersion: 1;
  runId: string;
  planningDigest: Digest;
  workspaceIntent: ExecutionWorkspaceIntent;
  currentAction: BuildActionKind | null;
  status: 'active' | 'ready-for-verify';
  actionAttempt: number;
  configuration: BuildConfiguration | null;
  plan: BuildPlan | null;
  revision: number;
}

export type BuildProtocolObservation =
  | { kind: 'configuration-approved'; configuration: BuildConfiguration }
  | {
      kind: 'host-outcome';
      action: 'execute' | 'check';
      accepted: boolean;
      requestedNextAction?: BuildActionKind;
    }
  | { kind: 'plan-accepted'; plan: BuildPlan }
  | { kind: 'plan-evidence-accepted'; planDigest: Digest }
  | { kind: 'retry'; action: BuildActionKind };

export function createBuildProtocolState(input: {
  runId: string;
  planningDigest: Digest;
  workspaceIntent: ExecutionWorkspaceIntent;
}): BuildProtocolState {
  return deepFreeze({
    schemaVersion: 1,
    runId: text(input.runId, 'Run identity'),
    planningDigest: input.planningDigest,
    workspaceIntent: input.workspaceIntent,
    currentAction: 'configure',
    status: 'active',
    actionAttempt: 1,
    configuration: null,
    plan: null,
    revision: 0,
  }) as BuildProtocolState;
}

export function advanceBuildProtocol(
  state: BuildProtocolState,
  observation: BuildProtocolObservation,
): BuildProtocolState {
  if (observation.kind === 'retry') {
    if (observation.action !== state.currentAction) {
      throw new Error('Retry does not match the current Runtime-selected Action');
    }
    return deepFreeze({ ...state, actionAttempt: state.actionAttempt + 1 }) as BuildProtocolState;
  }
  if (observation.kind === 'configuration-approved') {
    if (state.currentAction !== 'configure') {
      throw new Error('Configuration approval does not match the current Runtime-selected Action');
    }
    if (
      observation.configuration.workspaceIntent.semanticDigest !==
      state.workspaceIntent.semanticDigest
    ) {
      throw new Error('Configuration approval changed the Workspace intent');
    }
    return deepFreeze({
      ...state,
      currentAction: 'plan',
      actionAttempt: 1,
      configuration: observation.configuration,
      revision: state.revision + 1,
    }) as BuildProtocolState;
  }
  if (observation.kind === 'plan-accepted') {
    if (state.currentAction !== 'plan') {
      throw new Error('Plan does not match the current Runtime-selected Action');
    }
    if (observation.plan.configurationId !== state.configuration?.configurationId) {
      throw new Error('Plan does not bind the frozen Build Configuration');
    }
    return deepFreeze({
      ...state,
      currentAction: 'plan-evidence',
      actionAttempt: 1,
      plan: observation.plan,
      revision: state.revision + 1,
    }) as BuildProtocolState;
  }
  if (observation.kind === 'plan-evidence-accepted') {
    if (state.currentAction !== 'plan-evidence') {
      throw new Error('Plan Evidence does not match the current Runtime-selected Action');
    }
    if (observation.planDigest !== state.plan?.digest) throw new Error('Plan Evidence is stale');
    return deepFreeze({
      ...state,
      currentAction: 'execute',
      actionAttempt: 1,
      revision: state.revision + 1,
    }) as BuildProtocolState;
  }
  if (observation.requestedNextAction) throw new Error('Host cannot select the next Build Action');
  if (observation.action !== state.currentAction) {
    throw new Error('Host Outcome does not match the current Runtime-selected Action');
  }
  if (!observation.accepted) {
    return deepFreeze({ ...state, actionAttempt: state.actionAttempt + 1 }) as BuildProtocolState;
  }
  const next: BuildActionKind = 'check';
  if (observation.action === 'check') {
    return deepFreeze({
      ...state,
      currentAction: null,
      status: 'ready-for-verify',
      actionAttempt: 1,
      revision: state.revision + 1,
    }) as BuildProtocolState;
  }
  return deepFreeze({
    ...state,
    currentAction: next,
    actionAttempt: 1,
    revision: state.revision + 1,
  }) as BuildProtocolState;
}

export interface PlanEvidence {
  schemaVersion: 1;
  evidenceId: string;
  planDigest: Digest;
  configurationDigest: Digest;
  validationDigest: Digest;
  accepted: true;
}

export function createPlanEvidence(input: {
  plan: BuildPlan;
  configuration: BuildConfiguration;
  validation: BuildPlanValidation;
}): PlanEvidence {
  if (!input.validation.accepted) throw new Error('Rejected Build Plan cannot produce Evidence');
  if (
    input.plan.configurationDigest !== input.configuration.semanticDigest ||
    input.validation.inputDigest !==
      digest({
        plan: input.plan.digest,
        configuration: input.configuration.semanticDigest,
        tasks: input.plan.taskSetDigest,
      })
  ) {
    throw new Error('Build Plan Evidence input drifted');
  }
  const stable = {
    schemaVersion: 1 as const,
    planDigest: input.plan.digest,
    configurationDigest: input.configuration.semanticDigest,
    validationDigest: input.validation.inputDigest,
    accepted: true as const,
  };
  return deepFreeze({
    ...stable,
    evidenceId: `plan-evidence:${digest(stable).slice(-24)}`,
  }) as PlanEvidence;
}

export type BuildFindingClassification =
  | 'implementation'
  | 'planning'
  | 'evidence-infrastructure'
  | 'unknown';

export interface BuildFinding {
  findingId: string;
  classification: BuildFindingClassification;
  blocking: boolean;
  requirementRefs: readonly string[];
  taskIds: readonly string[];
  packageIds: readonly string[];
  summary: string;
}

export interface BuildCheckEvidence {
  schemaVersion: 1;
  evidenceId: string;
  configurationDigest: Digest;
  planDigest: Digest;
  repositoryDigest: Digest;
  implementationDigest: Digest;
  completedPackageIds: readonly string[];
  acceptedTaskIds: readonly string[];
  testEvidenceIds: readonly string[];
  review: { mode: 'standard'; implementationExecutionId: string; reviewerExecutionId: string };
  findings: readonly BuildFinding[];
  accepted: boolean;
  digest: Digest;
}

export function createBuildCheckEvidence(
  input: Omit<BuildCheckEvidence, 'schemaVersion' | 'evidenceId' | 'accepted' | 'digest'>,
): BuildCheckEvidence {
  if (input.review.mode !== 'standard') throw new Error('Build Check review mode must be standard');
  if (input.review.implementationExecutionId === input.review.reviewerExecutionId) {
    throw new Error('Standard review requires an independent reviewer execution identity');
  }
  const accepted = input.findings.every((finding) => !finding.blocking);
  const stable = {
    schemaVersion: 1 as const,
    ...input,
    completedPackageIds: unique(input.completedPackageIds, 'Completed package identities'),
    acceptedTaskIds: unique(input.acceptedTaskIds, 'Accepted Task identities'),
    testEvidenceIds: unique(input.testEvidenceIds, 'Test Evidence identities'),
    findings: input.findings.map((finding) => ({
      ...finding,
      findingId: text(finding.findingId, 'Finding identity'),
      summary: text(finding.summary, 'Finding summary', 2048),
      requirementRefs: unique(finding.requirementRefs, 'Finding requirement references'),
      taskIds: unique(finding.taskIds, 'Finding Task references'),
      packageIds: unique(finding.packageIds, 'Finding package references'),
    })),
    accepted,
  };
  const checkDigest = digest(stable);
  return deepFreeze({
    ...stable,
    evidenceId: `build-check:${checkDigest.slice(-24)}`,
    digest: checkDigest,
  }) as BuildCheckEvidence;
}
