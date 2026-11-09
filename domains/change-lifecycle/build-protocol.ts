import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { SpecificationTaskSet } from '../specification/types.js';
import type { RuntimeIdentityKind } from '../runtime/identity.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  assertEvidenceDependencyRecord,
  createEvidenceDependencyRecord,
  evidenceDependencySetDigest,
  type EvidenceDependency,
  type EvidenceDependencyRecord,
} from '../evidence/dependencies.js';
import { isProtectedBranch, normalizeProtectedBranchPatterns } from '../delivery/branch-policy.js';
import { assertVerifyRepair } from './verify-repair.js';

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

function scopePath(value: string): string {
  const normalized = text(value, 'Write scope path', 2048).replaceAll('\\', '/');
  if (
    isAbsolute(normalized) ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error('Build Plan write scope path must stay repository-relative');
  }
  return normalized.replace(/^\.\//u, '');
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export interface ExecutionWorkspaceIntent {
  schemaVersion: 2;
  workspaceId: string;
  changeId: string;
  isolation: ExecutionIsolation;
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
  stateDigest: Digest;
  bindingId: string;
}

export function createExecutionWorkspaceIntent(input: {
  workspaceId: string;
  changeId: string;
  isolation: ExecutionIsolation;
}): ExecutionWorkspaceIntent {
  if (!ISOLATIONS.has(input.isolation)) throw new Error('Unsupported execution isolation');
  const stable = {
    schemaVersion: 2 as const,
    workspaceId: text(input.workspaceId, 'Workspace identity'),
    changeId: text(input.changeId, 'Change identity'),
    isolation: input.isolation,
  };
  const semanticDigest = digest(stable);
  return deepFreeze({
    ...stable,
    semanticDigest,
    intentId: `workspace-intent:${semanticDigest.slice(-24)}`,
  });
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
  }
  const portable = {
    schemaVersion: 1 as const,
    intentDigest: input.intent.semanticDigest,
    isolation: input.intent.isolation,
    repositories: repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      branch: repository.branch,
      worktreeId: repository.worktreeId,
      workspaceOwned: repository.workspaceOwned,
    })),
  };
  const semanticDigest = digest(portable);
  const localDigest = digest({
    ...portable,
    repositories: repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      checkoutPath: repository.checkoutPath,
      branch: repository.branch,
      worktreeId: repository.worktreeId,
      workspaceOwned: repository.workspaceOwned,
    })),
  });
  const stateDigest = digest({ ...portable, repositories });
  return deepFreeze({
    ...portable,
    repositories,
    semanticDigest,
    localDigest,
    stateDigest,
    bindingId: `workspace-binding:${semanticDigest.slice(-24)}`,
  });
}

/**
 * Stable, human-reviewable Build choices. Machine observations deliberately do
 * not belong here: changing Runner, checkout path or HEAD must not invalidate a
 * decision that still means the same thing to the team.
 */
export interface BuildStrategy {
  schemaVersion: 1;
  strategyId: string;
  revision: number;
  executionMode: BuildExecutionMode;
  tddMode: BuildTddMode;
  reviewMode: BuildReviewMode;
  isolationIntent: ExecutionIsolation;
  semanticDigest: Digest;
}

export function createBuildStrategy(input: {
  runId: string;
  revision: number;
  executionMode: BuildExecutionMode;
  tddMode: BuildTddMode;
  reviewMode: BuildReviewMode;
  isolationIntent: ExecutionIsolation;
}): BuildStrategy {
  const runId = text(input.runId, 'Run identity');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Build Strategy revision must be a positive safe integer');
  }
  if (!EXECUTION_MODES.has(input.executionMode)) {
    throw new Error('Unsupported Build execution mode');
  }
  if (!TDD_MODES.has(input.tddMode)) throw new Error('Unsupported Build TDD mode');
  if (input.reviewMode !== 'standard') throw new Error('Build review mode must be standard');
  if (!ISOLATIONS.has(input.isolationIntent)) {
    throw new Error('Unsupported Build isolation intent');
  }
  const stable = {
    schemaVersion: 1 as const,
    executionMode: input.executionMode,
    tddMode: input.tddMode,
    reviewMode: input.reviewMode,
    isolationIntent: input.isolationIntent,
  };
  const semanticDigest = digest(stable);
  return deepFreeze({
    ...stable,
    strategyId: `build-strategy:${digest({ runId, semanticDigest }).slice(-24)}`,
    revision: input.revision,
    semanticDigest,
  });
}

export interface ExecutionBindingRepository {
  repositoryId: string;
  branchRef: string;
  headRevision: string;
  isolation: ExecutionIsolation;
  workspaceOwnerId: string;
  worktreeId: string | null;
}

/**
 * Portable execution observation. Local absolute paths are held behind the
 * opaque localOverlayRef and are never copied into this value.
 */
export interface ExecutionBinding {
  schemaVersion: 3;
  bindingId: string;
  revision: number;
  strategyDigest: Digest;
  coordinatorHostId: string;
  repositories: readonly ExecutionBindingRepository[];
  semanticDigest: Digest;
  stateDigest: Digest;
  localOverlayRef: string;
}

export function executionBindingRequiresMigration(binding: unknown): boolean {
  if (!binding || typeof binding !== 'object') return true;
  return (binding as { schemaVersion?: unknown }).schemaVersion !== 3;
}

export interface BuildWorkspaceCheckpointRepository {
  repositoryId: string;
  branchRef: string;
  headRevision: string;
}

/**
 * Runtime-owned progress through the bound workspace. Unlike ExecutionBinding,
 * this value advances after an accepted package and contains no local paths or
 * Host-provided repository assertions.
 */
export interface BuildWorkspaceCheckpoint {
  schemaVersion: 1;
  revision: number;
  repositories: readonly BuildWorkspaceCheckpointRepository[];
  digest: Digest;
}

export type BuildWorkspaceHeadRelation = 'unchanged' | 'fast-forward' | 'non-fast-forward';
export type BuildWorkspaceProgressRejection =
  | 'unauthorized-head-change'
  | 'non-fast-forward'
  | 'identity-drift'
  | 'observation-failed';

export class BuildWorkspaceProgressError extends Error {
  override readonly name = 'BuildWorkspaceProgressError';

  constructor(
    message: string,
    readonly classification: BuildWorkspaceProgressRejection,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function createBuildWorkspaceCheckpoint(
  binding: ExecutionBinding,
): BuildWorkspaceCheckpoint {
  const stable = {
    schemaVersion: 1 as const,
    revision: 1,
    repositories: binding.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      branchRef: repository.branchRef,
      headRevision: repository.headRevision,
    })),
  };
  return deepFreeze({ ...stable, digest: digest(stable) });
}

export function advanceBuildWorkspaceCheckpoint(input: {
  current: BuildWorkspaceCheckpoint;
  observed: readonly BuildWorkspaceCheckpointRepository[];
  writableRepositoryIds: readonly string[];
  relations: Readonly<Record<string, BuildWorkspaceHeadRelation>>;
}): BuildWorkspaceCheckpoint {
  const observed = [...input.observed]
    .map((repository) => ({
      repositoryId: text(repository.repositoryId, 'Repository identity'),
      branchRef: text(repository.branchRef, 'Repository branch'),
      headRevision: text(repository.headRevision, 'Repository head'),
    }))
    .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId));
  if (
    observed.length !== input.current.repositories.length ||
    new Set(observed.map((repository) => repository.repositoryId)).size !== observed.length
  ) {
    throw new BuildWorkspaceProgressError(
      'Build workspace repository topology changed',
      'identity-drift',
    );
  }
  const writable = new Set(unique(input.writableRepositoryIds, 'Writable repository identities'));
  for (const previous of input.current.repositories) {
    const next = observed.find((repository) => repository.repositoryId === previous.repositoryId);
    if (!next || next.branchRef !== previous.branchRef) {
      throw new BuildWorkspaceProgressError(
        'Build workspace repository identity changed',
        'identity-drift',
      );
    }
    const relation = input.relations[previous.repositoryId];
    if (!relation) throw new Error('Build workspace head relation is missing');
    if (next.headRevision === previous.headRevision && relation !== 'unchanged') {
      throw new Error('Build workspace unchanged relation is inconsistent');
    }
    if (next.headRevision !== previous.headRevision && relation === 'unchanged') {
      throw new Error('Build workspace changed head is not classified');
    }
    if (!writable.has(previous.repositoryId) && relation !== 'unchanged') {
      throw new BuildWorkspaceProgressError(
        `Build workspace changed outside the Package write scope: ${previous.repositoryId}`,
        'unauthorized-head-change',
      );
    }
    if (relation === 'non-fast-forward') {
      throw new BuildWorkspaceProgressError(
        `Build workspace history did not advance by fast-forward: ${previous.repositoryId}`,
        'non-fast-forward',
      );
    }
  }
  const stable = {
    schemaVersion: 1 as const,
    revision: input.current.revision + 1,
    repositories: observed,
  };
  return deepFreeze({ ...stable, digest: digest(stable) });
}

export function createExecutionBinding(input: {
  strategy: BuildStrategy;
  revision: number;
  coordinatorHostId: string;
  workspaceBinding: ExecutionWorkspaceBinding;
  workspaceOwnerId: string;
  localOverlayRef: string;
}): ExecutionBinding {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Execution Binding revision must be a positive safe integer');
  }
  if (input.workspaceBinding.isolation !== input.strategy.isolationIntent) {
    throw new Error('Execution Binding isolation does not match the approved Build Strategy');
  }
  const localOverlayRef = text(input.localOverlayRef, 'Local overlay reference');
  if (isAbsolute(localOverlayRef) || /^[a-z]:[\\/]/iu.test(localOverlayRef)) {
    throw new Error('Local overlay reference must be opaque, not an absolute path');
  }
  const workspaceOwnerId = text(input.workspaceOwnerId, 'Workspace owner identity');
  const coordinatorHostId = text(input.coordinatorHostId, 'Coordinator Host identity');
  const repositories = input.workspaceBinding.repositories.map((repository) => ({
    repositoryId: repository.repositoryId,
    branchRef: repository.branch,
    headRevision: repository.head,
    isolation: input.workspaceBinding.isolation,
    workspaceOwnerId,
    worktreeId: repository.worktreeId,
  }));
  const portableSemantics = {
    schemaVersion: 3 as const,
    strategyDigest: input.strategy.semanticDigest,
    coordinatorHostId,
    repositories: repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      branchRef: repository.branchRef,
      isolation: repository.isolation,
      workspaceOwnerId: repository.workspaceOwnerId,
      worktreeId: repository.worktreeId,
    })),
  };
  const semanticDigest = digest(portableSemantics);
  const stateDigest = digest({
    ...portableSemantics,
    repositories,
  });
  return deepFreeze({
    schemaVersion: 3 as const,
    bindingId: `execution-binding:${digest({ semanticDigest, stateDigest, revision: input.revision }).slice(-24)}`,
    revision: input.revision,
    strategyDigest: input.strategy.semanticDigest,
    coordinatorHostId,
    repositories,
    semanticDigest,
    stateDigest,
    localOverlayRef,
  });
}

export interface WorkPackageWriteScope {
  repositoryId: string;
  paths: readonly string[];
}

export type WorkPackageSideEffectClass =
  | 'process'
  | 'repository-write'
  | 'git-publish'
  | 'platform-mutation';

export type WorkPackageEvidenceRequirement =
  | 'acceptance'
  | 'implementation'
  | 'red'
  | 'green'
  | 'test'
  | 'regression';

export interface WorkPackageCompletionContract {
  schemaVersion: 1;
  behaviorSlice: string;
  requiredEvidence: readonly WorkPackageEvidenceRequirement[];
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
  sideEffectClass: WorkPackageSideEffectClass;
  completionContract: WorkPackageCompletionContract;
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
  sideEffectClass: WorkPackageSideEffectClass;
  completionContract: WorkPackageCompletionContract;
  digest: Digest;
}

const PACKAGE_SIDE_EFFECT_CLASSES = new Set<WorkPackageSideEffectClass>([
  'process',
  'repository-write',
  'git-publish',
  'platform-mutation',
]);
const PACKAGE_EVIDENCE_REQUIREMENTS = new Set<WorkPackageEvidenceRequirement>([
  'acceptance',
  'implementation',
  'red',
  'green',
  'test',
  'regression',
]);

export interface BuildPlan {
  schemaVersion: 1;
  runId: string;
  planId: string;
  revision: number;
  strategyId: string;
  strategyDigest: Digest;
  bindingId: string;
  bindingStateDigest: Digest;
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
  strategy: BuildStrategy;
  binding: ExecutionBinding;
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
  if (input.binding.strategyDigest !== input.strategy.semanticDigest) {
    throw new Error('Execution Binding does not belong to the approved Build Strategy');
  }
  const repositoryIds = new Set(
    input.binding.repositories.map((repository) => repository.repositoryId),
  );
  const acceptanceIds = new Set<string>(
    input.tasks.tasks.flatMap((task) => task.acceptanceCriteria.map((item) => item.acceptanceId)),
  );
  const taskRevisions = new Map(
    input.tasks.tasks.map((task) => [task.taskId, task.taskRevision] as const),
  );
  const prepared = input.candidate.packages.map((candidate) => {
    if (!PACKAGE_SIDE_EFFECT_CLASSES.has(candidate.sideEffectClass)) {
      throw new Error('Build Plan package side-effect class is invalid');
    }
    if (candidate.completionContract?.schemaVersion !== 1) {
      throw new Error('Build Plan package completion contract is missing or unsupported');
    }
    const requiredEvidence = unique(
      candidate.completionContract.requiredEvidence,
      'Package required Evidence',
    ) as WorkPackageEvidenceRequirement[];
    if (requiredEvidence.some((entry) => !PACKAGE_EVIDENCE_REQUIREMENTS.has(entry))) {
      throw new Error('Build Plan package completion contract has unknown Evidence');
    }
    const stable = {
      schemaVersion: 1 as const,
      packageKey: text(candidate.packageKey, 'Package key'),
      taskIds: unique(candidate.taskIds, 'Package Task references'),
      repositoryIds: unique(candidate.repositoryIds, 'Package repository references'),
      writeScopes: candidate.writeScopes
        .map((scope) => ({
          repositoryId: text(scope.repositoryId, 'Write scope repository identity'),
          paths: unique(scope.paths.map(scopePath), 'Write scope paths'),
        }))
        .sort((left, right) => left.repositoryId.localeCompare(right.repositoryId)),
      acceptanceRefs: unique(candidate.acceptanceRefs, 'Package acceptance references'),
      expectedOutcomes: unique(candidate.expectedOutcomes, 'Package expected outcomes'),
      validatorProfile: text(candidate.validatorProfile, 'Package validator profile'),
      sideEffectClass: candidate.sideEffectClass,
      completionContract: {
        schemaVersion: 1 as const,
        behaviorSlice: text(candidate.completionContract.behaviorSlice, 'Package behavior slice'),
        requiredEvidence,
      },
    };
    if (stable.taskIds.some((taskId) => !taskIds.has(taskId))) {
      throw new Error('Build Plan package references an unknown Task');
    }
    if (stable.taskIds.length === 0) {
      throw new Error('Build Plan contains an orphan package without Task references');
    }
    if (stable.acceptanceRefs.some((acceptanceId) => !acceptanceIds.has(acceptanceId))) {
      throw new Error('Build Plan package references unknown acceptance criteria');
    }
    if (stable.repositoryIds.length === 0 || stable.writeScopes.length === 0) {
      throw new Error('Build Plan package requires repository and write scope boundaries');
    }
    if (
      new Set(stable.writeScopes.map((scope) => scope.repositoryId)).size !==
      stable.writeScopes.length
    ) {
      throw new Error('Build Plan package contains duplicate repository write scopes');
    }
    if (stable.repositoryIds.some((repositoryId) => !repositoryIds.has(repositoryId))) {
      throw new Error('Build Plan package references an unbound repository');
    }
    if (stable.writeScopes.some((scope) => !stable.repositoryIds.includes(scope.repositoryId))) {
      throw new Error('Build Plan write scope exceeds package repository bindings');
    }
    return {
      ...stable,
      dependsOnKeys: unique(candidate.dependsOn, 'Package dependencies'),
    };
  });
  const byKey = new Map(prepared.map((entry) => [entry.packageKey, entry] as const));
  const resolving = new Set<string>();
  const resolved = new Map<string, WorkPackage>();
  const materialize = (packageKey: string): WorkPackage => {
    const existing = resolved.get(packageKey);
    if (existing) return existing;
    if (resolving.has(packageKey)) {
      throw new Error('Build Plan package dependency cycle detected');
    }
    const candidate = byKey.get(packageKey);
    if (!candidate) {
      throw new Error(`Build Plan references unknown package dependency: ${packageKey}`);
    }
    resolving.add(packageKey);
    const dependencies = candidate.dependsOnKeys.map(materialize);
    resolving.delete(packageKey);
    const { dependsOnKeys: _dependsOnKeys, ...stable } = candidate;
    void _dependsOnKeys;
    const packageDigest = digest({
      ...stable,
      taskRevisions: stable.taskIds.map((taskId) => ({
        taskId,
        taskRevision: taskRevisions.get(taskId)!,
      })),
      dependencies: dependencies.map((dependency) => ({
        packageId: dependency.packageId,
        digest: dependency.digest,
      })),
    });
    const workPackage: WorkPackage = {
      ...stable,
      packageId: `work-package:${packageDigest.slice(-24)}`,
      dependsOn: dependencies.map((dependency) => dependency.packageId),
      digest: packageDigest,
    };
    resolved.set(packageKey, workPackage);
    return workPackage;
  };
  const packages = prepared.map((entry) => materialize(entry.packageKey));
  assertAcyclic(packages);
  const covered = new Set(packages.flatMap((entry) => entry.taskIds));
  if ([...taskIds].some((taskId) => !covered.has(taskId))) {
    throw new Error('Build Plan must cover every Task');
  }
  for (const task of input.tasks.tasks) {
    const coveredAcceptance = new Set(
      packages
        .filter((workPackage) => workPackage.taskIds.includes(task.taskId))
        .flatMap((workPackage) => workPackage.acceptanceRefs),
    );
    if (
      task.acceptanceCriteria.some((criterion) => !coveredAcceptance.has(criterion.acceptanceId))
    ) {
      throw new Error(
        `Build Plan does not cover every acceptance criterion for Task ${task.taskId}`,
      );
    }
  }
  const stable = {
    schemaVersion: 1 as const,
    runId: text(input.runId, 'Run identity'),
    revision: input.revision,
    strategyId: input.strategy.strategyId,
    strategyDigest: input.strategy.semanticDigest,
    bindingId: input.binding.bindingId,
    bindingStateDigest: input.binding.stateDigest,
    planningDigest: input.planningDigest,
    taskSetDigest: input.tasks.digest,
    packages,
  };
  const planDigest = digest(stable);
  return deepFreeze({
    ...stable,
    planId: `build-plan:${planDigest.slice(-24)}`,
    digest: planDigest,
  });
}

export interface BuildPlanValidation {
  accepted: boolean;
  diagnostics: readonly string[];
  findings: readonly BuildPlanFinding[];
  protectedBranchFindings: readonly {
    repositoryId: string;
    branch: string;
  }[];
  protectedBranchPolicyDigest: Digest;
  inputDigest: Digest;
}

export type BuildPlanFindingCode =
  | 'package-outcome-missing'
  | 'package-validator-unsupported'
  | 'package-acceptance-incomplete'
  | 'package-evidence-incomplete'
  | 'tdd-slice-split';

export interface BuildPlanFinding {
  code: BuildPlanFindingCode;
  authority: 'plan';
  packageIds: readonly string[];
  behaviorSlice: string | null;
  message: string;
}

export function validateBuildPlan(input: {
  plan: BuildPlan;
  strategy: BuildStrategy;
  binding: ExecutionBinding;
  tasks: SpecificationTaskSet;
  protectedBranches: readonly string[];
}): BuildPlanValidation {
  const diagnostics: string[] = [];
  const findings: BuildPlanFinding[] = [];
  const protectedBranches = normalizeProtectedBranchPatterns(input.protectedBranches);
  const protectedBranchPolicyDigest = digest(protectedBranches);
  if (input.plan.strategyId !== input.strategy.strategyId) {
    diagnostics.push('Strategy identity drifted');
  }
  if (input.plan.strategyDigest !== input.strategy.semanticDigest) {
    diagnostics.push('Strategy digest drifted');
  }
  if (input.plan.bindingId !== input.binding.bindingId) {
    diagnostics.push('Execution Binding identity drifted');
  }
  if (input.plan.bindingStateDigest !== input.binding.stateDigest) {
    diagnostics.push('Execution Binding state drifted');
  }
  if (input.plan.taskSetDigest !== input.tasks.digest) diagnostics.push('Task set drifted');
  const taskIds = new Set(input.tasks.tasks.map((task) => task.taskId));
  const covered = new Set(input.plan.packages.flatMap((entry) => entry.taskIds));
  if ([...taskIds].some((taskId) => !covered.has(taskId)))
    diagnostics.push('Task coverage incomplete');
  const requiredEvidence = new Set<WorkPackageEvidenceRequirement>(
    input.strategy.tddMode === 'tdd'
      ? ['acceptance', 'implementation', 'red', 'green', 'regression']
      : ['acceptance', 'implementation', 'test', 'regression'],
  );
  const taskAcceptance = new Map(
    input.tasks.tasks.map(
      (task) =>
        [task.taskId, task.acceptanceCriteria.map((criterion) => criterion.acceptanceId)] as const,
    ),
  );
  for (const workPackage of input.plan.packages) {
    const addFinding = (code: BuildPlanFindingCode, message: string) => {
      findings.push({
        code,
        authority: 'plan',
        packageIds: [workPackage.packageId],
        behaviorSlice: workPackage.completionContract.behaviorSlice,
        message,
      });
    };
    if (workPackage.expectedOutcomes.length === 0) {
      addFinding('package-outcome-missing', 'Package has no expected Outcome');
    }
    if (workPackage.validatorProfile !== 'build.package-valid') {
      addFinding(
        'package-validator-unsupported',
        `Package Validator is not supported: ${workPackage.validatorProfile}`,
      );
    }
    const packageAcceptance = new Set(workPackage.acceptanceRefs);
    const missingAcceptance = workPackage.taskIds
      .flatMap((taskId) => taskAcceptance.get(taskId) ?? [])
      .filter((acceptanceId) => !packageAcceptance.has(acceptanceId));
    if (missingAcceptance.length > 0) {
      addFinding(
        'package-acceptance-incomplete',
        'Package cannot independently satisfy every referenced Task acceptance criterion',
      );
    }
    const actualEvidence = new Set(workPackage.completionContract.requiredEvidence);
    const missingEvidence = [...requiredEvidence].filter((kind) => !actualEvidence.has(kind));
    if (missingEvidence.length > 0) {
      addFinding(
        'package-evidence-incomplete',
        `Package completion contract is missing Evidence: ${missingEvidence.join(', ')}`,
      );
    }
  }
  if (input.strategy.tddMode === 'tdd') {
    const bySlice = new Map<string, WorkPackage[]>();
    for (const workPackage of input.plan.packages) {
      const group = bySlice.get(workPackage.completionContract.behaviorSlice) ?? [];
      group.push(workPackage);
      bySlice.set(workPackage.completionContract.behaviorSlice, group);
    }
    for (const [behaviorSlice, packages] of bySlice) {
      if (
        packages.length > 1 &&
        packages.some((workPackage) =>
          [...requiredEvidence].some(
            (kind) => !workPackage.completionContract.requiredEvidence.includes(kind),
          ),
        )
      ) {
        findings.push({
          code: 'tdd-slice-split',
          authority: 'plan',
          packageIds: packages.map((workPackage) => workPackage.packageId).sort(),
          behaviorSlice,
          message: 'TDD behavior slice is split across independently completable Packages',
        });
      }
    }
  }
  try {
    assertAcyclic(input.plan.packages);
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const packageKeys = new Map(
      input.plan.packages.map((workPackage) => [workPackage.packageId, workPackage.packageKey]),
    );
    const reconstructed = createBuildPlan({
      runId: input.plan.runId,
      revision: input.plan.revision,
      strategy: input.strategy,
      binding: input.binding,
      planningDigest: input.plan.planningDigest,
      tasks: input.tasks,
      candidate: {
        packages: input.plan.packages.map((workPackage) => ({
          packageKey: workPackage.packageKey,
          taskIds: workPackage.taskIds,
          repositoryIds: workPackage.repositoryIds,
          writeScopes: workPackage.writeScopes,
          acceptanceRefs: workPackage.acceptanceRefs,
          expectedOutcomes: workPackage.expectedOutcomes,
          validatorProfile: workPackage.validatorProfile,
          sideEffectClass: workPackage.sideEffectClass,
          completionContract: workPackage.completionContract,
          dependsOn: workPackage.dependsOn.map((packageId) => {
            const packageKey = packageKeys.get(packageId);
            if (!packageKey) throw new Error('Build Plan references an unknown package dependency');
            return packageKey;
          }),
        })),
      },
    });
    if (canonicalJson(reconstructed) !== canonicalJson(input.plan)) {
      diagnostics.push('Build Plan canonical package, scope, acceptance, or digest facts drifted');
    }
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  const bindings = new Map(
    input.binding.repositories.map((repository) => [repository.repositoryId, repository] as const),
  );
  const writableRepositoryIds = [
    ...new Set(
      input.plan.packages.flatMap((workPackage) =>
        workPackage.writeScopes.map((scope) => scope.repositoryId),
      ),
    ),
  ].sort();
  const protectedBranchFindings: Array<{ repositoryId: string; branch: string }> = [];
  for (const repositoryId of writableRepositoryIds) {
    const repository = bindings.get(repositoryId);
    if (!repository) {
      diagnostics.push(`Writable repository has no Execution Binding: ${repositoryId}`);
      continue;
    }
    if (isProtectedBranch(repository.branchRef, protectedBranches)) {
      protectedBranchFindings.push({ repositoryId, branch: repository.branchRef });
      diagnostics.push(
        `Writable repository ${repositoryId} is bound to protected branch ${repository.branchRef}; prepare and publish a source branch, then reconfigure the Execution Binding`,
      );
    }
  }
  return deepFreeze({
    accepted: diagnostics.length === 0 && findings.length === 0,
    diagnostics,
    findings,
    protectedBranchFindings,
    protectedBranchPolicyDigest,
    inputDigest: digest({
      plan: input.plan.digest,
      strategy: input.strategy.semanticDigest,
      binding: input.binding.stateDigest,
      tasks: input.tasks.digest,
      protectedBranchPolicy: protectedBranchPolicyDigest,
    }),
  });
}

export interface BuildPlanAuthorizationEnvelope {
  schemaVersion: 1;
  taskIds: readonly string[];
  repositoryIds: readonly string[];
  writeScopes: readonly string[];
  riskLevel: BuildPlanRisk['level'];
  sideEffectClasses: readonly WorkPackageSideEffectClass[];
  digest: Digest;
}

export type BuildPlanAuthorizationExpansion = 'repository' | 'write-scope' | 'risk' | 'side-effect';

export function createBuildPlanAuthorizationEnvelope(
  plan: BuildPlan,
): BuildPlanAuthorizationEnvelope {
  const stable = {
    schemaVersion: 1 as const,
    taskIds: [...new Set(plan.packages.flatMap((workPackage) => workPackage.taskIds))].sort(),
    repositoryIds: [
      ...new Set(plan.packages.flatMap((workPackage) => workPackage.repositoryIds)),
    ].sort(),
    writeScopes: [
      ...new Set(
        plan.packages.flatMap((workPackage) =>
          workPackage.writeScopes.flatMap((scope) =>
            scope.paths.map((path) => `${scope.repositoryId}:${path}`),
          ),
        ),
      ),
    ].sort(),
    riskLevel: assessBuildPlanRisk(plan).level,
    sideEffectClasses: [
      ...new Set(plan.packages.map((workPackage) => workPackage.sideEffectClass)),
    ].sort(),
  };
  return deepFreeze({ ...stable, digest: digest(stable) });
}

const SIDE_EFFECT_RANK: Record<WorkPackageSideEffectClass, number> = {
  process: 0,
  'repository-write': 1,
  'git-publish': 2,
  'platform-mutation': 3,
};

export function compareBuildPlanAuthorizationEnvelope(
  approved: BuildPlanAuthorizationEnvelope,
  candidate: BuildPlan,
): { requiresDecision: boolean; expansions: readonly BuildPlanAuthorizationExpansion[] } {
  const next = createBuildPlanAuthorizationEnvelope(candidate);
  const approvedRepositories = new Set(approved.repositoryIds);
  const approvedScopes = new Set(approved.writeScopes);
  const maxApprovedSideEffect = Math.max(
    ...approved.sideEffectClasses.map((entry) => SIDE_EFFECT_RANK[entry]),
  );
  const expansions = new Set<BuildPlanAuthorizationExpansion>();
  if (next.repositoryIds.some((repositoryId) => !approvedRepositories.has(repositoryId))) {
    expansions.add('repository');
  }
  if (next.writeScopes.some((scope) => !approvedScopes.has(scope))) {
    expansions.add('write-scope');
  }
  if (approved.riskLevel === 'low' && next.riskLevel === 'high') expansions.add('risk');
  if (next.sideEffectClasses.some((entry) => SIDE_EFFECT_RANK[entry] > maxApprovedSideEffect)) {
    expansions.add('side-effect');
  }
  const ordered = [...expansions].sort();
  return deepFreeze({ requiresDecision: ordered.length > 0, expansions: ordered });
}

export interface BuildProtocolState {
  schemaVersion: 3;
  runId: string;
  planningDigest: Digest;
  strategy: BuildStrategy;
  binding: ExecutionBinding | null;
  bindingHistory: readonly ExecutionBinding[];
  workspaceCheckpoint: BuildWorkspaceCheckpoint | null;
  currentAction: BuildActionKind | null;
  status: 'active' | 'ready-for-verify' | 'suspended-for-design';
  actionAttempt: number;
  plans: readonly BuildPlan[];
  plan: BuildPlan | null;
  planEvidence: PlanEvidence | null;
  packageCompletions: readonly PackageCompletionEvidence[];
  checkEvidence: BuildCheckEvidence | null;
  invalidations: readonly BuildInvalidation[];
  verifyRepair: import('./verify-repair.js').VerifyRepair | null;
  authorizationEnvelope: BuildPlanAuthorizationEnvelope | null;
  suspension: BuildProtocolSuspension | null;
  revision: number;
}

/** Revision is provenance, not a reason to change an otherwise identical Plan. */
export function reuseEquivalentBuildPlan(
  previous: BuildPlan | null,
  candidate: BuildPlan,
): BuildPlan {
  if (!previous) return candidate;
  const semantics = ({
    revision: _revision,
    planId: _planId,
    digest: _digest,
    ...facts
  }: BuildPlan) => facts;
  return canonicalJson(semantics(previous)) === canonicalJson(semantics(candidate))
    ? previous
    : candidate;
}

export function assertBuildProtocolState(value: unknown): asserts value is BuildProtocolState {
  const state = value as BuildProtocolState | null;
  if (!state || state.schemaVersion !== 3)
    throw new Error(
      'Unsupported Build Protocol schema; expected schema 3, no migration is supported',
    );
  if (
    !Object.hasOwn(state, 'verifyRepair') ||
    !Array.isArray(state.packageCompletions) ||
    !Array.isArray(state.invalidations)
  )
    throw new Error('Invalid Build Protocol shape');
  if (state.verifyRepair !== null) {
    assertVerifyRepair(state.verifyRepair);
    const repair = state.verifyRepair;
    if (
      !state.invalidations.some((i) => i.digest === repair.scope.invalidationDigest) ||
      repair.retained.some(
        (r) =>
          !state.plans.some((p) =>
            p.packages.some(
              (pkg) => pkg.packageId === r.packageId && pkg.digest === r.packageDigest,
            ),
          ),
      )
    )
      throw new Error('Verify repair does not bind accepted Build Protocol facts');
  }
}

export interface BuildProtocolSuspension {
  schemaVersion: 1;
  supersededPlanningDigest: Digest;
  observedPlanningDigest: Digest;
  reasonCode: string;
  invalidatedIdentities: readonly RuntimeIdentityKind[];
}

export type BuildProtocolObservation =
  | { kind: 'binding-accepted'; binding: ExecutionBinding }
  | { kind: 'binding-revalidation-required'; reasonCode: string }
  | {
      kind: 'plan-accepted';
      plan: BuildPlan;
      workspaceCheckpoint: BuildWorkspaceCheckpoint;
      retentionInvalidation?: BuildInvalidation;
    }
  | {
      kind: 'plan-evidence-accepted';
      evidence: PlanEvidence;
      approvedAuthorizationEnvelopeDigest?: Digest;
    }
  | { kind: 'plan-rejected' }
  | {
      kind: 'package-completed';
      completion: PackageCompletionEvidence;
      workspaceCheckpoint: BuildWorkspaceCheckpoint;
      retentionInvalidation?: BuildInvalidation;
    }
  | { kind: 'check-accepted'; evidence: BuildCheckEvidence }
  | {
      kind: 'revision-required';
      invalidation: BuildInvalidation;
      verifyRepair?: import('./verify-repair.js').VerifyRepair;
    }
  | { kind: 'retry'; action: BuildActionKind };

export function createBuildProtocolState(input: {
  runId: string;
  planningDigest: Digest;
  strategy: BuildStrategy;
}): BuildProtocolState {
  if (!SHA256.test(input.planningDigest)) throw new Error('Planning digest is invalid');
  return deepFreeze({
    schemaVersion: 3,
    runId: text(input.runId, 'Run identity'),
    planningDigest: input.planningDigest,
    strategy: input.strategy,
    binding: null,
    bindingHistory: [],
    workspaceCheckpoint: null,
    currentAction: 'configure',
    status: 'active',
    actionAttempt: 1,
    plans: [],
    plan: null,
    planEvidence: null,
    packageCompletions: [],
    checkEvidence: null,
    invalidations: [],
    verifyRepair: null,
    authorizationEnvelope: null,
    suspension: null,
    revision: 0,
  });
}

export function suspendBuildProtocolForDesign(
  state: BuildProtocolState,
  input: {
    observedPlanningDigest: Digest;
    reasonCode: string;
    invalidatedIdentities: readonly RuntimeIdentityKind[];
  },
): BuildProtocolState {
  if (state.status === 'suspended-for-design') {
    if (
      state.suspension?.observedPlanningDigest === input.observedPlanningDigest &&
      state.suspension.reasonCode === input.reasonCode
    ) {
      return state;
    }
    throw new Error('Build Protocol is already suspended for a different Design observation');
  }
  if (!SHA256.test(input.observedPlanningDigest)) {
    throw new Error('Observed planning digest is invalid');
  }
  const reasonCode = text(input.reasonCode, 'Build suspension reason');
  const invalidatedIdentities = unique(
    input.invalidatedIdentities,
    'Build suspension invalidated identities',
  ) as RuntimeIdentityKind[];
  return deepFreeze({
    ...state,
    currentAction: null,
    status: 'suspended-for-design',
    actionAttempt: 1,
    suspension: {
      schemaVersion: 1,
      supersededPlanningDigest: state.planningDigest,
      observedPlanningDigest: input.observedPlanningDigest,
      reasonCode,
      invalidatedIdentities,
    },
    revision: state.revision + 1,
  });
}

export function revalidateSuspendedBuildProtocol(
  state: BuildProtocolState,
  input: {
    planningDigest: Digest;
    strategy: BuildStrategy;
    bindingCompatible: boolean;
    planCompatible: boolean;
    retainedPackageIds: readonly string[];
  },
): BuildProtocolState {
  if (state.status !== 'suspended-for-design' || !state.suspension) {
    throw new Error('Build Protocol is not suspended for Design revalidation');
  }
  if (!SHA256.test(input.planningDigest)) throw new Error('Planning digest is invalid');
  const retained = new Set(unique(input.retainedPackageIds, 'Retained package identities'));
  const strategyCompatible = input.strategy.semanticDigest === state.strategy.semanticDigest;
  if (!strategyCompatible || !input.bindingCompatible || !state.binding) {
    return deepFreeze({
      ...state,
      planningDigest: input.planningDigest,
      strategy: input.strategy,
      currentAction: 'configure',
      status: 'active',
      actionAttempt: 1,
      binding: null,
      workspaceCheckpoint: null,
      plan: null,
      planEvidence: null,
      packageCompletions: [],
      checkEvidence: null,
      suspension: null,
      revision: state.revision + 1,
    });
  }
  const planCompatible =
    input.planCompatible &&
    state.plan !== null &&
    state.plan.planningDigest === input.planningDigest;
  const packageCompletions = state.packageCompletions.filter(
    (completion) =>
      retained.has(completion.packageId) &&
      state.plan?.packages.some(
        (workPackage) =>
          workPackage.packageId === completion.packageId &&
          workPackage.digest === completion.packageDigest,
      ),
  );
  return deepFreeze({
    ...state,
    planningDigest: input.planningDigest,
    currentAction: 'plan',
    status: 'active',
    actionAttempt: 1,
    plan: state.plan,
    planEvidence: planCompatible ? state.planEvidence : null,
    packageCompletions,
    checkEvidence: null,
    suspension: null,
    revision: state.revision + 1,
  });
}

export function canRetainSuspendedExecutionBinding(
  state: BuildProtocolState | undefined,
  input: {
    strategy: BuildStrategy;
    repositoryIds: readonly string[];
  },
): boolean {
  if (state?.status !== 'suspended-for-design' || !state.binding) return false;
  return (
    state.strategy.semanticDigest === input.strategy.semanticDigest &&
    state.binding.strategyDigest === input.strategy.semanticDigest &&
    canonicalJson(
      state.binding.repositories.map((repository) => repository.repositoryId).sort(),
    ) === canonicalJson([...input.repositoryIds].sort())
  );
}

export function advanceBuildProtocol(
  state: BuildProtocolState,
  observation: BuildProtocolObservation,
): BuildProtocolState {
  if (state.status === 'suspended-for-design') {
    throw new Error('Build Protocol is suspended for Design and cannot accept runnable Actions');
  }
  if (observation.kind === 'retry') {
    if (observation.action !== state.currentAction) {
      throw new Error('Retry does not match the current Runtime-selected Action');
    }
    return deepFreeze({ ...state, actionAttempt: state.actionAttempt + 1 });
  }
  if (observation.kind === 'binding-accepted') {
    if (state.currentAction !== 'configure') {
      throw new Error('Execution Binding does not match the current Runtime-selected Action');
    }
    if (observation.binding.strategyDigest !== state.strategy.semanticDigest) {
      throw new Error('Execution Binding changed the approved Build Strategy');
    }
    return deepFreeze({
      ...state,
      currentAction: 'plan',
      actionAttempt: 1,
      binding: observation.binding,
      bindingHistory: [...state.bindingHistory, observation.binding],
      workspaceCheckpoint: createBuildWorkspaceCheckpoint(observation.binding),
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'binding-revalidation-required') {
    if (state.currentAction === 'configure' || !state.binding) {
      throw new Error('Execution Binding revalidation requires an accepted Binding');
    }
    text(observation.reasonCode, 'Execution Binding drift reason');
    return deepFreeze({
      ...state,
      currentAction: 'configure',
      status: 'active',
      actionAttempt: 1,
      binding: null,
      workspaceCheckpoint: null,
      plan: null,
      planEvidence: null,
      checkEvidence: null,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'plan-accepted') {
    if (state.currentAction !== 'plan') {
      throw new Error('Plan does not match the current Runtime-selected Action');
    }
    if (
      observation.plan.strategyDigest !== state.strategy.semanticDigest ||
      observation.plan.bindingId !== state.binding?.bindingId
    ) {
      throw new Error('Plan does not bind the current Strategy and Execution Binding');
    }
    const expectedRevision = (state.plans.at(-1)?.revision ?? 0) + 1;
    const samePlan = state.plan?.digest === observation.plan.digest;
    if (observation.plan.revision !== expectedRevision && !samePlan) {
      throw new Error('Build Plan revision is not monotonic');
    }
    if (
      !state.workspaceCheckpoint ||
      observation.workspaceCheckpoint.revision !== state.workspaceCheckpoint.revision + 1
    ) {
      throw new Error('Build Plan does not bind the next workspace checkpoint');
    }
    const packageCompletions = state.packageCompletions.filter(
      (completion) =>
        !observation.retentionInvalidation?.affectedPackageIds.includes(completion.packageId) &&
        observation.plan.packages.some(
          (workPackage) =>
            workPackage.packageId === completion.packageId &&
            workPackage.digest === completion.packageDigest,
        ),
    );
    return deepFreeze({
      ...state,
      currentAction: 'plan-evidence',
      actionAttempt: 1,
      plans: samePlan ? state.plans : [...state.plans, observation.plan],
      plan: observation.plan,
      workspaceCheckpoint: observation.workspaceCheckpoint,
      planEvidence: null,
      packageCompletions,
      invalidations: observation.retentionInvalidation
        ? [...state.invalidations, observation.retentionInvalidation]
        : state.invalidations,
      checkEvidence: null,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'plan-evidence-accepted') {
    assertPlanEvidence(observation.evidence);
    if (state.currentAction !== 'plan-evidence') {
      throw new Error('Plan Evidence does not match the current Runtime-selected Action');
    }
    if (observation.evidence.planDigest !== state.plan?.digest) {
      throw new Error('Plan Evidence is stale');
    }
    const authorizationExpansion = state.authorizationEnvelope
      ? compareBuildPlanAuthorizationEnvelope(state.authorizationEnvelope, state.plan)
      : { requiresDecision: observation.evidence.risk.level === 'high', expansions: [] };
    const requiresApproval = authorizationExpansion.requiresDecision;
    if (
      observation.approvedAuthorizationEnvelopeDigest !== undefined &&
      observation.approvedAuthorizationEnvelopeDigest !==
        observation.evidence.authorizationEnvelope.digest
    ) {
      throw new Error(
        'Plan authorization approval does not bind the current authorization envelope',
      );
    }
    if (requiresApproval && observation.approvedAuthorizationEnvelopeDigest === undefined) {
      throw new Error('Build Plan expands authorization without a Human Decision');
    }
    const allCompleted =
      state.plan?.packages.every((workPackage) =>
        state.packageCompletions.some(
          (completion) =>
            completion.packageId === workPackage.packageId &&
            completion.packageDigest === workPackage.digest,
        ),
      ) ?? false;
    return deepFreeze({
      ...state,
      currentAction: allCompleted ? 'check' : 'execute',
      actionAttempt: 1,
      planEvidence: observation.evidence,
      authorizationEnvelope:
        observation.approvedAuthorizationEnvelopeDigest !== undefined ||
        state.authorizationEnvelope === null
          ? observation.evidence.authorizationEnvelope
          : state.authorizationEnvelope,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'plan-rejected') {
    if (state.currentAction !== 'plan-evidence' || !state.plan) {
      throw new Error('Plan rejection does not match the current Plan Evidence Action');
    }
    return deepFreeze({
      ...state,
      currentAction: 'plan',
      actionAttempt: 1,
      planEvidence: null,
      checkEvidence: null,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'package-completed') {
    if (
      state.currentAction !== 'execute' ||
      !state.plan ||
      !state.planEvidence ||
      !state.workspaceCheckpoint
    ) {
      throw new Error('Package completion does not match the active Execute Action');
    }
    const workPackage = state.plan.packages.find(
      (candidate) => candidate.packageId === observation.completion.packageId,
    );
    if (!workPackage || observation.completion.packageDigest !== workPackage.digest) {
      throw new Error('Package completion does not match the current Build Plan');
    }
    if (
      workPackage.dependsOn.some(
        (dependency) =>
          !state.packageCompletions.some((completion) => completion.packageId === dependency),
      )
    ) {
      throw new Error('Package completion was accepted before its dependencies');
    }
    if (state.packageCompletions.some((entry) => entry.packageId === workPackage.packageId)) {
      return state;
    }
    if (
      observation.workspaceCheckpoint.revision !== state.workspaceCheckpoint.revision + 1 ||
      observation.workspaceCheckpoint.digest !== observation.completion.workspaceCheckpointDigest
    ) {
      throw new Error('Package completion does not bind the next workspace checkpoint');
    }
    const packageCompletions = [
      ...state.packageCompletions.filter(
        (c) => !observation.retentionInvalidation?.affectedPackageIds.includes(c.packageId),
      ),
      observation.completion,
    ];
    const allCompleted = state.plan.packages.every((candidate) =>
      packageCompletions.some((completion) => completion.packageId === candidate.packageId),
    );
    return deepFreeze({
      ...state,
      currentAction: allCompleted ? 'check' : 'execute',
      actionAttempt: 1,
      packageCompletions,
      workspaceCheckpoint: observation.workspaceCheckpoint,
      invalidations: observation.retentionInvalidation
        ? [...state.invalidations, observation.retentionInvalidation]
        : state.invalidations,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'check-accepted') {
    assertBuildCheckEvidence(observation.evidence);
    if (state.currentAction !== 'check' || !observation.evidence.accepted) {
      throw new Error('Build Check Evidence does not match the active Check Action');
    }
    if (
      observation.evidence.strategyDigest !== state.strategy.semanticDigest ||
      observation.evidence.bindingStateDigest !== state.binding?.stateDigest ||
      observation.evidence.planDigest !== state.plan?.digest ||
      observation.evidence.workspaceCheckpointDigest !== state.workspaceCheckpoint?.digest
    ) {
      throw new Error('Build Check Evidence input drifted');
    }
    return deepFreeze({
      ...state,
      currentAction: null,
      status: 'ready-for-verify',
      actionAttempt: 1,
      checkEvidence: observation.evidence,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'revision-required') {
    if (!state.plan || !state.binding) {
      throw new Error('Build Plan revision requires an accepted Plan and Execution Binding');
    }
    if (observation.invalidation.planDigest !== state.plan.digest) {
      throw new Error('Build invalidation does not bind the current Plan');
    }
    const affected = new Set(observation.invalidation.affectedPackageIds);
    const packageCompletions = state.packageCompletions.filter(
      (completion) => !affected.has(completion.packageId),
    );
    return deepFreeze({
      ...state,
      currentAction: 'plan',
      status: 'active',
      actionAttempt: 1,
      planEvidence: null,
      packageCompletions,
      checkEvidence: null,
      invalidations: [...state.invalidations, observation.invalidation],
      verifyRepair: observation.verifyRepair ?? state.verifyRepair,
      revision: state.revision + 1,
    });
  }
  const exhaustive: never = observation;
  throw new Error(`Unsupported Build protocol observation: ${String(exhaustive)}`);
}

export interface PlanEvidence {
  schemaVersion: 2;
  evidenceId: string;
  planDigest: Digest;
  strategyDigest: Digest;
  bindingId: string;
  bindingStateDigest: Digest;
  taskSetDigest: Digest;
  compositionCheckpointDigest: Digest;
  reportOwnerId: string;
  repositoryIds: readonly string[];
  taskIds: readonly string[];
  acceptanceRefs: readonly string[];
  validatorProfiles: readonly string[];
  writeScopeDigest: Digest;
  dependencyDigest: Digest;
  reviewMode: BuildReviewMode;
  validationDigest: Digest;
  risk: BuildPlanRisk;
  riskDecisionDigest: Digest;
  authorizationEnvelope: BuildPlanAuthorizationEnvelope;
  accepted: true;
  dependencies: EvidenceDependencyRecord;
}

export function assertPlanEvidence(evidence: PlanEvidence): void {
  if (evidence.schemaVersion !== 2) throw new Error('Unsupported PlanEvidence schema');
  assertEvidenceDependencyRecord(evidence.dependencies, 'plan-evidence', evidence.evidenceId);
  const dependencies: EvidenceDependency[] = [
    { partition: 'planning-semantic', identity: evidence.planDigest },
    {
      partition: 'execution-control',
      identity: digest({
        strategy: evidence.strategyDigest,
        binding: evidence.bindingStateDigest,
        composition: evidence.compositionCheckpointDigest,
        tasks: evidence.taskSetDigest,
      }),
    },
  ];
  const { evidenceId, dependencies: record, ...facts } = evidence;
  const expectedId = `plan-evidence:${digest({ ...facts, dependencySetDigest: evidenceDependencySetDigest(dependencies) }).slice(-24)}`;
  const expected = createEvidenceDependencyRecord({
    subjectKind: 'plan-evidence',
    subjectId: expectedId,
    dependencies,
  });
  if (evidenceId !== expectedId || canonicalJson(record) !== canonicalJson(expected))
    throw new Error('PlanEvidence facts or dependencies were modified');
}

export interface BuildPlanRisk {
  level: 'low' | 'high';
  reasons: readonly ('cross-repository-package' | 'cross-repository-order')[];
  digest: Digest;
}

export function assessBuildPlanRisk(plan: BuildPlan): BuildPlanRisk {
  const reasons = new Set<BuildPlanRisk['reasons'][number]>();
  const byId = new Map(plan.packages.map((workPackage) => [workPackage.packageId, workPackage]));
  for (const workPackage of plan.packages) {
    if (workPackage.repositoryIds.length > 1) reasons.add('cross-repository-package');
    for (const dependencyId of workPackage.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (
        dependency &&
        canonicalJson(dependency.repositoryIds) !== canonicalJson(workPackage.repositoryIds)
      ) {
        reasons.add('cross-repository-order');
      }
    }
  }
  const stable = {
    level: reasons.size > 0 ? ('high' as const) : ('low' as const),
    reasons: [...reasons].sort(),
  };
  return deepFreeze({ ...stable, digest: digest(stable) });
}

export interface PackageCompletionEvidence {
  schemaVersion: 1;
  completionId: string;
  packageId: string;
  packageDigest: Digest;
  executionId: string;
  acceptanceEvidenceIds: readonly string[];
  testEvidenceIds: readonly string[];
  tddEvidence: {
    redEvidenceId: string;
    greenEvidenceId: string;
    regressionEvidenceId: string;
  } | null;
  workspaceCheckpointDigest: Digest;
  implementationDigest: Digest;
  digest: Digest;
}

export function createPackageCompletionEvidence(input: {
  workPackage: WorkPackage;
  executionId: string;
  acceptanceEvidenceIds: readonly string[];
  testEvidenceIds: readonly string[];
  tddMode: BuildTddMode;
  tddEvidence?: PackageCompletionEvidence['tddEvidence'];
  workspaceCheckpointDigest: Digest;
  implementationDigest: Digest;
}): PackageCompletionEvidence {
  if (!SHA256.test(input.workspaceCheckpointDigest) || !SHA256.test(input.implementationDigest)) {
    throw new Error('Package completion digests are invalid');
  }
  const acceptanceEvidenceIds = unique(
    input.acceptanceEvidenceIds,
    'Package acceptance Evidence identities',
  );
  const testEvidenceIds = unique(input.testEvidenceIds, 'Package test Evidence identities');
  if (acceptanceEvidenceIds.length === 0 || testEvidenceIds.length === 0) {
    throw new Error('Package completion requires acceptance and test Evidence');
  }
  const tddEvidence = input.tddEvidence
    ? {
        redEvidenceId: text(input.tddEvidence.redEvidenceId, 'TDD RED Evidence identity'),
        greenEvidenceId: text(input.tddEvidence.greenEvidenceId, 'TDD GREEN Evidence identity'),
        regressionEvidenceId: text(
          input.tddEvidence.regressionEvidenceId,
          'TDD regression Evidence identity',
        ),
      }
    : null;
  if (input.tddMode === 'tdd' && !tddEvidence) {
    throw new Error('TDD Build completion requires RED, GREEN, and regression Evidence');
  }
  const stable = {
    schemaVersion: 1 as const,
    packageId: input.workPackage.packageId,
    packageDigest: input.workPackage.digest,
    executionId: text(input.executionId, 'Implementation execution identity'),
    acceptanceEvidenceIds,
    testEvidenceIds,
    tddEvidence,
    workspaceCheckpointDigest: input.workspaceCheckpointDigest,
    implementationDigest: input.implementationDigest,
  };
  const completionDigest = digest(stable);
  return deepFreeze({
    ...stable,
    completionId: `package-completion:${completionDigest.slice(-24)}`,
    digest: completionDigest,
  });
}

export function createPlanEvidence(input: {
  plan: BuildPlan;
  strategy: BuildStrategy;
  binding: ExecutionBinding;
  validation: BuildPlanValidation;
  protectedBranches: readonly string[];
  compositionCheckpointDigest: Digest;
  reportOwnerId: string;
}): PlanEvidence {
  if (!input.validation.accepted) throw new Error('Rejected Build Plan cannot produce Evidence');
  if (!SHA256.test(input.compositionCheckpointDigest)) {
    throw new Error('Plan Evidence composition checkpoint digest is invalid');
  }
  const protectedBranchPolicyDigest = digest(
    normalizeProtectedBranchPatterns(input.protectedBranches),
  );
  if (
    input.plan.strategyDigest !== input.strategy.semanticDigest ||
    input.plan.bindingId !== input.binding.bindingId ||
    input.plan.bindingStateDigest !== input.binding.stateDigest ||
    input.validation.inputDigest !==
      digest({
        plan: input.plan.digest,
        strategy: input.strategy.semanticDigest,
        binding: input.binding.stateDigest,
        tasks: input.plan.taskSetDigest,
        protectedBranchPolicy: protectedBranchPolicyDigest,
      })
  ) {
    throw new Error('Build Plan Evidence input drifted');
  }
  const stable = {
    schemaVersion: 2 as const,
    planDigest: input.plan.digest,
    strategyDigest: input.strategy.semanticDigest,
    bindingId: input.binding.bindingId,
    bindingStateDigest: input.binding.stateDigest,
    protectedBranchPolicyDigest,
    taskSetDigest: input.plan.taskSetDigest,
    compositionCheckpointDigest: input.compositionCheckpointDigest,
    reportOwnerId: text(input.reportOwnerId, 'Plan terminal report owner'),
    repositoryIds: unique(
      input.binding.repositories.map((repository) => repository.repositoryId),
      'Plan Evidence repositories',
    ),
    taskIds: unique(
      [...new Set(input.plan.packages.flatMap((workPackage) => workPackage.taskIds))],
      'Plan Evidence Task identities',
    ),
    acceptanceRefs: unique(
      [...new Set(input.plan.packages.flatMap((workPackage) => workPackage.acceptanceRefs))],
      'Plan Evidence acceptance references',
    ),
    validatorProfiles: unique(
      [...new Set(input.plan.packages.map((workPackage) => workPackage.validatorProfile))],
      'Plan Evidence validator profiles',
    ),
    writeScopeDigest: digest(
      input.plan.packages.map((workPackage) => ({
        packageId: workPackage.packageId,
        writeScopes: workPackage.writeScopes,
      })),
    ),
    dependencyDigest: digest(
      input.plan.packages.map((workPackage) => ({
        packageId: workPackage.packageId,
        dependsOn: workPackage.dependsOn,
      })),
    ),
    reviewMode: input.strategy.reviewMode,
    validationDigest: input.validation.inputDigest,
    risk: assessBuildPlanRisk(input.plan),
    authorizationEnvelope: createBuildPlanAuthorizationEnvelope(input.plan),
    riskDecisionDigest: digest({
      strategyDigest: input.strategy.semanticDigest,
      taskSetDigest: input.plan.taskSetDigest,
      planningDigest: input.plan.planningDigest,
      reportOwnerId: input.reportOwnerId,
      reviewMode: input.strategy.reviewMode,
      packages: input.plan.packages.map((workPackage) => ({
        packageKey: workPackage.packageKey,
        taskIds: workPackage.taskIds,
        repositoryIds: workPackage.repositoryIds,
        writeScopes: workPackage.writeScopes,
        acceptanceRefs: workPackage.acceptanceRefs,
        expectedOutcomes: workPackage.expectedOutcomes,
        validatorProfile: workPackage.validatorProfile,
        dependsOn: workPackage.dependsOn,
      })),
      risk: assessBuildPlanRisk(input.plan).digest,
    }),
    accepted: true as const,
  };
  const dependencies: EvidenceDependency[] = [
    { partition: 'planning-semantic', identity: input.plan.digest },
    {
      partition: 'execution-control',
      identity: digest({
        strategy: input.strategy.semanticDigest,
        binding: input.binding.stateDigest,
        composition: input.compositionCheckpointDigest,
        tasks: input.plan.taskSetDigest,
      }),
    },
  ];
  const evidenceId = `plan-evidence:${digest({ ...stable, dependencySetDigest: evidenceDependencySetDigest(dependencies) }).slice(-24)}`;
  return deepFreeze({
    ...stable,
    evidenceId,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'plan-evidence',
      subjectId: evidenceId,
      dependencies,
    }),
  });
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

export interface BuildInvalidation {
  schemaVersion: 1;
  invalidationId: string;
  source: 'build-check' | 'verify';
  planDigest: Digest;
  classification: BuildFindingClassification;
  affectedPackageIds: readonly string[];
  retainedCompletionIds: readonly string[];
  reason: string;
  digest: Digest;
}

export function createBuildInvalidation(input: {
  source: BuildInvalidation['source'];
  plan: BuildPlan;
  classification: BuildFindingClassification;
  affectedPackageIds: readonly string[];
  packageCompletions: readonly PackageCompletionEvidence[];
  reason: string;
}): BuildInvalidation {
  const affectedPackageIds = unique(input.affectedPackageIds, 'Affected package identities');
  if (
    affectedPackageIds.length === 0 ||
    affectedPackageIds.some(
      (packageId) =>
        !input.plan.packages.some((workPackage) => workPackage.packageId === packageId),
    )
  ) {
    throw new Error('Build invalidation requires current Plan package identities');
  }
  const affected = new Set(affectedPackageIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const workPackage of input.plan.packages) {
      if (
        !affected.has(workPackage.packageId) &&
        workPackage.dependsOn.some((dependencyId) => affected.has(dependencyId))
      ) {
        affected.add(workPackage.packageId);
        expanded = true;
      }
    }
  }
  const affectedWithDependents = [...affected].sort();
  const stable = {
    schemaVersion: 1 as const,
    source: input.source,
    planDigest: input.plan.digest,
    classification: input.classification,
    affectedPackageIds: affectedWithDependents,
    retainedCompletionIds: input.packageCompletions
      .filter((completion) => !affected.has(completion.packageId))
      .map((completion) => completion.completionId)
      .sort(),
    reason: text(input.reason, 'Build invalidation reason', 2048),
  };
  const invalidationDigest = digest(stable);
  return deepFreeze({
    ...stable,
    invalidationId: `build-invalidation:${invalidationDigest.slice(-24)}`,
    digest: invalidationDigest,
  });
}

export interface BuildCheckEvidence {
  schemaVersion: 2;
  evidenceId: string;
  strategyDigest: Digest;
  bindingStateDigest: Digest;
  planDigest: Digest;
  workspaceCheckpointDigest: Digest;
  implementationDigest: Digest;
  completedPackageIds: readonly string[];
  acceptedTaskIds: readonly string[];
  testEvidenceIds: readonly string[];
  review: { mode: 'standard'; implementationExecutionId: string; reviewerExecutionId: string };
  findings: readonly BuildFinding[];
  accepted: boolean;
  digest: Digest;
  dependencies: EvidenceDependencyRecord;
}

export function assertBuildCheckEvidence(evidence: BuildCheckEvidence): void {
  if (evidence.schemaVersion !== 2) throw new Error('Unsupported BuildCheckEvidence schema');
  assertEvidenceDependencyRecord(evidence.dependencies, 'build-check', evidence.evidenceId);
  const dependencies: EvidenceDependency[] = [
    { partition: 'implementation-content', identity: evidence.implementationDigest },
    { partition: 'git-identity', identity: evidence.workspaceCheckpointDigest },
    {
      partition: 'execution-control',
      identity: digest({
        strategy: evidence.strategyDigest,
        binding: evidence.bindingStateDigest,
        plan: evidence.planDigest,
      }),
    },
  ];
  const { evidenceId, dependencies: record, digest: checkDigest, ...facts } = evidence;
  const expectedDigest = digest({
    ...facts,
    dependencySetDigest: evidenceDependencySetDigest(dependencies, evidence.testEvidenceIds),
  });
  const expectedId = `build-check:${expectedDigest.slice(-24)}`;
  const expected = createEvidenceDependencyRecord({
    subjectKind: 'build-check',
    subjectId: expectedId,
    dependencies,
    dependsOnEvidenceIds: evidence.testEvidenceIds,
  });
  if (
    evidenceId !== expectedId ||
    checkDigest !== expectedDigest ||
    canonicalJson(record) !== canonicalJson(expected)
  )
    throw new Error('BuildCheckEvidence facts or dependencies were modified');
}

export function createBuildCheckEvidence(
  input: Omit<
    BuildCheckEvidence,
    'schemaVersion' | 'evidenceId' | 'accepted' | 'digest' | 'dependencies'
  >,
): BuildCheckEvidence {
  if (
    !SHA256.test(input.strategyDigest) ||
    !SHA256.test(input.bindingStateDigest) ||
    !SHA256.test(input.planDigest) ||
    !SHA256.test(input.workspaceCheckpointDigest) ||
    !SHA256.test(input.implementationDigest)
  ) {
    throw new Error('Build Check digests are invalid');
  }
  if (input.review.mode !== 'standard') throw new Error('Build Check review mode must be standard');
  const review = {
    mode: 'standard' as const,
    implementationExecutionId: text(
      input.review.implementationExecutionId,
      'Implementation execution identity',
    ),
    reviewerExecutionId: text(input.review.reviewerExecutionId, 'Reviewer execution identity'),
  };
  if (review.implementationExecutionId === review.reviewerExecutionId) {
    throw new Error('Standard review requires an independent reviewer execution identity');
  }
  if (input.findings.length > MAX_ITEMS) throw new Error('Build Check has too many findings');
  if (new Set(input.findings.map((finding) => finding.findingId)).size !== input.findings.length) {
    throw new Error('Build Check contains duplicate finding identities');
  }
  const classifications = new Set<BuildFindingClassification>([
    'implementation',
    'planning',
    'evidence-infrastructure',
    'unknown',
  ]);
  if (input.findings.some((finding) => !classifications.has(finding.classification))) {
    throw new Error('Build finding classification is invalid');
  }
  const accepted = input.findings.every((finding) => !finding.blocking);
  const completedPackageIds = unique(input.completedPackageIds, 'Completed package identities');
  const acceptedTaskIds = unique(input.acceptedTaskIds, 'Accepted Task identities');
  const testEvidenceIds = unique(input.testEvidenceIds, 'Test Evidence identities');
  if (
    completedPackageIds.length === 0 ||
    acceptedTaskIds.length === 0 ||
    testEvidenceIds.length === 0
  ) {
    throw new Error('Build Check requires package, Task acceptance, and test Evidence');
  }
  const stable = {
    schemaVersion: 2 as const,
    strategyDigest: input.strategyDigest,
    bindingStateDigest: input.bindingStateDigest,
    planDigest: input.planDigest,
    workspaceCheckpointDigest: input.workspaceCheckpointDigest,
    implementationDigest: input.implementationDigest,
    completedPackageIds,
    acceptedTaskIds,
    testEvidenceIds,
    review,
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
  const dependencies: EvidenceDependency[] = [
    { partition: 'implementation-content', identity: input.implementationDigest },
    { partition: 'git-identity', identity: input.workspaceCheckpointDigest },
    {
      partition: 'execution-control',
      identity: digest({
        strategy: input.strategyDigest,
        binding: input.bindingStateDigest,
        plan: input.planDigest,
      }),
    },
  ];
  const checkDigest = digest({
    ...stable,
    dependencySetDigest: evidenceDependencySetDigest(dependencies, testEvidenceIds),
  });
  const evidenceId = `build-check:${checkDigest.slice(-24)}`;
  return deepFreeze({
    ...stable,
    evidenceId,
    digest: checkDigest,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'build-check',
      subjectId: evidenceId,
      dependencies,
      dependsOnEvidenceIds: testEvidenceIds,
    }),
  });
}
