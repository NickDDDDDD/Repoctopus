import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { SpecificationTaskSet } from '../specification/types.js';
import type { RuntimeIdentityKind } from '../runtime/identity.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import { isProtectedBranch, normalizeProtectedBranchPatterns } from '../delivery/branch-policy.js';

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
  stateDigest: Digest;
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
    if (input.intent.targetBranch && repository.branch !== input.intent.targetBranch) {
      throw new Error('Repository branch does not match the Workspace intent');
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
  schemaVersion: 1;
  bindingId: string;
  revision: number;
  strategyDigest: Digest;
  host: {
    hostId: string;
    capabilityDigest: Digest;
  };
  repositories: readonly ExecutionBindingRepository[];
  semanticDigest: Digest;
  stateDigest: Digest;
  localOverlayRef: string;
}

export function executionBindingRequiredCapabilities(
  executionMode: BuildExecutionMode,
): readonly string[] {
  return Object.freeze(
    [
      executionMode === 'autonomous' ? 'build.autonomous' : 'subagent.dispatch.attested',
      'process.execute',
      'repository.read',
      'repository.write',
      'specification.read',
    ].sort(),
  );
}

export function missingExecutionBindingCapabilities(
  executionMode: BuildExecutionMode,
  hostCapabilities: readonly string[],
): readonly string[] {
  const available = new Set(hostCapabilities);
  return Object.freeze(
    executionBindingRequiredCapabilities(executionMode).filter(
      (capability) => !available.has(capability),
    ),
  );
}

export function createExecutionBinding(input: {
  strategy: BuildStrategy;
  revision: number;
  hostId: string;
  hostCapabilities: readonly string[];
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
  const hostCapabilities = unique(input.hostCapabilities, 'Host capabilities');
  const missingCapabilities = missingExecutionBindingCapabilities(
    input.strategy.executionMode,
    hostCapabilities,
  );
  if (missingCapabilities.length > 0) {
    throw new Error(`Execution Binding requires ${missingCapabilities.join(', ')}`);
  }
  const localOverlayRef = text(input.localOverlayRef, 'Local overlay reference');
  if (isAbsolute(localOverlayRef) || /^[a-z]:[\\/]/iu.test(localOverlayRef)) {
    throw new Error('Local overlay reference must be opaque, not an absolute path');
  }
  const workspaceOwnerId = text(input.workspaceOwnerId, 'Workspace owner identity');
  const capabilityDigest = digest(hostCapabilities);
  const repositories = input.workspaceBinding.repositories.map((repository) => ({
    repositoryId: repository.repositoryId,
    branchRef: repository.branch,
    headRevision: repository.head,
    isolation: input.workspaceBinding.isolation,
    workspaceOwnerId,
    worktreeId: repository.worktreeId,
  }));
  const portableSemantics = {
    schemaVersion: 1 as const,
    strategyDigest: input.strategy.semanticDigest,
    capabilityDigest,
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
    hostId: text(input.hostId, 'Host identity'),
    repositories,
  });
  return deepFreeze({
    schemaVersion: 1 as const,
    bindingId: `execution-binding:${digest({ semanticDigest, stateDigest, revision: input.revision }).slice(-24)}`,
    revision: input.revision,
    strategyDigest: input.strategy.semanticDigest,
    host: {
      hostId: text(input.hostId, 'Host identity'),
      capabilityDigest,
    },
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
  protectedBranchFindings: readonly {
    repositoryId: string;
    branch: string;
  }[];
  protectedBranchPolicyDigest: Digest;
  inputDigest: Digest;
}

export function validateBuildPlan(input: {
  plan: BuildPlan;
  strategy: BuildStrategy;
  binding: ExecutionBinding;
  tasks: SpecificationTaskSet;
  protectedBranches: readonly string[];
}): BuildPlanValidation {
  const diagnostics: string[] = [];
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
    accepted: diagnostics.length === 0,
    diagnostics,
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

export interface BuildProtocolState {
  schemaVersion: 2;
  runId: string;
  planningDigest: Digest;
  strategy: BuildStrategy;
  binding: ExecutionBinding | null;
  bindingHistory: readonly ExecutionBinding[];
  currentAction: BuildActionKind | null;
  status: 'active' | 'ready-for-verify' | 'suspended-for-design';
  actionAttempt: number;
  plans: readonly BuildPlan[];
  plan: BuildPlan | null;
  planEvidence: PlanEvidence | null;
  packageCompletions: readonly PackageCompletionEvidence[];
  checkEvidence: BuildCheckEvidence | null;
  invalidations: readonly BuildInvalidation[];
  approvedRiskDigests: readonly Digest[];
  suspension: BuildProtocolSuspension | null;
  revision: number;
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
  | { kind: 'plan-accepted'; plan: BuildPlan }
  | {
      kind: 'plan-evidence-accepted';
      evidence: PlanEvidence;
      approvedRiskDigest?: Digest;
    }
  | { kind: 'plan-rejected' }
  | { kind: 'package-completed'; completion: PackageCompletionEvidence }
  | { kind: 'check-accepted'; evidence: BuildCheckEvidence }
  | { kind: 'revision-required'; invalidation: BuildInvalidation }
  | { kind: 'retry'; action: BuildActionKind };

export function createBuildProtocolState(input: {
  runId: string;
  planningDigest: Digest;
  strategy: BuildStrategy;
}): BuildProtocolState {
  if (!SHA256.test(input.planningDigest)) throw new Error('Planning digest is invalid');
  return deepFreeze({
    schemaVersion: 2,
    runId: text(input.runId, 'Run identity'),
    planningDigest: input.planningDigest,
    strategy: input.strategy,
    binding: null,
    bindingHistory: [],
    currentAction: 'configure',
    status: 'active',
    actionAttempt: 1,
    plans: [],
    plan: null,
    planEvidence: null,
    packageCompletions: [],
    checkEvidence: null,
    invalidations: [],
    approvedRiskDigests: [],
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
    if (observation.plan.revision !== expectedRevision) {
      throw new Error('Build Plan revision is not monotonic');
    }
    const packageCompletions = state.packageCompletions.filter((completion) =>
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
      plans: [...state.plans, observation.plan],
      plan: observation.plan,
      planEvidence: null,
      packageCompletions,
      checkEvidence: null,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'plan-evidence-accepted') {
    if (
      observation.approvedRiskDigest !== undefined &&
      observation.approvedRiskDigest !== observation.evidence.riskDecisionDigest
    ) {
      throw new Error('Plan risk approval does not bind the current semantic risk decision');
    }
    if (state.currentAction !== 'plan-evidence') {
      throw new Error('Plan Evidence does not match the current Runtime-selected Action');
    }
    if (observation.evidence.planDigest !== state.plan?.digest) {
      throw new Error('Plan Evidence is stale');
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
      approvedRiskDigests: observation.approvedRiskDigest
        ? [...new Set([...state.approvedRiskDigests, observation.approvedRiskDigest])].sort()
        : state.approvedRiskDigests,
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
    if (state.currentAction !== 'execute' || !state.plan || !state.planEvidence) {
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
    const packageCompletions = [...state.packageCompletions, observation.completion];
    const allCompleted = state.plan.packages.every((candidate) =>
      packageCompletions.some((completion) => completion.packageId === candidate.packageId),
    );
    return deepFreeze({
      ...state,
      currentAction: allCompleted ? 'check' : 'execute',
      actionAttempt: 1,
      packageCompletions,
      revision: state.revision + 1,
    });
  }
  if (observation.kind === 'check-accepted') {
    if (state.currentAction !== 'check' || !observation.evidence.accepted) {
      throw new Error('Build Check Evidence does not match the active Check Action');
    }
    if (
      observation.evidence.strategyDigest !== state.strategy.semanticDigest ||
      observation.evidence.bindingStateDigest !== state.binding?.stateDigest ||
      observation.evidence.planDigest !== state.plan?.digest
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
      revision: state.revision + 1,
    });
  }
  const exhaustive: never = observation;
  throw new Error(`Unsupported Build protocol observation: ${String(exhaustive)}`);
}

export interface PlanEvidence {
  schemaVersion: 1;
  evidenceId: string;
  planDigest: Digest;
  strategyDigest: Digest;
  bindingId: string;
  bindingStateDigest: Digest;
  hostCapabilityDigest: Digest;
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
  accepted: true;
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
  repositoryDigest: Digest;
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
  repositoryDigest: Digest;
  implementationDigest: Digest;
}): PackageCompletionEvidence {
  if (!SHA256.test(input.repositoryDigest) || !SHA256.test(input.implementationDigest)) {
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
    repositoryDigest: input.repositoryDigest,
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
    schemaVersion: 1 as const,
    planDigest: input.plan.digest,
    strategyDigest: input.strategy.semanticDigest,
    bindingId: input.binding.bindingId,
    bindingStateDigest: input.binding.stateDigest,
    hostCapabilityDigest: input.binding.host.capabilityDigest,
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
  return deepFreeze({
    ...stable,
    evidenceId: `plan-evidence:${digest(stable).slice(-24)}`,
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
  schemaVersion: 1;
  evidenceId: string;
  strategyDigest: Digest;
  bindingStateDigest: Digest;
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
  if (
    !SHA256.test(input.strategyDigest) ||
    !SHA256.test(input.bindingStateDigest) ||
    !SHA256.test(input.planDigest) ||
    !SHA256.test(input.repositoryDigest) ||
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
    schemaVersion: 1 as const,
    ...input,
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
  const checkDigest = digest(stable);
  return deepFreeze({
    ...stable,
    evidenceId: `build-check:${checkDigest.slice(-24)}`,
    digest: checkDigest,
  });
}
