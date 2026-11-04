import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ActionOutcome, RunState, RunTriggerSnapshot } from '../domains/engine/types.js';
import type { ProjectReconciliation, ProjectSnapshot } from '../domains/project/types.js';
import { reconcileProjectSnapshots } from '../domains/project/snapshot.js';
import { classifyWorkContinuation } from '../domains/change-lifecycle/continuation.js';
import {
  WorkflowRunCoordinator,
  WorkspaceBindingConflictError,
} from '../domains/runtime/workflow-runs.js';
import type {
  ResumeView,
  RunStatusView,
  RuntimeDiagnostic,
  RuntimeResult,
} from '../domains/runtime/types.js';
import {
  classifyProtectedBranchRebind,
  projectReconciliationDigest,
  type AuthorizedProtectedBranchRebind,
} from '../domains/runtime/authorized-rebind.js';
import type { WorkflowPackage } from '../domains/workflow-contract/types.js';
import {
  sameSkillUsageSnapshot,
  type SkillCompatibility,
  type SkillUsageSnapshot,
} from '../domains/skill/types.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';
import type {
  EffectiveSkillComposition,
  EffectiveWorkSkillComposition,
} from '../domains/skill/composition.js';
import type {
  SpecificationCompatibility,
  SpecificationApprovalActor,
  SpecificationApprovalDecisionResponse,
  SpecificationApprovalState,
  ChangeBranchReference,
  SpecificationClosurePlan,
  SpecificationChange,
  SpecificationUsageSnapshot,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { createApplicationObservationEnvelope } from '../domains/trajectory/observation.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import {
  changeRunId,
  createChangeRunHostWorkflow,
} from '../domains/change-lifecycle/host-workflow.js';
import type { DesignGateAssessment } from './specification-planning.js';
import type { PlanningAuthorityObservation } from './specification-planning.js';
import {
  buildActionSkillComposition,
  createBuildActionWork,
  createInitialBuildWork,
} from '../domains/change-lifecycle/build-work.js';
import {
  createBuildStrategy,
  createExecutionBinding,
  executionBindingRequiresMigration,
  createBuildCheckEvidence,
  createBuildInvalidation,
  createBuildPlan,
  createBuildProtocolState,
  createExecutionWorkspaceIntent,
  createPlanEvidence,
  createPackageCompletionEvidence,
  advanceBuildWorkspaceCheckpoint,
  BuildWorkspaceProgressError,
  canRetainSuspendedExecutionBinding,
  revalidateSuspendedBuildProtocol,
  validateBuildPlan,
  type BuildStrategy,
  type ExecutionBinding,
  type BuildExecutionMode,
  type BuildTddMode,
  type ExecutionWorkspaceBinding,
  type ExecutionWorkspaceIntent,
  type ExecutionIsolation,
  type BuildWorkspaceCheckpoint,
} from '../domains/change-lifecycle/build-protocol.js';
import {
  ExecutionWorkspaceBindingError,
  type ExecutionCheckoutRequest,
} from './execution-workspace.js';
import {
  createVerificationInput,
  rebaseVerificationInput,
} from '../domains/change-lifecycle/verification-input.js';
import { resolveAcceptanceCoverage } from '../domains/change-lifecycle/acceptance-coverage.js';
import { createVerifyWork } from '../domains/change-lifecycle/verify-work.js';
import { acceptVerifyGate, rejectVerifyGate } from '../domains/change-lifecycle/verify-gate.js';
import type { SpecificationTask } from '../domains/specification/types.js';
import { normalizePlanningArtifacts } from '../domains/specification/artifacts.js';
import type {
  ChangeLifecycleState,
  ChangeRunProjection,
  OpenRepairReasonCode,
  OpenRepairSource,
  WorkDescriptor,
} from '../domains/change-lifecycle/transition.js';
import {
  ChangeStartBindingError,
  createChangeStartBinding,
} from '../domains/change-lifecycle/start-binding.js';
import {
  createArchiveDeliveryInput,
  createDeliveryPublishWork,
  createSpecificationCloseWork,
} from '../domains/change-lifecycle/archive-input.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import { deliveryPolicyDigest } from '../domains/delivery/snapshot.js';
import { normalizeProtectedBranchPatterns } from '../domains/delivery/branch-policy.js';
import type { ActionIntent, ActionReceipt, WorkExecutorIdentity } from '../domains/action/types.js';
import type { WorkExecutionHostIdentity } from '../domains/work-execution/types.js';
import type { ArchivePublicationResult } from '../domains/delivery/service-v3.js';
import { PublicationResultUnknownError } from '../domains/delivery/publication-result-unknown.js';
import { PublicationNotAppliedError } from '../domains/delivery/publication-not-applied.js';
import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
  type PublicationReceipt,
  type PublicationReceiptItem,
} from '../domains/delivery/publication-receipt.js';
import { lifecycleContributorSnapshot } from '../domains/change-lifecycle/contributors.js';
import { createLifecyclePhaseWork } from '../domains/change-lifecycle/phase-work.js';
import {
  desktopActivationDiagnostic,
  parseDesktopActivationResult,
  type DesktopActivationResult,
} from './desktop-launcher.js';

export interface StartChangeRunInput {
  workspaceId: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
  changeId: string;
  targetBranch: string;
  remote: string;
  projectSnapshot: ProjectSnapshot;
  projectConfigDigest: `sha256:${string}`;
  verificationProfileId: string;
  executionCheckouts: readonly ExecutionCheckoutRequest[];
  executionMode?: BuildExecutionMode;
  tddMode?: BuildTddMode;
  protectedBranches?: readonly string[];
}

function frozenProtectedBranches(state: RunState): readonly string[] {
  const configured = state.trigger?.facts.protectedBranches;
  if (
    configured !== undefined &&
    (!Array.isArray(configured) || configured.some((pattern) => typeof pattern !== 'string'))
  ) {
    throw new Error('Change Run protected branch policy is malformed');
  }
  const target = state.trigger?.facts.targetBranch as { targetBranch?: unknown } | undefined;
  if (typeof target?.targetBranch !== 'string') {
    throw new Error('Change Run target branch identity is missing');
  }
  return normalizeProtectedBranchPatterns(
    (configured as string[] | undefined) ?? [],
    target.targetBranch,
  );
}

export interface DecideChangeRunInput {
  runId: string;
  response: SpecificationApprovalDecisionResponse;
  actor: SpecificationApprovalActor;
  isolation?: ExecutionIsolation;
}

export interface VerifyChangeRunInput {
  runId: string;
  attemptId?: string;
}

export interface VerifyChangeRunResult {
  attemptId: string;
  bundleId: string | null;
  gate: 'satisfied' | 'blocked';
  run: RunStatusView;
}

export interface PrepareArchiveDeliveryInput {
  runId: string;
  attemptId: string;
  intent: DeliveryIntentV3;
  policy: DeliveryPolicy;
}

export interface ExecuteArchiveDeliveryInput {
  runId: string;
  project: ProjectSnapshot;
  policy: DeliveryPolicy;
  executor: WorkExecutorIdentity;
  attempt?: number;
}

export interface ExecuteArchiveDeliveryResult {
  stage:
    | 'specification-closed'
    | 'reverify-required'
    | 'intent-corrected'
    | 'definition-recovered'
    | 'planning-revision-required'
    | 'published';
  publication: ArchivePublicationResult | null;
  receipt: PublicationReceipt | null;
  run: RunStatusView;
}

function deliveryBranchRoute(branch: DeliveryIntentV3['changeBranch']) {
  return {
    repositoryId: branch.repositoryId,
    sourceBranch: branch.sourceBranch,
    targetBranch: branch.targetBranch,
  };
}

export class WorkflowRuns extends Service {
  static inject = [
    'actionDispatcher',
    'actionStore',
    'compositionIdentity',
    'delivery',
    'desktopLauncher',
    'evidenceCoordinator',
    'executionWorkspace',
    'lifecycleDefinitions',
    'lifecycleExtensions',
    'lifecycleValidators',
    'managedWorkExecutor',
    'project',
    'runStore',
    'skills',
    'teamSkillComposition',
    'specification',
    'specificationPlanning',
    'workflowTelemetry',
    'workflowSource',
    'workDispatcher',
    'workExecutionAuthority',
    'workExecutionHosts',
  ];

  private readonly coordinator: WorkflowRunCoordinator;
  private readonly operations: OperationOwnership;
  private readonly workspaceRoot: string;

  constructor(context: Context, config: { workspaceRoot?: string } = {}) {
    super(context, 'workflowRuns');
    this.workspaceRoot = config.workspaceRoot ?? process.cwd();
    this.operations = bindOperationOwnership(context, 'workflowRuns');
    const contributorSnapshot = lifecycleContributorSnapshot([
      ...context.lifecycleDefinitions.snapshot().contributors,
      ...context.workDispatcher.snapshot().contributors,
      ...context.lifecycleValidators.snapshot().contributors,
      ...context.lifecycleExtensions.snapshot().contributors,
    ]);
    this.coordinator = new WorkflowRunCoordinator(
      context.runStore,
      context.workflowTelemetry,
      context.compositionIdentity.current(),
      undefined,
      undefined,
      context.workflowSource,
      context.get('evidenceCoordinator'),
      contributorSnapshot,
    );
  }

  start(
    options: {
      workflow: WorkflowPackage;
      projectSnapshot: ProjectSnapshot;
      runId?: string;
      workflowSource?: string;
      trigger?: RunTriggerSnapshot;
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.coordinator.start(options),
    );
  }

  startOrResume(
    options: {
      workflow: WorkflowPackage;
      projectSnapshot: ProjectSnapshot;
      runId: string;
      workflowSource?: string;
      trigger?: RunTriggerSnapshot;
    },
    signal?: AbortSignal,
  ): ReturnType<WorkflowRunCoordinator['startOrResume']> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.coordinator.startOrResume(options),
    );
  }

  startChange(
    input: StartChangeRunInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const workspaceId = input.workspaceId.trim();
      const changeId = input.changeId.trim();
      if (!workspaceId) throw new Error('Change Run Workspace id is required');
      if (!changeId) throw new Error('Change Run change id is required');
      if (!/^sha256:[a-f0-9]{64}$/u.test(input.projectConfigDigest)) {
        throw new Error('Change Run project configuration digest is invalid');
      }
      if (!input.verificationProfileId.trim()) {
        throw new Error('Change Run verification Evidence Profile is required');
      }
      const executionMode = input.executionMode ?? 'autonomous';
      const tddMode = input.tddMode ?? 'tdd';
      if (!['autonomous', 'subagent-driven-development'].includes(executionMode)) {
        throw new Error('Change Run Build execution mode is invalid');
      }
      if (!['tdd', 'direct'].includes(tddMode)) {
        throw new Error('Change Run Build TDD mode is invalid');
      }
      if (input.projectSnapshot.projectId !== workspaceId) {
        throw new Error('Change Run project snapshot belongs to another Workspace');
      }
      if (input.projectSnapshot.diagnostics.length > 0) {
        throw new Error('Change Run cannot open with unresolved repository diagnostics');
      }

      const repositoryIds = [...new Set(input.repositoryIds)].sort();
      if (repositoryIds.length !== input.repositoryIds.length) {
        throw new Error('Change Run repository ids must be unique');
      }
      const observedRepositoryIds = input.projectSnapshot.repositories
        .map((repository) => repository.id)
        .sort();
      if (canonicalJson(repositoryIds) !== canonicalJson(observedRepositoryIds)) {
        throw new Error('Change Run repository snapshot does not match registered repositories');
      }

      const specificationRoot = await this.ctx.specification.verifyRoot(signal);
      if (specificationRoot.repositoryId !== input.workspaceRepositoryId) {
        throw new Error('Specification Root does not use the configured Workspace Repository');
      }
      const workspaceRepository = input.projectSnapshot.repositories.find(
        (repository) => repository.id === input.workspaceRepositoryId,
      );
      if (!workspaceRepository) {
        throw new Error('Workspace Repository is missing from the Change Run snapshot');
      }
      const targetBranch = await this.ctx.project.targetBranch({
        repositoryId: input.workspaceRepositoryId,
        repositoryPath: workspaceRepository.path,
        remote: input.remote,
        targetBranch: input.targetBranch,
      });
      const protectedBranches = normalizeProtectedBranchPatterns(
        input.protectedBranches ?? [],
        targetBranch.targetBranch,
      );
      const runId = changeRunId({ workspaceId, changeId });
      let changeStartBinding: ReturnType<typeof createChangeStartBinding>;
      try {
        changeStartBinding = createChangeStartBinding({
          projectSnapshot: input.projectSnapshot,
          workspaceRepositoryId: input.workspaceRepositoryId,
          targetBranch,
        });
      } catch (error) {
        if (error instanceof ChangeStartBindingError) {
          await this.recordChangeStartObservation({
            runId,
            workspaceId,
            changeId,
            result: 'rejected',
            bindingError: error.code.slice('runtime.workspace-binding.'.length),
            runCreated: false,
            workCreated: false,
            checkpointChanged: false,
            recovery: 'none',
          });
        }
        throw error;
      }
      const lifecycle = createChangeLifecycleSnapshot({
        identity: {
          workspaceId,
          changeId,
          runId,
        },
      });
      const openSkills = await this.resolveLifecycleWorkSkills('change.intake', signal);
      lifecycle.skillCompositionDigest = openSkills.effectiveComposition.digest;
      lifecycle.currentWork = createLifecyclePhaseWork({
        runId,
        checkEpoch: lifecycle.checkEpoch,
        changeId,
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'change.intake',
        actionSkill: openSkills.actionSkill,
        augmentationSkills: openSkills.augmentationSkills,
        skillComposition: openSkills.skillComposition,
        compositionDigest: this.ctx.compositionIdentity.current().compositionDigest,
        projectSnapshotDigest: input.projectSnapshot.digest,
        projectConfigDigest: input.projectConfigDigest,
        workspaceRepositoryId: input.workspaceRepositoryId,
        repositoryIds,
      });
      const triggerFacts = {
        workspaceId,
        changeId,
        specificationRoot,
        targetBranch,
        protectedBranches,
        changeStartBinding,
        repositoryIds,
        projectConfigDigest: input.projectConfigDigest,
        verificationProfileId: input.verificationProfileId,
        buildStrategyPreference: {
          schemaVersion: 1,
          executionMode,
          tddMode,
          reviewMode: 'standard' as const,
        },
        specificationProvider: this.ctx.specification.identity(),
        executionCheckouts: input.executionCheckouts.map((checkout) => ({
          repositoryId: checkout.repositoryId,
          checkoutPath: checkout.checkoutPath,
        })),
      };
      let started: Awaited<ReturnType<WorkflowRunCoordinator['startOrResume']>>;
      try {
        started = await this.coordinator.startOrResume({
          workflow: createChangeRunHostWorkflow(),
          projectSnapshot: input.projectSnapshot,
          runId,
          trigger: {
            schemaVersion: 1,
            kind: 'change.open',
            identityDigest: `sha256:${createHash('sha256')
              .update(canonicalJson(triggerFacts))
              .digest('hex')}`,
            facts: triggerFacts,
          },
          changeLifecycle: lifecycle,
        });
      } catch (error) {
        if (error instanceof WorkspaceBindingConflictError) {
          await this.recordChangeStartObservation({
            runId,
            workspaceId,
            changeId,
            result: 'conflict',
            bindingError: 'binding-drift',
            runCreated: false,
            workCreated: false,
            checkpointChanged: false,
            recovery: 'rejected',
          });
        }
        throw error;
      }
      if (started.value.disposition === 'resumed') {
        await this.recordChangeStartObservation({
          runId,
          workspaceId,
          changeId,
          result: 'reused',
          bindingError: 'none',
          runCreated: false,
          workCreated: false,
          checkpointChanged: false,
          recovery: 'resumed',
        });
        return { value: started.value.status, diagnostics: started.diagnostics };
      }
      const frozenSkills = new Map(
        openSkills.effectiveComposition.works.flatMap((work) =>
          work.layers.map((layer) => [layer.skill.name, layer.skill] as const),
        ),
      );
      for (const skill of frozenSkills.values()) {
        await this.coordinator.bindSkill(runId, skill);
      }
      await this.ctx.workExecutionAuthority.recordSkillComposition(
        runId,
        openSkills.effectiveComposition,
      );
      await this.ctx.workExecutionAuthority.recordWorkCreated(runId, lifecycle.currentWork);
      await this.recordChangeStartObservation({
        runId,
        workspaceId,
        changeId,
        result: 'created',
        bindingError: 'none',
        runCreated: true,
        workCreated: true,
        checkpointChanged: true,
        recovery: 'none',
      });
      const activationState = await this.ctx.runStore.loadRun(runId);
      const activationIntentId = `sha256:${createHash('sha256')
        .update(`${runId}\0${activationState.stateVersion}\0desktop.activation`)
        .digest('hex')}` as const;
      let activation: DesktopActivationResult;
      try {
        activation = parseDesktopActivationResult(
          await this.ctx.desktopLauncher.activate({
            schemaVersion: 1,
            workspaceId,
            changeId,
            runId,
          }),
        );
      } catch {
        activation = {
          status: 'unavailable',
          targetKind: 'none',
          reason: 'target-unavailable',
        };
      }
      const diagnostics: RuntimeDiagnostic[] = [
        ...started.diagnostics,
        desktopActivationDiagnostic(activation),
      ];
      try {
        diagnostics.push(
          ...(await this.coordinator.recordDesktopActivation(runId, activationIntentId, {
            result: activation.status,
            targetKind: activation.targetKind,
            reason: activation.reason,
          })),
        );
      } catch {
        diagnostics.push({
          level: 'warning',
          code: 'desktop.activation.observation-unavailable',
          message: 'Repoctopus Desktop activation observation could not be persisted',
        });
      }
      return { value: await this.coordinator.status(runId), diagnostics };
    });
  }

  private async recordChangeStartObservation(input: {
    runId: string;
    workspaceId: string;
    changeId: string;
    result: 'rejected' | 'created' | 'reused' | 'conflict';
    bindingError: string;
    runCreated: boolean;
    workCreated: boolean;
    checkpointChanged: boolean;
    recovery: 'none' | 'resumed' | 'rejected';
  }): Promise<void> {
    try {
      const delivery = this.ctx.get('observationDelivery');
      if (!delivery) return;
      const observedAt = new Date().toISOString();
      await delivery.append([
        createApplicationObservationEnvelope({
          eventId: createHash('sha256')
            .update(
              canonicalJson({
                runId: input.runId,
                result: input.result,
                bindingError: input.bindingError,
                runCreated: input.runCreated,
                workCreated: input.workCreated,
                checkpointChanged: input.checkpointChanged,
                recovery: input.recovery,
              }),
            )
            .digest('hex'),
          runId: input.runId,
          observedAt,
          eventType: 'platform.change-start',
          context: { workspaceId: input.workspaceId, changeId: input.changeId },
          attributes: {
            result: input.result,
            bindingError: input.bindingError,
            runCreated: input.runCreated,
            workCreated: input.workCreated,
            checkpointChanged: input.checkpointChanged,
            recovery: input.recovery,
          },
        }),
      ]);
    } catch {
      // Canonical observation delivery is best-effort and never changes Runtime authority.
    }
  }

  status(runId: string, signal?: AbortSignal): Promise<RunStatusView> {
    return this.operations.run({ cancellable: true, signal }, async () => {
      const status = await this.coordinator.status(runId);
      return {
        ...status,
        skillCompatibility: await this.skillCompatibility(runId, signal),
        specificationCompatibility: await this.specificationCompatibility(runId),
      };
    });
  }

  async changeStatus(runId: string, signal?: AbortSignal): Promise<ChangeRunProjection> {
    const status = await this.status(runId, signal);
    if (!status.changeLifecycle) throw new Error(`Run is not a Change lifecycle Run: ${runId}`);
    return status.changeLifecycle;
  }

  decideChange(
    input: DecideChangeRunInput,
    signal?: AbortSignal,
  ): Promise<SpecificationApprovalState | RunStatusView> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(input.runId);
      const lifecycle = state.changeLifecycle;
      if (
        lifecycle?.phase === 'open' &&
        state.status === 'waiting' &&
        lifecycle.waitCondition?.kind === 'human-decision' &&
        lifecycle.waitCondition.waitId.startsWith('workspace-intent:')
      ) {
        const wait = lifecycle.waitCondition;
        if (!input.actor.authenticated) {
          throw new Error('Workspace intent revision requires a trusted actor');
        }
        if (
          input.response.requestId !== wait.requestId ||
          input.response.proposalHash !== wait.proposalDigest
        ) {
          throw new Error('Workspace intent revision does not match the current proposal');
        }
        if (input.response.decision !== 'approve') {
          return this.coordinator.status(input.runId);
        }
        if (!input.isolation) {
          throw new Error(
            'Workspace intent revision requires current, branch, or worktree isolation',
          );
        }
        const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(input.runId);
        const intent = createExecutionWorkspaceIntent({
          workspaceId: lifecycle.identity.workspaceId,
          changeId: lifecycle.identity.changeId,
          isolation: input.isolation,
        });

        // Binding is a read-only precondition. No lifecycle, approval, Skill, or Work state is
        // written until the replacement intent is proven against the frozen checkout snapshot.
        await this.bindExecutionWorkspaceIntent(state, intent, projectSnapshot);

        const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
        const specificationRoot = state.trigger?.facts.specificationRoot as
          | { repositoryId?: unknown }
          | undefined;
        if (
          typeof projectConfigDigest !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
          typeof specificationRoot?.repositoryId !== 'string'
        ) {
          throw new Error('Workspace intent revision trigger identities are missing');
        }
        const skills = await this.resolveLifecycleWorkSkills(
          'specification.plan',
          signal,
          [],
          input.runId,
        );
        const work = createLifecyclePhaseWork({
          runId: input.runId,
          checkEpoch: lifecycle.checkEpoch + 1,
          changeId: lifecycle.identity.changeId,
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          kind: 'specification.plan',
          actionSkill: skills.actionSkill,
          augmentationSkills: skills.augmentationSkills,
          skillComposition: skills.skillComposition,
          compositionDigest: state.composition.compositionDigest,
          projectSnapshotDigest: state.projectSnapshotDigest,
          projectConfigDigest: projectConfigDigest as `sha256:${string}`,
          workspaceRepositoryId: specificationRoot.repositoryId,
          repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
        });
        for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
          await this.coordinator.bindSkill(input.runId, skill);
        }
        const decided = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'workspace-intent-revised',
          requestId: input.response.requestId,
          proposalDigest: input.response.proposalHash,
          actorId: input.actor.actorId,
          intent,
          work,
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, work);
        await this.ctx.workExecutionAuthority.recordWaitBoundary({
          runId: input.runId,
          waitId: wait.waitId,
          stage: 'ended',
          kind: 'human-decision',
          reason: wait.reason,
        });
        return this.coordinator.status(decided.value.state.runId);
      }
      if (
        lifecycle?.phase === 'build' &&
        state.status === 'waiting' &&
        lifecycle.waitCondition?.kind === 'human-decision' &&
        lifecycle.waitCondition.waitId.startsWith('build-plan:')
      ) {
        if (!input.actor.authenticated) {
          throw new Error('Build Plan approval requires a trusted actor');
        }
        if (
          input.response.requestId !== lifecycle.waitCondition.requestId ||
          input.response.proposalHash !== lifecycle.waitCondition.proposalDigest
        ) {
          throw new Error('Build Plan response does not match the current proposal');
        }
        const protocol = lifecycle.buildProtocol;
        const strategy = protocol?.strategy;
        const binding = protocol?.binding;
        const plan = protocol?.plan;
        if (
          !protocol ||
          !strategy ||
          !binding ||
          !plan ||
          protocol.currentAction !== 'plan-evidence'
        ) {
          throw new Error('Build Plan approval has no active Plan Evidence');
        }
        const taskSet = await this.ctx.specification.tasks(lifecycle.identity.changeId, signal);
        const protectedBranches = frozenProtectedBranches(state);
        const evidence = createPlanEvidence({
          plan,
          strategy,
          binding,
          validation: validateBuildPlan({
            plan,
            strategy,
            binding,
            tasks: taskSet,
            protectedBranches,
          }),
          protectedBranches,
          compositionCheckpointDigest: state.composition.compositionDigest,
          reportOwnerId: lifecycle.identity.workspaceId,
        });
        if (evidence.validationDigest !== input.response.proposalHash) {
          throw new Error('Build Plan Evidence drifted before the Human Decision');
        }
        const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(input.runId);
        const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
        const specificationRoot = state.trigger?.facts.specificationRoot as
          | { repositoryId?: unknown }
          | undefined;
        if (
          typeof projectConfigDigest !== 'string' ||
          !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
          typeof specificationRoot?.repositoryId !== 'string'
        ) {
          throw new Error('Build Plan decision trigger identities are missing');
        }
        const approved = input.response.decision === 'approve';
        if (approved && !protocol.workspaceCheckpoint) {
          throw new Error('Build Plan approval requires a Runtime-owned workspace checkpoint');
        }
        const completedPackageIds = new Set(
          protocol.packageCompletions.map((completion) => completion.packageId),
        );
        const nextPackage = approved
          ? plan.packages.find(
              (workPackage) =>
                !completedPackageIds.has(workPackage.packageId) &&
                workPackage.dependsOn.every((dependency) => completedPackageIds.has(dependency)),
            )
          : undefined;
        const kind = approved ? (nextPackage ? 'build.execute' : 'build.check') : 'build.plan';
        const composition = buildActionSkillComposition({
          action: kind.slice('build.'.length) as 'plan' | 'execute' | 'check',
          tddMode: strategy.tddMode,
        });
        const skills = await this.resolveLifecycleWorkSkills(
          kind,
          signal,
          composition.augmentationSkills,
          input.runId,
        );
        const work = createBuildActionWork({
          runId: input.runId,
          checkEpoch: lifecycle.checkEpoch + 1,
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          kind,
          actionSkill: skills.actionSkill,
          augmentationSkills: skills.augmentationSkills,
          skillComposition: skills.skillComposition,
          compositionDigest: state.composition.compositionDigest,
          projectConfigDigest: projectConfigDigest as `sha256:${string}`,
          projectSnapshotDigest: state.projectSnapshotDigest,
          workspaceRepositoryId: specificationRoot.repositoryId,
          repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
          strategyId: strategy.strategyId,
          bindingId: binding.bindingId,
          executionMode: strategy.executionMode,
          tddMode: strategy.tddMode,
          planId: plan.planId,
          planRevision: plan.revision,
          ...(nextPackage
            ? { packageId: nextPackage.packageId, writeScopes: nextPackage.writeScopes }
            : {}),
          stableInput: approved
            ? {
                planEvidenceId: evidence.evidenceId,
                planDigest: plan.digest,
                workspaceCheckpointDigest: protocol.workspaceCheckpoint!.digest,
                ...(nextPackage ? { packageDigest: nextPackage.digest } : {}),
              }
            : { rejectedPlanDigest: plan.digest, reason: 'human-plan-revision' },
        });
        for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
          await this.coordinator.bindSkill(input.runId, skill);
        }
        const waitId = lifecycle.waitCondition.waitId;
        const decided = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'build-plan-decision',
          decision: approved ? 'approve' : 'reject',
          requestId: input.response.requestId,
          proposalDigest: input.response.proposalHash,
          actorId: input.actor.actorId,
          evidence,
          work,
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, work);
        await this.ctx.workExecutionAuthority.recordWaitBoundary({
          runId: input.runId,
          waitId,
          stage: 'ended',
          kind: 'human-decision',
          reason: lifecycle.waitCondition.reason,
        });
        return this.coordinator.status(decided.value.state.runId);
      }
      if (
        lifecycle?.phase === 'build' &&
        state.status === 'waiting' &&
        lifecycle.waitCondition?.kind === 'human-decision' &&
        lifecycle.waitCondition.waitId.startsWith('build-design:')
      ) {
        if (!input.actor.authenticated) throw new Error('Design fallback requires a trusted actor');
        if (
          input.response.requestId !== lifecycle.waitCondition.requestId ||
          input.response.proposalHash !== lifecycle.waitCondition.proposalDigest
        ) {
          throw new Error('Design fallback response does not match the current proposal');
        }
        let designWork: WorkDescriptor | undefined;
        if (input.response.decision === 'approve') {
          const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(input.runId);
          const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
          const specificationRoot = state.trigger?.facts.specificationRoot as
            | { repositoryId?: unknown }
            | undefined;
          if (
            typeof projectConfigDigest !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
            typeof specificationRoot?.repositoryId !== 'string'
          ) {
            throw new Error('Design fallback trigger identities are missing');
          }
          const skills = await this.resolveLifecycleWorkSkills(
            'specification.plan',
            signal,
            [],
            input.runId,
          );
          designWork = createLifecyclePhaseWork({
            runId: input.runId,
            checkEpoch: lifecycle.checkEpoch + 1,
            changeId: lifecycle.identity.changeId,
            definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
            kind: 'specification.plan',
            actionSkill: skills.actionSkill,
            augmentationSkills: skills.augmentationSkills,
            skillComposition: skills.skillComposition,
            compositionDigest: state.composition.compositionDigest,
            projectSnapshotDigest: state.projectSnapshotDigest,
            projectConfigDigest: projectConfigDigest as `sha256:${string}`,
            workspaceRepositoryId: specificationRoot.repositoryId,
            repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
          });
          for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
            await this.coordinator.bindSkill(input.runId, skill);
          }
        }
        const waitId = lifecycle.waitCondition.waitId;
        const decided = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'build-design-revision-decision',
          decision: input.response.decision === 'approve' ? 'approve' : 'reject',
          requestId: input.response.requestId,
          proposalDigest: input.response.proposalHash,
          actorId: input.actor.actorId,
          ...(designWork ? { work: designWork } : {}),
        });
        if (designWork) {
          await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, designWork);
        }
        await this.ctx.workExecutionAuthority.recordWaitBoundary({
          runId: input.runId,
          waitId,
          stage: 'ended',
          kind: 'human-decision',
          reason: lifecycle.waitCondition.reason,
        });
        return this.coordinator.status(decided.value.state.runId);
      }
      if (
        !lifecycle ||
        (lifecycle.phase !== 'open' && lifecycle.phase !== 'design') ||
        state.status !== 'waiting' ||
        lifecycle.waitCondition?.kind !== 'human-decision'
      ) {
        throw new Error('Change Run is not waiting for an Open or Design Human Decision');
      }
      if (
        input.response.requestId !== lifecycle.waitCondition.requestId ||
        input.response.proposalHash !== lifecycle.waitCondition.proposalDigest
      ) {
        throw new Error('Human Decision does not match the current Change Run proposal');
      }
      if (lifecycle.phase === 'open' && input.response.decision === 'approve') {
        if (!input.isolation) {
          throw new Error('Open approval requires current, branch, or worktree isolation');
        }
        const intent = createExecutionWorkspaceIntent({
          workspaceId: lifecycle.identity.workspaceId,
          changeId: lifecycle.identity.changeId,
          isolation: input.isolation,
        });
        const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(input.runId);
        await this.bindExecutionWorkspaceIntent(state, intent, projectSnapshot);
        await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'open-workspace-intent-selected',
          intent,
          requestId: input.response.requestId,
          proposalDigest: input.response.proposalHash,
          actorId: input.actor.actorId,
        });
      }
      const decided = await this.ctx.specificationPlanning.decide({
        changeId: lifecycle.identity.changeId,
        approvalPhase: lifecycle.phase,
        response: input.response,
        actor: input.actor,
      });
      if (decided.decision?.proposalHash !== lifecycle.waitCondition.proposalDigest) {
        throw new Error('Recorded Human Decision does not match the current Change Run proposal');
      }
      return decided;
    });
  }

  bindSkill(
    runId: string,
    definition: SkillDefinition,
    signal?: AbortSignal,
  ): Promise<SkillUsageSnapshot> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const snapshot = await snapshotSkillDefinition(definition);
      return this.coordinator.bindSkill(runId, snapshot);
    });
  }

  bindSpecification(
    runId: string,
    validation: SpecificationValidation,
    signal?: AbortSignal,
  ): Promise<SpecificationUsageSnapshot> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.coordinator.bindSpecification(runId, {
        schemaVersion: 1,
        changeId: validation.changeId,
        provider: structuredClone(validation.provider),
        validationDigest: validation.validationDigest,
      }),
    );
  }

  bindSpecificationClosurePlan(
    runId: string,
    plan: SpecificationClosurePlan,
    signal?: AbortSignal,
  ): Promise<SpecificationUsageSnapshot> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.coordinator.bindSpecificationClosurePlan(runId, plan),
    );
  }

  private async assessChangePlanning(
    state: RunState,
    lifecycle: ChangeLifecycleState,
    approvalPhase: 'open' | 'design',
    signal?: AbortSignal,
  ): Promise<{
    assessment: DesignGateAssessment;
    observationUnavailable?: Error;
    projectSnapshot: ProjectSnapshot;
    projectConfigDigest: `sha256:${string}`;
    workspaceRepositoryId: string;
  }> {
    const base = await this.loadChangePlanningBase(state, lifecycle, approvalPhase);
    let assessment: DesignGateAssessment;
    let observationUnavailable: Error | undefined;
    try {
      const changeBranch = await this.ctx.project.changeBranch({
        repositoryId: base.workspaceRepositoryId,
        repositoryPath: base.workspaceRepositoryPath,
        remote: base.remote,
        targetBranch: base.targetBranch,
      });
      assessment = await this.ctx.specificationPlanning.assess({
        changeId: lifecycle.identity.changeId,
        decisionRunId: state.runId,
        approvalPhase,
        changeBranch,
        ...(approvalPhase === 'design'
          ? {
              buildStrategyDigest: this.buildStrategy(state, lifecycle).semanticDigest,
              preflight: async () => {
                const profileId = state.trigger?.facts.verificationProfileId;
                if (typeof profileId !== 'string' || !profileId.trim()) {
                  throw new Error('Design preflight requires a verification profile');
                }
                const [taskSet, plan] = await Promise.all([
                  this.ctx.specification.tasks(lifecycle.identity.changeId, signal),
                  this.ctx.evidenceCoordinator.compile(profileId),
                ]);
                const coverage = resolveAcceptanceCoverage(taskSet.tasks, plan);
                return { evidenceDigests: [coverage.acceptanceSetHash] };
              },
            }
          : {}),
        ...(approvalPhase === 'open' && lifecycle.openApprovalInvalidated
          ? {
              forceNewApproval: true,
              requestId: `open-repair:${state.runId}:${lifecycle.revision}`,
            }
          : {}),
        ...(signal ? { signal } : {}),
      });
      if (assessment.observation) {
        try {
          await this.ctx.workExecutionAuthority.recordSpecificationObservations({
            runId: state.runId,
            ...assessment.observation,
          });
        } catch {
          // Provider facts still decide the Gate when the observation sink is unavailable.
        }
      }
    } catch (error) {
      observationUnavailable =
        error instanceof Error ? error : new Error(`${approvalPhase} gate assessment failed`);
      assessment = {
        status: 'blocked',
        reason: observationUnavailable.message,
        evidenceDigests: [],
      };
    }
    return {
      assessment,
      ...(observationUnavailable ? { observationUnavailable } : {}),
      projectSnapshot: base.projectSnapshot,
      projectConfigDigest: base.projectConfigDigest,
      workspaceRepositoryId: base.workspaceRepositoryId,
    };
  }

  private buildStrategy(state: RunState, lifecycle: ChangeLifecycleState): BuildStrategy {
    if (!lifecycle.workspaceIntent) {
      throw new Error('Build Strategy requires the approved Workspace isolation intent');
    }
    const preference = state.trigger?.facts.buildStrategyPreference as
      | {
          schemaVersion?: unknown;
          executionMode?: unknown;
          tddMode?: unknown;
          reviewMode?: unknown;
        }
      | undefined;
    if (
      preference?.schemaVersion !== 1 ||
      (preference.executionMode !== 'autonomous' &&
        preference.executionMode !== 'subagent-driven-development') ||
      (preference.tddMode !== 'tdd' && preference.tddMode !== 'direct') ||
      preference.reviewMode !== 'standard'
    ) {
      throw new Error('Change Run is missing its frozen Build Strategy preference');
    }
    const current = lifecycle.buildProtocol?.strategy;
    const candidate = createBuildStrategy({
      runId: state.runId,
      revision: current?.revision ?? 1,
      executionMode: preference.executionMode,
      tddMode: preference.tddMode,
      reviewMode: preference.reviewMode,
      isolationIntent: lifecycle.workspaceIntent.isolation,
    });
    if (current && current.semanticDigest !== candidate.semanticDigest) {
      return createBuildStrategy({
        runId: state.runId,
        revision: current.revision + 1,
        executionMode: candidate.executionMode,
        tddMode: candidate.tddMode,
        reviewMode: candidate.reviewMode,
        isolationIntent: candidate.isolationIntent,
      });
    }
    return candidate;
  }

  private async loadChangePlanningBase(
    state: RunState,
    lifecycle: ChangeLifecycleState,
    approvalPhase: 'open' | 'design',
  ) {
    const triggerFacts = state.trigger?.facts;
    const target = triggerFacts?.targetBranch;
    const projectConfigDigest = triggerFacts?.projectConfigDigest;
    if (
      !target ||
      typeof target !== 'object' ||
      typeof (target as { repositoryId?: unknown }).repositoryId !== 'string' ||
      typeof (target as { remote?: unknown }).remote !== 'string' ||
      typeof (target as { targetBranch?: unknown }).targetBranch !== 'string' ||
      typeof projectConfigDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest)
    ) {
      throw new Error(`Change Run is missing its stable ${approvalPhase} input facts`);
    }
    const targetBranch = target as {
      repositoryId: string;
      remote: string;
      targetBranch: string;
    };
    const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(lifecycle.identity.runId);
    const workspaceRepository = projectSnapshot.repositories.find(
      (repository) => repository.id === targetBranch.repositoryId,
    );
    if (!workspaceRepository) {
      throw new Error('Change Run Workspace Repository is no longer available');
    }
    return {
      projectSnapshot,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      workspaceRepositoryId: targetBranch.repositoryId,
      workspaceRepositoryPath: workspaceRepository.path,
      remote: targetBranch.remote,
      targetBranch: targetBranch.targetBranch,
    };
  }

  private async loadChangePlanningContext(
    state: RunState,
    lifecycle: ChangeLifecycleState,
    approvalPhase: 'open' | 'design',
  ): Promise<{
    projectSnapshot: ProjectSnapshot;
    projectConfigDigest: `sha256:${string}`;
    workspaceRepositoryId: string;
    changeBranch: ChangeBranchReference;
  }> {
    const base = await this.loadChangePlanningBase(state, lifecycle, approvalPhase);
    const changeBranch = await this.ctx.project.changeBranch({
      repositoryId: base.workspaceRepositoryId,
      repositoryPath: base.workspaceRepositoryPath,
      remote: base.remote,
      targetBranch: base.targetBranch,
    });
    return {
      projectSnapshot: base.projectSnapshot,
      projectConfigDigest: base.projectConfigDigest,
      workspaceRepositoryId: base.workspaceRepositoryId,
      changeBranch,
    };
  }

  private async observeChangePlanning(
    state: RunState,
    lifecycle: ChangeLifecycleState,
    signal?: AbortSignal,
  ): Promise<
    PlanningAuthorityObservation & {
      projectSnapshot: ProjectSnapshot;
      projectConfigDigest: `sha256:${string}`;
      workspaceRepositoryId: string;
    }
  > {
    if (!lifecycle.planningDigest) {
      throw new Error('Later-phase Change Run has no approved planning digest');
    }
    const base = await this.loadChangePlanningBase(state, lifecycle, 'design');
    const context = {
      projectSnapshot: base.projectSnapshot,
      projectConfigDigest: base.projectConfigDigest,
      workspaceRepositoryId: base.workspaceRepositoryId,
    };
    try {
      const observation = await this.ctx.specificationPlanning.observeAuthority({
        changeId: lifecycle.identity.changeId,
        approvalPhase: 'design',
        expectedPlanningDigest: lifecycle.planningDigest,
        buildStrategyDigest: this.buildStrategy(state, lifecycle).semanticDigest,
        ...(signal ? { signal } : {}),
      });
      return { ...observation, ...context };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Planning semantic inspection failed';
      return {
        status: 'invalid',
        observationKind: 'unknown',
        invalidationKind: 'semantic',
        planningDigest: `sha256:${createHash('sha256')
          .update(canonicalJson({ kind: 'planning-semantic-inspection-failed', reason }))
          .digest('hex')}`,
        reasonCode: 'strict-validation-failed',
        reason,
        evidenceDigests: [],
        snapshot: null,
        ...context,
      };
    }
  }

  private async returnToDesignForPlanningRevision(
    state: RunState,
    lifecycle: ChangeLifecycleState,
    observation: PlanningAuthorityObservation,
    projectSnapshot: ProjectSnapshot,
    projectConfigDigest: `sha256:${string}`,
    workspaceRepositoryId: string,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    if (!['build', 'verify', 'archive'].includes(lifecycle.phase)) {
      throw new Error(`Planning revision is not valid from ${lifecycle.phase}`);
    }
    if (!observation.invalidationKind) {
      throw new Error('Authorized planning cannot trigger a Design revision');
    }
    const skills = await this.resolveLifecycleWorkSkills(
      'specification.plan',
      signal,
      [],
      state.runId,
    );
    const work = createLifecyclePhaseWork({
      runId: state.runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      changeId: lifecycle.identity.changeId,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'specification.plan',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      skillComposition: skills.skillComposition,
      compositionDigest: state.composition.compositionDigest,
      projectSnapshotDigest: state.projectSnapshotDigest,
      projectConfigDigest,
      workspaceRepositoryId,
      repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(state.runId, skill);
    }
    const revised = await this.coordinator.acceptChangeObservation(state.runId, {
      kind: 'planning-authority-invalidated',
      expectedRevision: lifecycle.revision,
      fromPhase: lifecycle.phase as 'build' | 'verify' | 'archive',
      invalidationKind: observation.invalidationKind,
      reason: observation.reason,
      evidenceIds: observation.evidenceDigests,
      inputDigest: observation.planningDigest,
      work,
    });
    await this.ctx.workExecutionAuthority.recordWorkCreated(state.runId, work);
    return {
      ...revised,
      value: await this.coordinator.status(state.runId),
      diagnostics: [
        ...revised.diagnostics,
        {
          level: 'warning',
          code: 'change.planning-revision-required',
          message: `Planning authority requires Design revision (${observation.reasonCode})`,
        },
      ],
    };
  }

  private async resolveLifecycleWorkSkills(
    kind: string,
    signal?: AbortSignal,
    configuredAugmentationNames: readonly string[] = [],
    runId?: string,
  ): Promise<{
    actionSkill: SkillUsageSnapshot;
    augmentationSkills: SkillUsageSnapshot[];
    skillComposition: EffectiveWorkSkillComposition;
    effectiveComposition: EffectiveSkillComposition;
  }> {
    let resolved;
    try {
      resolved = await this.ctx.teamSkillComposition.resolveWork(
        BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind,
        signal,
        configuredAugmentationNames,
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (runId) {
        const message = error instanceof Error ? error.message : String(error);
        const reasonCode = /unavailable|resolves .*more than once|provider/iu.test(message)
          ? 'provider-unavailable'
          : /contract|capabilit|model-invocable|artifact protocol/iu.test(message)
            ? 'contract-invalid'
            : 'composition-invalid';
        await this.ctx.workExecutionAuthority.recordSkillCompositionRejected(runId, reasonCode);
      }
      throw error;
    }
    return {
      actionSkill: resolved.actionSkill,
      augmentationSkills: resolved.augmentationSkills,
      skillComposition: resolved.skillComposition,
      effectiveComposition: resolved.effectiveComposition,
    };
  }

  private async bindExecutionWorkspaceIntent(
    state: RunState,
    intent: ExecutionWorkspaceIntent,
    projectSnapshot: ProjectSnapshot,
  ): Promise<ExecutionWorkspaceBinding> {
    const checkoutInput = state.trigger?.facts.executionCheckouts;
    if (!Array.isArray(checkoutInput)) {
      throw new Error('Runner did not provide execution checkout bindings');
    }
    const checkouts = checkoutInput.map((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof (entry as { repositoryId?: unknown }).repositoryId !== 'string' ||
        typeof (entry as { checkoutPath?: unknown }).checkoutPath !== 'string'
      ) {
        throw new Error('Runner execution checkout binding is malformed');
      }
      return entry as { repositoryId: string; checkoutPath: string };
    });
    return this.ctx.executionWorkspace.bind({
      intent,
      project: projectSnapshot,
      checkouts,
    });
  }

  private async bindExecutionWorkspace(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
  ): Promise<ExecutionWorkspaceBinding> {
    if (!lifecycle.workspaceIntent) {
      throw new Error('Build requires the approved Workspace intent');
    }
    return this.bindExecutionWorkspaceIntent(state, lifecycle.workspaceIntent, projectSnapshot);
  }

  private async executionBindingDrift(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
    executionBinding: ExecutionBinding,
    invocationHost: WorkExecutionHostIdentity,
  ): Promise<'host' | 'checkout' | 'path' | null> {
    const observed = await this.bindExecutionWorkspace(state, lifecycle, projectSnapshot);
    const candidate = createExecutionBinding({
      strategy: lifecycle.buildProtocol!.strategy,
      revision: executionBinding.revision + 1,
      coordinatorHostId: invocationHost.id,
      workspaceBinding: observed,
      workspaceOwnerId: lifecycle.workspaceIntent!.workspaceId,
      localOverlayRef: `execution-workspace:${observed.localDigest.slice(-24)}`,
    });
    const withoutHead = (binding: ExecutionBinding) =>
      binding.repositories.map((repository) => ({
        repositoryId: repository.repositoryId,
        branchRef: repository.branchRef,
        isolation: repository.isolation,
        workspaceOwnerId: repository.workspaceOwnerId,
        worktreeId: repository.worktreeId,
      }));
    if (canonicalJson(withoutHead(candidate)) !== canonicalJson(withoutHead(executionBinding))) {
      return 'checkout';
    }
    if (candidate.localOverlayRef !== executionBinding.localOverlayRef) return 'path';
    if (candidate.coordinatorHostId !== executionBinding.coordinatorHostId) return 'host';
    return null;
  }

  private async authorizedProtectedBranchRebind(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    currentProjectSnapshot: ProjectSnapshot,
  ): Promise<AuthorizedProtectedBranchRebind | null> {
    const execution = state.workExecution;
    const rejectedPlan = [...(execution?.rejectedSubmissions ?? [])]
      .reverse()
      .find(
        (submission) =>
          submission.rejection.reasonCode === 'outcome-rejected' &&
          submission.outcome.result?.kind === 'build-plan-candidate',
      );
    const result = rejectedPlan?.outcome.result;
    const previousProjectSnapshot = await this.ctx.runStore.loadProjectSnapshot(state.runId);
    let poisonReconciliation: ProjectReconciliation | null = null;
    if (state.reconciliationRequired) {
      const trajectory = await this.ctx.runStore.loadTrajectory(state.runId);
      const value = trajectory.findLast((entry) => entry.type === 'recovery.reconciled')?.data
        .reconciliation;
      if (value && typeof value === 'object') {
        poisonReconciliation = value as ProjectReconciliation;
      }
    }
    const classified = classifyProtectedBranchRebind({
      phase: lifecycle.phase,
      workKind: lifecycle.currentWork?.kind ?? null,
      executionStatus: execution?.status ?? null,
      continuation: execution?.continuation ?? null,
      candidate: result?.kind === 'build-plan-candidate' ? result : null,
      binding: lifecycle.buildProtocol?.binding ?? null,
      protectedBranches: frozenProtectedBranches(state),
      previousProjectSnapshot,
      currentProjectSnapshot,
      reconciliationRequired: state.reconciliationRequired,
      poisonReconciliation,
    });
    if (!classified.authorized) return null;
    const invocationHost = execution?.hostInvocation?.host;
    const binding = lifecycle.buildProtocol?.binding;
    if (!invocationHost || !binding) return null;
    const drift = await this.executionBindingDrift(
      state,
      lifecycle,
      currentProjectSnapshot,
      binding,
      invocationHost,
    );
    return drift === 'checkout' ? classified.value : null;
  }

  private async priorAuthorizedBranchRebind(
    state: RunState,
    currentProjectSnapshot: ProjectSnapshot,
  ): Promise<
    | {
        kind: 'authorized-protected-branch-rebind';
        authorizationDigest: `sha256:${string}`;
        projectReconciliationDigest: `sha256:${string}`;
      }
    | undefined
  > {
    const previousProjectSnapshot = await this.ctx.runStore.loadProjectSnapshot(state.runId);
    const reconciliationDigest = projectReconciliationDigest(
      reconcileProjectSnapshots(previousProjectSnapshot, currentProjectSnapshot),
    );
    const trajectory = await this.ctx.runStore.loadTrajectory(state.runId);
    const fact = [...trajectory]
      .reverse()
      .map((entry) => entry.data.authorizedBranchRebind)
      .find(
        (value) =>
          value &&
          typeof value === 'object' &&
          (value as Record<string, unknown>).classification ===
            'authorized-protected-branch-rebind' &&
          (value as Record<string, unknown>).projectReconciliationDigest === reconciliationDigest,
      ) as Record<string, unknown> | undefined;
    if (
      !fact ||
      typeof fact.authorizationDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(fact.authorizationDigest)
    ) {
      return undefined;
    }
    return {
      kind: 'authorized-protected-branch-rebind',
      authorizationDigest: fact.authorizationDigest as `sha256:${string}`,
      projectReconciliationDigest: reconciliationDigest,
    };
  }

  private async advanceBuildWorkspaceProgress(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
    checkpoint: BuildWorkspaceCheckpoint,
    writableRepositoryIds: readonly string[],
  ): Promise<BuildWorkspaceCheckpoint> {
    const observed = await this.bindExecutionWorkspace(state, lifecycle, projectSnapshot);
    const currentById = new Map(
      checkpoint.repositories.map((repository) => [repository.repositoryId, repository] as const),
    );
    const relations = Object.fromEntries(
      await Promise.all(
        observed.repositories.map(async (repository) => {
          const current = currentById.get(repository.repositoryId);
          if (!current) return [repository.repositoryId, 'non-fast-forward'] as const;
          if (current.headRevision === repository.head) {
            return [repository.repositoryId, 'unchanged'] as const;
          }
          let fastForward: boolean;
          try {
            fastForward = await this.ctx.executionWorkspace.isAncestor(
              repository.checkoutPath,
              current.headRevision,
              repository.head,
            );
          } catch (error) {
            throw new BuildWorkspaceProgressError(
              'Runtime could not establish repository ancestry',
              'observation-failed',
              { cause: error },
            );
          }
          return [
            repository.repositoryId,
            fastForward ? 'fast-forward' : 'non-fast-forward',
          ] as const;
        }),
      ),
    );
    return advanceBuildWorkspaceCheckpoint({
      current: checkpoint,
      observed: observed.repositories.map((repository) => ({
        repositoryId: repository.repositoryId,
        branchRef: repository.branch,
        headRevision: repository.head,
      })),
      writableRepositoryIds,
      relations,
    });
  }

  private async assertBuildWorkspaceCheckpointCurrent(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
    checkpoint: BuildWorkspaceCheckpoint,
  ): Promise<void> {
    const observed = await this.bindExecutionWorkspace(state, lifecycle, projectSnapshot);
    const actual = observed.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      branchRef: repository.branch,
      headRevision: repository.head,
    }));
    if (canonicalJson(actual) !== canonicalJson(checkpoint.repositories)) {
      throw new Error('Build workspace changed after the last accepted Package checkpoint');
    }
  }

  private async executionWorkspaceDrift(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
    executionBinding: ExecutionBinding,
  ): Promise<'checkout' | 'path' | null> {
    const observed = await this.bindExecutionWorkspace(state, lifecycle, projectSnapshot);
    const repositories = observed.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      branchRef: repository.branch,
      headRevision: repository.head,
      isolation: observed.isolation,
      workspaceOwnerId: lifecycle.workspaceIntent!.workspaceId,
      worktreeId: repository.worktreeId,
    }));
    const withoutHead = (entries: readonly ExecutionBinding['repositories'][number][]) =>
      entries.map((repository) => ({
        repositoryId: repository.repositoryId,
        branchRef: repository.branchRef,
        isolation: repository.isolation,
        workspaceOwnerId: repository.workspaceOwnerId,
        worktreeId: repository.worktreeId,
      }));
    if (
      canonicalJson(withoutHead(repositories)) !==
      canonicalJson(withoutHead(executionBinding.repositories))
    ) {
      return 'checkout';
    }
    const overlayRef = `execution-workspace:${observed.localDigest.slice(-24)}`;
    return overlayRef === executionBinding.localOverlayRef ? null : 'path';
  }

  private async dispatchExecutionBindingRevalidation(input: {
    state: RunState;
    lifecycle: NonNullable<RunState['changeLifecycle']>;
    projectSnapshot: ProjectSnapshot;
    projectConfigDigest: `sha256:${string}`;
    workspaceRepositoryId: string;
    reasonCode:
      | 'host'
      | 'checkout'
      | 'head'
      | 'path'
      | 'checkpoint-migration'
      | 'protected-branch-correction';
    authorizedRebind?: {
      entrypoint: 'next' | 'resume';
      evidence: AuthorizedProtectedBranchRebind;
    };
    signal?: AbortSignal;
  }) {
    const protocol = input.lifecycle.buildProtocol!;
    const strategy = protocol.strategy;
    const skills = await this.resolveLifecycleWorkSkills(
      'build.configure',
      input.signal,
      [],
      input.state.runId,
    );
    const work = createBuildActionWork({
      runId: input.state.runId,
      checkEpoch: input.lifecycle.checkEpoch + 1,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.configure',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      skillComposition: skills.skillComposition,
      compositionDigest: input.state.composition.compositionDigest,
      projectConfigDigest: input.projectConfigDigest,
      projectSnapshotDigest: input.state.projectSnapshotDigest,
      workspaceRepositoryId: input.workspaceRepositoryId,
      repositoryIds: input.projectSnapshot.repositories.map((repository) => repository.id),
      strategyId: strategy.strategyId,
      executionMode: strategy.executionMode,
      tddMode: strategy.tddMode,
      stableInput: {
        reason: 'execution-binding-drift',
        reasonCode: input.reasonCode,
        previousBindingId: protocol.binding!.bindingId,
        ...(input.authorizedRebind
          ? {
              authorizationDigest: input.authorizedRebind.evidence.authorizationDigest,
              correctedRepositoryCount: input.authorizedRebind.evidence.repositoryCount,
              unresolvedRepositoryCount:
                input.authorizedRebind.evidence.unresolvedRepositoryIds.length,
            }
          : {}),
      },
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(input.state.runId, skill);
    }
    const reason = `Execution Binding ${input.reasonCode} drift requires automatic revalidation`;
    const transitioned = await this.coordinator.acceptChangeObservation(
      input.state.runId,
      {
        kind: 'build-binding-revalidation-required',
        reasonCode: input.reasonCode,
        reason,
        work,
      },
      input.authorizedRebind ? { authorizedRebind: input.authorizedRebind } : undefined,
    );
    await this.ctx.workExecutionAuthority.recordWorkCreated(input.state.runId, work);
    return {
      ...transitioned,
      value: await this.coordinator.status(input.state.runId),
      diagnostics: [
        ...transitioned.diagnostics,
        {
          level: 'warning' as const,
          code: 'change.build-binding-revalidation-required',
          message: reason,
        },
      ],
    };
  }

  private async createDesignWork(
    state: RunState,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    const lifecycle = state.changeLifecycle;
    if (!lifecycle || lifecycle.phase !== 'design' || lifecycle.currentWork) {
      throw new Error('Design Work can only be created at an empty Design continuation');
    }
    const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(state.runId);
    const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
    const specificationRoot = state.trigger?.facts.specificationRoot as
      | { repositoryId?: unknown }
      | undefined;
    if (
      typeof projectConfigDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
      typeof specificationRoot?.repositoryId !== 'string'
    ) {
      throw new Error('Design Work trigger identities are missing');
    }
    const skills = await this.resolveLifecycleWorkSkills(
      'specification.plan',
      signal,
      [],
      state.runId,
    );
    const work = createLifecyclePhaseWork({
      runId: state.runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      changeId: lifecycle.identity.changeId,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'specification.plan',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      skillComposition: skills.skillComposition,
      compositionDigest: state.composition.compositionDigest,
      projectSnapshotDigest: state.projectSnapshotDigest,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      workspaceRepositoryId: specificationRoot.repositoryId,
      repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(state.runId, skill);
    }
    const created = await this.coordinator.acceptChangeObservation(state.runId, {
      kind: 'design-work-ready',
      work,
    });
    await this.ctx.workExecutionAuthority.recordWorkCreated(state.runId, work);
    return { ...created, value: await this.coordinator.status(state.runId) };
  }

  private async validateOpenWork(
    state: RunState,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    const lifecycle = state.changeLifecycle;
    const execution = state.workExecution;
    const work = lifecycle?.currentWork;
    if (
      !lifecycle ||
      lifecycle.phase !== 'open' ||
      !work ||
      work.kind !== 'change.intake' ||
      execution?.status !== 'outcome' ||
      execution.actionOutcome?.status !== 'succeeded' ||
      !execution.receiptId
    ) {
      throw new Error('Open Work is not ready for Provider validation');
    }
    let receipt: ActionReceipt;
    let change: SpecificationChange;
    let intent: ActionIntent;
    let providerValidation: SpecificationValidation;
    try {
      [receipt, change, intent, providerValidation] = await Promise.all([
        this.ctx.actionStore.loadReceipt(state.runId, execution.receiptId),
        this.ctx.specification.inspect(lifecycle.identity.changeId, signal),
        this.ctx.workExecutionAuthority.loadIntent(state.runId),
        this.ctx.specification.validate(lifecycle.identity.changeId, {
          strict: true,
          ...(signal ? { signal } : {}),
        }),
      ]);
    } catch (error) {
      if (error instanceof ChangeStartBindingError) throw error;
      return this.openObservationUnavailable(state.runId, error, 'provider-validation');
    }
    try {
      await this.ctx.workExecutionAuthority.recordSpecificationObservations({
        runId: state.runId,
        artifacts: change.artifacts,
        validation: providerValidation,
      });
    } catch {
      // Provider facts still decide the Gate when the observation sink is unavailable.
    }
    if (
      receipt.intentId !== execution.intentId ||
      receipt.outcome !== 'succeeded' ||
      change.changeId !== lifecycle.identity.changeId
    ) {
      throw new Error('Open Provider validation is not bound to the authoritative Work Outcome');
    }
    if (!providerValidation.strict || !providerValidation.valid) {
      return this.dispatchOpenRepair({
        state,
        lifecycle,
        source: 'strict-validation',
        reasonCode: 'strict-validation-invalid',
        evidenceIds: [change.changeDigest, providerValidation.validationDigest],
        ...(signal ? { signal } : {}),
      });
    }
    try {
      normalizePlanningArtifacts(change);
    } catch {
      return this.dispatchOpenRepair({
        state,
        lifecycle,
        source: 'provider-artifacts',
        reasonCode: 'provider-artifacts-invalid',
        evidenceIds: [
          change.changeDigest,
          ...change.artifacts.flatMap((artifact) => (artifact.digest ? [artifact.digest] : [])),
        ],
        ...(signal ? { signal } : {}),
      });
    }
    const validator = this.ctx.lifecycleValidators.resolve(work.validatorProfile.id);
    const validation = await validator.validate({
      profileId: work.validatorProfile.id,
      work,
      fact: { receiptId: receipt.receiptId, changeDigest: change.changeDigest },
    });
    if (!validation.accepted) {
      return this.dispatchOpenRepair({
        state,
        lifecycle,
        source: 'lifecycle-validator',
        reasonCode: 'lifecycle-validator-rejected',
        evidenceIds: [receipt.receiptId, change.changeDigest],
        ...(signal ? { signal } : {}),
      });
    }
    await this.ctx.workExecutionAuthority.markValidated({
      intent,
      validatorId: work.validatorProfile.id,
      continuation: 'execute',
    });
    return this.advanceOpenGate(state, signal);
  }

  private async openObservationUnavailable(
    runId: string,
    error: unknown,
    observationStage: 'provider-validation' | 'planning-gate',
  ): Promise<RuntimeResult<RunStatusView>> {
    const value = await this.coordinator.status(runId);
    const execution = value.state.workExecution;
    const lifecycle = value.state.changeLifecycle;
    return {
      value: {
        ...value,
        continuation: {
          schemaVersion: 2,
          continuation: 'reobserve',
          workId: execution?.workId ?? lifecycle?.currentWork?.workId ?? null,
          attempt: execution?.attempt ?? null,
          checkEpoch: execution?.checkEpoch ?? lifecycle?.checkEpoch ?? null,
          reason: 'open-observation-unavailable',
          observationStage,
        },
      },
      diagnostics: [
        {
          level: 'warning',
          code: 'runtime.open-observation-unavailable',
          message:
            error instanceof Error
              ? `Open Provider observation is unavailable: ${error.message}`
              : 'Open Provider observation is unavailable',
        },
      ],
    };
  }

  private async dispatchOpenRepair(input: {
    state: RunState;
    lifecycle: ChangeLifecycleState;
    source: OpenRepairSource;
    reasonCode: OpenRepairReasonCode;
    evidenceIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<RuntimeResult<RunStatusView>> {
    let base: Awaited<ReturnType<WorkflowRuns['loadChangePlanningBase']>>;
    let skills: Awaited<ReturnType<WorkflowRuns['resolveLifecycleWorkSkills']>>;
    try {
      [base, skills] = await Promise.all([
        this.loadChangePlanningBase(input.state, input.lifecycle, 'open'),
        this.resolveLifecycleWorkSkills('change.intake', input.signal, [], input.state.runId),
      ]);
    } catch (error) {
      return this.openObservationUnavailable(input.state.runId, error, 'provider-validation');
    }
    const work = createLifecyclePhaseWork({
      runId: input.state.runId,
      checkEpoch: input.lifecycle.checkEpoch + 1,
      changeId: input.lifecycle.identity.changeId,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'change.intake',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      skillComposition: skills.skillComposition,
      compositionDigest: input.state.composition.compositionDigest,
      projectSnapshotDigest: input.state.projectSnapshotDigest,
      projectConfigDigest: base.projectConfigDigest,
      workspaceRepositoryId: base.workspaceRepositoryId,
      repositoryIds: base.projectSnapshot.repositories.map((repository) => repository.id),
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(input.state.runId, skill);
    }
    await this.ctx.workExecutionAuthority.recordCurrentSkillCorrection(
      input.state.runId,
      'repair-work',
      `open-repair:${input.lifecycle.revision}:${input.source}:${input.reasonCode}`,
    );
    const repaired = await this.coordinator.acceptChangeObservation(input.state.runId, {
      kind: 'open-repair-required',
      expectedRevision: input.lifecycle.revision,
      source: input.source,
      reasonCode: input.reasonCode,
      evidenceIds: [...new Set(input.evidenceIds)],
      inputDigest: work.inputDigest,
      work,
    });
    await this.ctx.workExecutionAuthority.recordWorkCreated(input.state.runId, work);
    return { ...repaired, value: await this.coordinator.status(input.state.runId) };
  }

  private async advanceOpenGate(
    state: RunState,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    const lifecycle = state.changeLifecycle;
    if (!lifecycle || lifecycle.phase !== 'open') {
      throw new Error('Open gate requires an Open Change Run');
    }
    if (state.status === 'waiting' && lifecycle.waitCondition?.kind === 'human-decision') {
      let approval: SpecificationApprovalState | null;
      try {
        approval = await this.ctx.specificationPlanning.status(lifecycle.identity.changeId, 'open');
      } catch (error) {
        return this.openObservationUnavailable(state.runId, error, 'planning-gate');
      }
      if (approval?.status === 'approved') {
        const revalidation = await this.ctx.specificationPlanning.revalidateOpenApproval({
          changeId: lifecycle.identity.changeId,
          approvalPhase: 'open',
          changeBranch: approval.snapshot.changeBranch,
          expectedSnapshotDigest: lifecycle.waitCondition.inputDigest,
          ...(signal ? { signal } : {}),
        });
        if (revalidation.observation) {
          try {
            await this.ctx.workExecutionAuthority.recordSpecificationObservations({
              runId: state.runId,
              ...revalidation.observation,
            });
          } catch {
            // Provider facts remain authoritative when the observation sink is unavailable.
          }
        }
        if (revalidation.status === 'unavailable') {
          return this.openObservationUnavailable(
            state.runId,
            new Error(revalidation.reason),
            'planning-gate',
          );
        }
        if (revalidation.status === 'invalid') {
          return this.dispatchOpenRepair({
            state,
            lifecycle,
            source: revalidation.source ?? 'approval-drift',
            reasonCode: revalidation.reasonCode ?? 'approval-drift',
            evidenceIds: revalidation.evidenceDigests,
            ...(signal ? { signal } : {}),
          });
        }
      }
    }
    const evaluated = await this.assessChangePlanning(state, lifecycle, 'open', signal);
    if (evaluated.observationUnavailable) {
      return this.openObservationUnavailable(
        state.runId,
        evaluated.observationUnavailable,
        'planning-gate',
      );
    }
    const assessment = evaluated.assessment;
    if (assessment.approval?.status === 'changes_requested') {
      const skills = await this.resolveLifecycleWorkSkills(
        'change.intake',
        signal,
        [],
        state.runId,
      );
      const revisionWork = createLifecyclePhaseWork({
        runId: state.runId,
        checkEpoch: lifecycle.checkEpoch + 1,
        changeId: lifecycle.identity.changeId,
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'change.intake',
        actionSkill: skills.actionSkill,
        augmentationSkills: skills.augmentationSkills,
        skillComposition: skills.skillComposition,
        compositionDigest: state.composition.compositionDigest,
        projectSnapshotDigest: state.projectSnapshotDigest,
        projectConfigDigest: evaluated.projectConfigDigest,
        workspaceRepositoryId: evaluated.workspaceRepositoryId,
        repositoryIds: evaluated.projectSnapshot.repositories.map((repository) => repository.id),
      });
      for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
        await this.coordinator.bindSkill(state.runId, skill);
      }
      await this.ctx.workExecutionAuthority.recordCurrentSkillCorrection(
        state.runId,
        'changes-requested',
        `open-approval:${assessment.approval.snapshot.digest}`,
      );
      const revised = await this.coordinator.acceptChangeObservation(state.runId, {
        kind: 'open-work-ready',
        work: revisionWork,
      });
      await this.ctx.workExecutionAuthority.recordWorkCreated(state.runId, revisionWork);
      return { ...revised, value: await this.coordinator.status(state.runId) };
    }
    if (assessment.status === 'blocked' && !assessment.observation) {
      return this.openObservationUnavailable(
        state.runId,
        new Error(assessment.reason),
        'planning-gate',
      );
    }
    if (
      state.status === 'waiting' &&
      lifecycle.waitCondition?.kind === 'human-decision' &&
      assessment.status !== 'approved'
    ) {
      return this.dispatchOpenRepair({
        state,
        lifecycle,
        source: 'approval-drift',
        reasonCode: 'approval-drift',
        evidenceIds: assessment.evidenceDigests,
        ...(signal ? { signal } : {}),
      });
    }
    if (assessment.status === 'blocked') {
      const strictInvalid =
        assessment.validation && (!assessment.validation.strict || !assessment.validation.valid);
      return this.dispatchOpenRepair({
        state,
        lifecycle,
        source: strictInvalid ? 'strict-validation' : 'provider-artifacts',
        reasonCode: strictInvalid ? 'strict-validation-invalid' : 'provider-artifacts-invalid',
        evidenceIds: assessment.evidenceDigests,
        ...(signal ? { signal } : {}),
      });
    }
    const inputDigest =
      assessment.snapshot?.digest ??
      assessment.validation?.validationDigest ??
      (`sha256:${createHash('sha256')
        .update(canonicalJson({ phase: 'open', reason: assessment.reason }))
        .digest('hex')}` as const);
    let designWork: WorkDescriptor | undefined;
    if (assessment.status === 'approved') {
      const skills = await this.resolveLifecycleWorkSkills(
        'specification.plan',
        signal,
        [],
        state.runId,
      );
      designWork = createLifecyclePhaseWork({
        runId: state.runId,
        checkEpoch: lifecycle.checkEpoch + 1,
        changeId: lifecycle.identity.changeId,
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'specification.plan',
        actionSkill: skills.actionSkill,
        augmentationSkills: skills.augmentationSkills,
        skillComposition: skills.skillComposition,
        compositionDigest: state.composition.compositionDigest,
        projectSnapshotDigest: state.projectSnapshotDigest,
        projectConfigDigest: evaluated.projectConfigDigest,
        workspaceRepositoryId: evaluated.workspaceRepositoryId,
        repositoryIds: evaluated.projectSnapshot.repositories.map((repository) => repository.id),
      });
      for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
        await this.coordinator.bindSkill(state.runId, skill);
      }
      if (assessment.validation) {
        await this.coordinator.bindSpecification(state.runId, {
          schemaVersion: 1,
          changeId: assessment.validation.changeId,
          provider: structuredClone(assessment.validation.provider),
          validationDigest: assessment.validation.validationDigest,
        });
      }
    }
    const advanced = await this.coordinator.acceptChangeObservation(state.runId, {
      kind: 'open-gate',
      result: assessment.status,
      reason: assessment.reason,
      evidenceIds: assessment.evidenceDigests,
      inputDigest,
      ...(assessment.status === 'waiting' && assessment.approval
        ? {
            requestId: assessment.approval.decisionRequest.requestId,
            proposalDigest: assessment.approval.decisionRequest.proposalHash,
          }
        : {}),
      ...(designWork ? { work: designWork } : {}),
    });
    if (designWork)
      await this.ctx.workExecutionAuthority.recordWorkCreated(state.runId, designWork);
    return { ...advanced, value: await this.coordinator.status(state.runId) };
  }

  async next(
    runId: string,
    confirmations: ReadonlySet<string> = new Set(),
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    await this.coordinator.recoverChangeLifecycleDefinition(runId);
    await this.ctx.workExecutionAuthority.reconcileCurrentCheckpoint(runId);
    const preflight = await this.ctx.runStore.loadRun(runId);
    const preflightLifecycle = preflight.changeLifecycle;
    if (
      preflightLifecycle?.phase === 'verify' &&
      preflightLifecycle.currentWork &&
      preflight.workExecution?.workId === preflightLifecycle.currentWork.workId &&
      preflight.workExecution.checkEpoch === preflightLifecycle.checkEpoch &&
      (preflight.workExecution?.status === 'outcome' ||
        preflight.workExecution?.status === 'validated') &&
      preflight.workExecution.actionOutcome?.status === 'succeeded'
    ) {
      const verified = await this.verifyChange({ runId }, signal);
      const continuation = await this.ctx.workExecutionAuthority.recovery(runId);
      await this.ctx.workExecutionAuthority.recordContinuation(runId, continuation);
      return {
        diagnostics: verified.diagnostics,
        value: await this.coordinator.status(runId),
      };
    }
    const beforeNext = await this.ctx.runStore.loadRun(runId);
    const result: RuntimeResult<RunStatusView> = await this.operations.run(
      { cancellable: false, signal },
      async () => {
        const state = await this.ctx.runStore.loadRun(runId);
        if (state.changeLifecycle) {
          const work = state.changeLifecycle.currentWork;
          const execution = state.workExecution;
          if (
            work &&
            execution?.workId === work.workId &&
            execution.status === 'submitted' &&
            execution.pendingSubmission?.outcome.status === 'failed'
          ) {
            const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
            await this.ctx.workDispatcher.acceptOutcome(
              this.ctx.workDispatcher.outcome(
                intent,
                'failed',
                execution.pendingSubmission.outcome.summary,
              ),
            );
            return {
              value: await this.coordinator.status(runId),
              diagnostics: [
                {
                  level: 'warning',
                  code: 'change.work-failure-accepted',
                  message: `Accepted the failed ${work.kind} submission for Runtime recovery`,
                },
              ],
            };
          }
          const designFinding = execution?.hostOutcome?.findings?.find(
            (finding) =>
              finding.kind === 'design_assumption_invalid' ||
              finding.kind === 'planning_semantics_changed',
          );
          if (
            state.changeLifecycle.phase === 'build' &&
            work &&
            execution?.workId === work.workId &&
            execution.actionOutcome?.status === 'failed' &&
            designFinding
          ) {
            const proposalDigest = `sha256:${createHash('sha256')
              .update(
                canonicalJson({
                  kind: designFinding.kind,
                  runId,
                  workId: work.workId,
                  checkEpoch: work.checkEpoch,
                  taskIds: designFinding.taskIds ?? [],
                  requirementIds: designFinding.requirementIds ?? [],
                }),
              )
              .digest('hex')}` as const;
            const requested = await this.coordinator.acceptChangeObservation(runId, {
              kind: 'build-design-revision-required',
              requestId: `build-design:${proposalDigest.slice(-24)}`,
              proposalDigest,
              reason: designFinding.summary,
              evidenceIds: [execution.receiptId ?? work.inputDigest],
            });
            return { ...requested, value: await this.coordinator.status(runId) };
          }
          if (
            state.changeLifecycle.phase === 'build' &&
            work &&
            execution?.workId === work.workId &&
            execution.status === 'outcome' &&
            execution.actionOutcome?.status === 'failed' &&
            execution.attempt >= 3
          ) {
            const exhausted = await this.coordinator.acceptChangeObservation(runId, {
              kind: 'build-retry-exhausted',
              workId: work.workId,
              attempt: execution.attempt,
              reason: `Build Work failed ${execution.attempt} bounded attempts`,
            });
            return { ...exhausted, value: await this.coordinator.status(runId) };
          }
          const classifiedContinuation = work
            ? classifyWorkContinuation({
                runStatus: state.status,
                lifecycle: state.changeLifecycle,
                ...(execution ? { execution } : {}),
              })
            : undefined;
          const dispatchable =
            work &&
            this.ctx.workExecutionHosts.snapshot().hosts.length > 0 &&
            classifiedContinuation?.continuation === 'execute' &&
            [
              'work-unclaimed',
              'checkpoint-superseded',
              'claim-redelivery',
              'host-not-executed',
              'work-failed',
            ].includes(classifiedContinuation.reason);
          if (dispatchable) {
            const lifecycle = state.changeLifecycle;
            const protocol = lifecycle.buildProtocol;
            if (
              lifecycle.phase === 'build' &&
              work.kind !== 'build.configure' &&
              protocol?.binding
            ) {
              const base = await this.loadChangePlanningBase(state, lifecycle, 'design');
              const workspaceDrift = await this.executionWorkspaceDrift(
                state,
                lifecycle,
                base.projectSnapshot,
                protocol.binding,
              );
              if (workspaceDrift) {
                return this.dispatchExecutionBindingRevalidation({
                  state,
                  lifecycle,
                  projectSnapshot: base.projectSnapshot,
                  projectConfigDigest: base.projectConfigDigest,
                  workspaceRepositoryId: base.workspaceRepositoryId,
                  reasonCode: workspaceDrift,
                  ...(signal ? { signal } : {}),
                });
              }
            }
            const adapter =
              work.kind === 'delivery.publish'
                ? 'git'
                : work.capabilities.includes('process.execute')
                  ? 'process'
                  : work.capabilities.includes('specification.write')
                    ? 'specification'
                    : 'manual';
            const dispatched = await this.ctx.managedWorkExecutor.execute({
              runId,
              adapter,
              ...(execution?.workId === work.workId ? { attempt: execution.attempt + 1 } : {}),
              executor: {
                actorId: 'repoctopus-runtime',
                runnerId: `runtime:${runId}`,
                source: 'runner',
                authenticated: true,
              },
            });
            if (!dispatched.executionAcquired) {
              return {
                value: await this.coordinator.status(runId),
                diagnostics: [
                  {
                    level: 'info',
                    code: 'change.work-host-already-invoking',
                    message:
                      'Another Runner owns the persisted Host invocation; this pull did not execute the Host',
                  },
                ],
              };
            }
            return {
              value: await this.coordinator.status(runId),
              diagnostics: [
                {
                  level: 'info',
                  code: 'change.work-host-completed',
                  message: `Managed Host completed ${work.kind}; Runtime validation is next`,
                },
              ],
            };
          }
          const diagnostics: RuntimeDiagnostic[] = [];
          const current = state;
          if (state.changeLifecycle.phase === 'open') {
            if (!state.changeLifecycle.currentWork) {
              const wait = state.changeLifecycle.waitCondition;
              if (
                state.status === 'waiting' &&
                wait?.kind === 'human-decision' &&
                wait.waitId.startsWith('workspace-intent:')
              ) {
                return {
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    {
                      level: 'info',
                      code: 'change.workspace-intent-decision-pending',
                      message:
                        'Workspace intent revision is waiting for its trusted Human Decision',
                    },
                  ],
                };
              }
              return this.advanceOpenGate(state, signal);
            }
            if (
              state.workExecution?.status === 'outcome' &&
              state.workExecution.actionOutcome?.status === 'succeeded'
            ) {
              return this.validateOpenWork(state, signal);
            }
            const continuation = classifyWorkContinuation({
              runStatus: state.status,
              lifecycle: state.changeLifecycle,
              ...(state.workExecution ? { execution: state.workExecution } : {}),
            });
            if (
              continuation.continuation === 'reobserve' &&
              continuation.reason === 'open-gate-pending'
            ) {
              return this.advanceOpenGate(state, signal);
            }
            return {
              value: await this.coordinator.status(runId),
              diagnostics: [
                {
                  level: 'info',
                  code: 'change.work-execute',
                  message: 'Execute the Runtime-selected Open intake Work',
                },
              ],
            };
          }
          const lifecycle = current.changeLifecycle;
          if (!lifecycle) throw new Error(`Run is not a Change Run: ${runId}`);
          if (lifecycle.phase === 'archive') {
            return {
              value: await this.coordinator.status(runId),
              diagnostics: [
                {
                  level: 'info',
                  code: 'change.archive-input-required',
                  message: 'Archive requires the frozen Delivery intent and publication policy',
                },
              ],
            };
          }
          if (!['design', 'build', 'verify'].includes(lifecycle.phase)) {
            throw new Error('Change Run next Work is unavailable for the current lifecycle phase');
          }
          let build:
            | {
                tasks: SpecificationTask[];
                work: WorkDescriptor;
                protocol: ReturnType<typeof createBuildProtocolState>;
              }
            | undefined;
          const evaluated =
            lifecycle.phase === 'design'
              ? await this.assessChangePlanning(current, lifecycle, 'design', signal)
              : await (async () => {
                  const observed = await this.observeChangePlanning(current, lifecycle, signal);
                  if (observed.status === 'invalid') {
                    return this.returnToDesignForPlanningRevision(
                      current,
                      lifecycle,
                      observed,
                      observed.projectSnapshot,
                      observed.projectConfigDigest,
                      observed.workspaceRepositoryId,
                      signal,
                    );
                  }
                  return {
                    assessment: {
                      status: 'approved' as const,
                      reason: observed.reason,
                      evidenceDigests: observed.evidenceDigests,
                    } as DesignGateAssessment,
                    projectSnapshot: observed.projectSnapshot,
                    projectConfigDigest: observed.projectConfigDigest,
                    workspaceRepositoryId: observed.workspaceRepositoryId,
                  };
                })();
          if ('value' in evaluated) return evaluated;
          let assessment = evaluated.assessment;
          const { projectSnapshot, projectConfigDigest, workspaceRepositoryId } = evaluated;
          const legacyBuildProtocol = lifecycle.buildProtocol;
          if (
            lifecycle.phase === 'build' &&
            legacyBuildProtocol?.binding &&
            executionBindingRequiresMigration(legacyBuildProtocol.binding)
          ) {
            const reason =
              'Pre-release Execution Binding schema is not compatible with Work-scoped Host capabilities';
            const migrated = await this.coordinator.acceptChangeObservation(runId, {
              kind: 'work-execution-migration-required',
              reason,
              evidenceIds: [legacyBuildProtocol.binding.bindingId],
            });
            return {
              ...migrated,
              value: await this.coordinator.status(runId),
              diagnostics: [
                ...migrated.diagnostics,
                {
                  level: 'error' as const,
                  code: 'change.execution-binding-migration-required',
                  message: reason,
                },
              ],
            };
          }
          if (
            lifecycle.phase === 'build' &&
            legacyBuildProtocol?.workspaceCheckpoint === undefined &&
            legacyBuildProtocol?.binding
          ) {
            return this.dispatchExecutionBindingRevalidation({
              state: current,
              lifecycle,
              projectSnapshot,
              projectConfigDigest,
              workspaceRepositoryId,
              reasonCode: 'checkpoint-migration',
              ...(signal ? { signal } : {}),
            });
          }
          if (
            lifecycle.phase === 'design' &&
            lifecycle.currentWork === null &&
            assessment.approval?.status === 'changes_requested'
          ) {
            await this.ctx.workExecutionAuthority.recordCurrentSkillCorrection(
              runId,
              'changes-requested',
              `design-approval:${assessment.approval.snapshot.digest}`,
            );
            return this.createDesignWork(current, signal);
          }
          if (lifecycle.phase === 'build' || lifecycle.phase === 'verify') {
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.plan' &&
              lifecycle.buildProtocol?.binding &&
              current.workExecution?.status === 'invoking' &&
              current.workExecution.continuation === 'awaiting-correction'
            ) {
              const authorization = await this.authorizedProtectedBranchRebind(
                current,
                lifecycle,
                projectSnapshot,
              );
              if (authorization) {
                return this.dispatchExecutionBindingRevalidation({
                  state: current,
                  lifecycle,
                  projectSnapshot,
                  projectConfigDigest,
                  workspaceRepositoryId,
                  reasonCode: 'protected-branch-correction',
                  authorizedRebind: { entrypoint: 'next', evidence: authorization },
                  ...(signal ? { signal } : {}),
                });
              }
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.plan' &&
              current.workExecution?.status === 'outcome' &&
              !current.workExecution.acceptedSubmission
            ) {
              const reason =
                'Pre-release Build Plan checkpoint has no accepted submission and requires migration';
              const migrated = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'work-execution-migration-required',
                reason,
                evidenceIds: current.workExecution.actionOutcome?.outcomeId
                  ? [current.workExecution.actionOutcome.outcomeId]
                  : [],
              });
              return {
                ...migrated,
                value: await this.coordinator.status(runId),
                diagnostics: [
                  ...migrated.diagnostics,
                  {
                    level: 'error' as const,
                    code: 'change.build-plan-migration-required',
                    message: reason,
                  },
                ],
              };
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork === null &&
              lifecycle.buildProtocol?.currentAction === 'configure'
            ) {
              const skills = await this.resolveLifecycleWorkSkills(
                'build.configure',
                signal,
                [],
                runId,
              );
              const work = createBuildActionWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: 'build.configure',
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                skillComposition: skills.skillComposition,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                strategyId: lifecycle.buildProtocol.strategy.strategyId,
                executionMode: lifecycle.buildProtocol.strategy.executionMode,
                tddMode: lifecycle.buildProtocol.strategy.tddMode,
                stableInput: {
                  reason: 'compatible-definition-recovery',
                  actionAttempt: lifecycle.buildProtocol.actionAttempt + 1,
                },
              });
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const restored = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-binding-retry-required',
                reason: 'Compatible lifecycle recovery restored interrupted Configure Work',
                work,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, work);
              return {
                ...restored,
                value: await this.coordinator.status(runId),
                diagnostics: [
                  ...restored.diagnostics,
                  {
                    level: 'warning',
                    code: 'change.build-binding-work-restored',
                    message: 'Compatible lifecycle recovery restored interrupted Configure Work',
                  },
                ],
              };
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork === null &&
              lifecycle.buildProtocol?.currentAction === 'plan' &&
              lifecycle.buildProtocol.binding
            ) {
              const strategy = lifecycle.buildProtocol.strategy;
              const binding = lifecycle.buildProtocol.binding;
              const skills = await this.resolveLifecycleWorkSkills('build.plan', signal, [], runId);
              const work = createBuildActionWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: 'build.plan',
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                skillComposition: skills.skillComposition,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                strategyId: strategy.strategyId,
                bindingId: binding.bindingId,
                executionMode: strategy.executionMode,
                tddMode: strategy.tddMode,
                stableInput: {
                  reason: 'compatible-definition-recovery',
                  actionAttempt: lifecycle.buildProtocol.actionAttempt + 1,
                },
              });
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const restored = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-plan-retry-required',
                reason: 'Compatible lifecycle recovery restored interrupted Plan Work',
                work,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, work);
              return {
                ...restored,
                value: await this.coordinator.status(runId),
                diagnostics: [
                  ...restored.diagnostics,
                  {
                    level: 'warning',
                    code: 'change.build-plan-work-restored',
                    message: 'Compatible lifecycle recovery restored interrupted Plan Work',
                  },
                ],
              };
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork === null &&
              lifecycle.verificationInvalidation &&
              (lifecycle.tasks ?? []).every((task) => task.status === 'completed')
            ) {
              const profileId = current.trigger?.facts.verificationProfileId;
              if (typeof profileId !== 'string' || !profileId.trim()) {
                throw new Error('Verification Evidence Profile identity is missing');
              }
              const refreshed = await this.ctx.evidenceCoordinator.plan(profileId);
              if (
                refreshed.fingerprint.digest ===
                lifecycle.verificationInvalidation.evidenceInputFingerprint
              ) {
                return {
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    ...diagnostics,
                    {
                      level: 'warning',
                      code: 'change.verify-repair-required',
                      message: lifecycle.verificationInvalidation.reason,
                    },
                  ],
                };
              }
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.configure' &&
              current.workExecution?.status === 'outcome' &&
              current.workExecution.actionOutcome?.status === 'succeeded'
            ) {
              const hostOutcome = current.workExecution.hostOutcome;
              if (!hostOutcome) throw new Error('Build Configure Host Outcome is missing');
              const bindingCandidate = hostOutcome.result;
              if (bindingCandidate?.kind !== 'execution-binding-candidate') {
                const projectConfigDigest = current.trigger?.facts.projectConfigDigest;
                const specificationRoot = current.trigger?.facts.specificationRoot as
                  | { repositoryId?: unknown }
                  | undefined;
                if (
                  typeof projectConfigDigest !== 'string' ||
                  !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
                  typeof specificationRoot?.repositoryId !== 'string'
                ) {
                  throw new Error('Build Configure retry trigger identities are missing');
                }
                const skills = await this.resolveLifecycleWorkSkills(
                  'build.configure',
                  signal,
                  [],
                  runId,
                );
                const retryWork = createBuildActionWork({
                  runId,
                  checkEpoch: lifecycle.checkEpoch + 1,
                  definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                  kind: 'build.configure',
                  actionSkill: skills.actionSkill,
                  augmentationSkills: skills.augmentationSkills,
                  skillComposition: skills.skillComposition,
                  compositionDigest: current.composition.compositionDigest,
                  projectConfigDigest: projectConfigDigest as `sha256:${string}`,
                  projectSnapshotDigest: current.projectSnapshotDigest,
                  workspaceRepositoryId: specificationRoot.repositoryId,
                  repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                  strategyId: lifecycle.buildProtocol!.strategy.strategyId,
                  executionMode: lifecycle.buildProtocol!.strategy.executionMode,
                  tddMode: lifecycle.buildProtocol!.strategy.tddMode,
                  stableInput: {
                    reason: 'execution-binding-output-invalid',
                    priorWorkId: lifecycle.currentWork.workId,
                  },
                });
                for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
                const retried = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'build-binding-retry-required',
                  reason:
                    'Build Configure Host did not return a structured execution-binding-candidate',
                  work: retryWork,
                });
                await this.ctx.workExecutionAuthority.recordWorkCreated(runId, retryWork);
                return {
                  ...retried,
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    ...retried.diagnostics,
                    {
                      level: 'warning',
                      code: 'change.build-binding-outcome-rejected',
                      message:
                        'Build Configure will retry because the prior Host Outcome was incomplete',
                    },
                  ],
                };
              }
              const invocationHost = current.workExecution.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== hostOutcome.hostId) {
                throw new Error('Build Configure Host does not match the persisted invocation');
              }
              if (!lifecycle.workspaceIntent || !lifecycle.buildProtocol) {
                throw new Error('Build Configure requires the approved Workspace intent');
              }
              const strategy = lifecycle.buildProtocol.strategy;
              if (bindingCandidate.strategyDigest !== strategy.semanticDigest) {
                throw new Error('Build Configure candidate does not bind the approved Strategy');
              }
              let binding: ExecutionWorkspaceBinding;
              try {
                binding = await this.bindExecutionWorkspace(current, lifecycle, projectSnapshot);
              } catch (error) {
                if (
                  !(error instanceof ExecutionWorkspaceBindingError) ||
                  error.recovery !== 'intent-revision'
                ) {
                  throw error;
                }
                const proposalDigest = `sha256:${createHash('sha256')
                  .update(
                    canonicalJson({
                      schemaVersion: 1,
                      runId,
                      lifecycleRevision: lifecycle.revision,
                      checkEpoch: lifecycle.checkEpoch,
                      workId: lifecycle.currentWork.workId,
                      workspaceIntentDigest: lifecycle.workspaceIntent.semanticDigest,
                      errorCode: error.code,
                    }),
                  )
                  .digest('hex')}` as const;
                const requestId = `workspace-intent-revision:${proposalDigest.slice(-24)}`;
                const reason = `Execution Workspace binding requires isolation revision (${error.code})`;
                const revised = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'workspace-intent-revision-required',
                  requestId,
                  proposalDigest,
                  reason,
                  evidenceIds: [`execution-workspace-binding:${error.code}`],
                  errorCode: error.code,
                  previousIsolation: lifecycle.workspaceIntent.isolation,
                });
                await this.ctx.workExecutionAuthority.recordWaitBoundary({
                  runId,
                  waitId: `workspace-intent:${requestId}`,
                  stage: 'started',
                  kind: 'human-decision',
                  reason,
                });
                return {
                  ...revised,
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    ...revised.diagnostics,
                    {
                      level: 'warning',
                      code: 'change.workspace-intent-revision-required',
                      message: reason,
                    },
                  ],
                };
              }
              const executionBinding = createExecutionBinding({
                strategy,
                revision: lifecycle.buildProtocol.bindingHistory.length + 1,
                coordinatorHostId: invocationHost.id,
                workspaceBinding: binding,
                workspaceOwnerId: lifecycle.workspaceIntent.workspaceId,
                localOverlayRef: `execution-workspace:${binding.localDigest.slice(-24)}`,
              });
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              const validation = await validator.validate({
                profileId: lifecycle.currentWork.validatorProfile.id,
                work: lifecycle.currentWork,
                fact: executionBinding,
              });
              if (!validation.accepted) {
                throw new Error(`Build Configure Validator rejected: ${validation.diagnostic}`);
              }
              await this.ctx.workExecutionAuthority.markValidated({
                intent: await this.ctx.workExecutionAuthority.loadIntent(runId),
                validatorId: lifecycle.currentWork.validatorProfile.id,
                continuation: 'execute',
              });
              const planSkills = await this.resolveLifecycleWorkSkills(
                'build.plan',
                signal,
                [],
                runId,
              );
              const planWork = createBuildActionWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: 'build.plan',
                actionSkill: planSkills.actionSkill,
                augmentationSkills: planSkills.augmentationSkills,
                skillComposition: planSkills.skillComposition,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                strategyId: strategy.strategyId,
                bindingId: executionBinding.bindingId,
                executionMode: strategy.executionMode,
                tddMode: strategy.tddMode,
                stableInput: {
                  strategyDigest: strategy.semanticDigest,
                  bindingStateDigest: executionBinding.stateDigest,
                  planningDigest: lifecycle.planningDigest,
                },
              });
              for (const skill of [planSkills.actionSkill, ...planSkills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const accepted = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-binding-accepted',
                binding: executionBinding,
                work: planWork,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, planWork);
              return { ...accepted, value: await this.coordinator.status(runId) };
            }
            const planExecution = current.workExecution;
            const planHostOutcome =
              planExecution?.status === 'submitted'
                ? planExecution.pendingSubmission?.outcome
                : planExecution?.status === 'validated' &&
                    planExecution.validatorId === lifecycle.currentWork?.validatorProfile.id &&
                    planExecution.actionOutcome?.status === 'succeeded' &&
                    planExecution.receiptId
                  ? planExecution.acceptedSubmission?.outcome
                  : undefined;
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.plan' &&
              planHostOutcome?.status === 'succeeded'
            ) {
              const protocol = lifecycle.buildProtocol;
              const strategy = protocol?.strategy;
              const binding = protocol?.binding;
              const hostOutcome = planHostOutcome;
              const result = hostOutcome?.result;
              if (!protocol || !strategy || !binding || protocol.currentAction !== 'plan') {
                throw new Error('Build Plan Outcome has no current Strategy and Binding');
              }
              const invocationHost = planExecution?.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== hostOutcome.hostId) {
                throw new Error('Build Plan Host does not match the persisted invocation');
              }
              const bindingDrift = await this.executionBindingDrift(
                current,
                lifecycle,
                projectSnapshot,
                binding,
                invocationHost,
              );
              if (bindingDrift) {
                return this.dispatchExecutionBindingRevalidation({
                  state: current,
                  lifecycle,
                  projectSnapshot,
                  projectConfigDigest,
                  workspaceRepositoryId,
                  reasonCode: bindingDrift,
                  ...(signal ? { signal } : {}),
                });
              }
              const rejectSubmission = async (
                reasonCode: 'output-invalid' | 'outcome-rejected' | 'outcome-processing-error',
                diagnostic: string,
                diagnosticCode?: string,
              ) => {
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                await this.ctx.workExecutionAuthority.rejectHostSubmission({
                  intent,
                  reasonCode,
                  diagnostic,
                });
                return {
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    {
                      level: 'warning' as const,
                      code:
                        reasonCode === 'outcome-processing-error'
                          ? 'change.build-plan-outcome-processing-error'
                          : (diagnosticCode ?? 'change.build-plan-outcome-rejected'),
                      message: diagnostic,
                    },
                  ],
                };
              };
              if (result?.kind !== 'build-plan-candidate') {
                return rejectSubmission(
                  'output-invalid',
                  'Build Plan Host must return a structured build-plan-candidate',
                );
              }
              let taskSet;
              try {
                taskSet = await this.ctx.specification.tasks(lifecycle.identity.changeId, signal);
              } catch (error) {
                return rejectSubmission(
                  'outcome-processing-error',
                  `Build Plan Task authority failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              let plan;
              try {
                plan = createBuildPlan({
                  runId,
                  revision: (protocol.plans.at(-1)?.revision ?? 0) + 1,
                  strategy,
                  binding,
                  planningDigest: lifecycle.planningDigest!,
                  tasks: taskSet,
                  candidate: { packages: result.packages },
                });
              } catch (error) {
                return rejectSubmission(
                  'outcome-rejected',
                  `Build Plan candidate rejected: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              const protectedBranches = frozenProtectedBranches(current);
              const planValidation = validateBuildPlan({
                plan,
                strategy,
                binding,
                tasks: taskSet,
                protectedBranches,
              });
              if (!planValidation.accepted) {
                return rejectSubmission(
                  'outcome-rejected',
                  `Build Plan rejected: ${planValidation.diagnostics.join('; ')}`,
                  planValidation.protectedBranchFindings.length > 0
                    ? 'change.build-plan-protected-branch'
                    : undefined,
                );
              }
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              let validation;
              try {
                validation = await validator.validate({
                  profileId: lifecycle.currentWork.validatorProfile.id,
                  work: lifecycle.currentWork,
                  fact: planValidation,
                });
              } catch (error) {
                return rejectSubmission(
                  'outcome-processing-error',
                  `Build Plan Validator failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              if (!validation.accepted) {
                return rejectSubmission(
                  'outcome-rejected',
                  `Build Plan Validator rejected: ${validation.diagnostic}`,
                );
              }
              if (planExecution?.status === 'submitted') {
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                await this.ctx.workDispatcher.acceptOutcome(
                  this.ctx.workDispatcher.outcome(intent, 'succeeded', hostOutcome.summary),
                );
                await this.ctx.workExecutionAuthority.markValidated({
                  intent,
                  validatorId: lifecycle.currentWork.validatorProfile.id,
                  continuation: 'execute',
                });
              }
              if (!protocol.workspaceCheckpoint) {
                throw new Error('Build Plan requires a Runtime-owned workspace checkpoint');
              }
              const planWorkspaceCheckpoint = await this.advanceBuildWorkspaceProgress(
                current,
                lifecycle,
                projectSnapshot,
                protocol.workspaceCheckpoint,
                [workspaceRepositoryId],
              );
              const planned = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-plan-accepted',
                plan,
                workspaceCheckpoint: planWorkspaceCheckpoint,
              });
              const evidence = createPlanEvidence({
                plan,
                strategy,
                binding,
                validation: planValidation,
                protectedBranches,
                compositionCheckpointDigest: current.composition.compositionDigest,
                reportOwnerId: lifecycle.identity.workspaceId,
              });
              if (
                evidence.risk.level === 'high' &&
                !protocol.approvedRiskDigests.includes(evidence.riskDecisionDigest)
              ) {
                const requestId = `plan:${evidence.riskDecisionDigest.slice(-24)}`;
                const awaiting = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'build-plan-approval-required',
                  evidence,
                  requestId,
                  reason: `Approve high-risk Build Plan: ${evidence.risk.reasons.join(', ')}`,
                });
                return { ...awaiting, value: await this.coordinator.status(runId) };
              }
              const retainedCompletions =
                planned.value.state.changeLifecycle?.buildProtocol?.packageCompletions ?? [];
              const workspaceCheckpoint =
                planned.value.state.changeLifecycle?.buildProtocol?.workspaceCheckpoint;
              if (!workspaceCheckpoint) {
                throw new Error('Build Plan requires a Runtime-owned workspace checkpoint');
              }
              const completedPackageIds = new Set(
                retainedCompletions.map((completion) => completion.packageId),
              );
              const nextPackage = plan.packages.find(
                (candidate) =>
                  !completedPackageIds.has(candidate.packageId) &&
                  candidate.dependsOn.every((dependency) => completedPackageIds.has(dependency)),
              );
              const nextKind = nextPackage ? 'build.execute' : 'build.check';
              if (!nextPackage && completedPackageIds.size !== plan.packages.length) {
                throw new Error('Build Plan revision has no executable Work Package');
              }
              const composition = buildActionSkillComposition({
                action: nextPackage ? 'execute' : 'check',
                tddMode: strategy.tddMode,
              });
              const skills = await this.resolveLifecycleWorkSkills(
                nextKind,
                signal,
                composition.augmentationSkills,
                runId,
              );
              const nextWork = createBuildActionWork({
                runId,
                checkEpoch: planned.value.state.changeLifecycle!.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: nextKind,
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                skillComposition: skills.skillComposition,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                strategyId: strategy.strategyId,
                bindingId: binding.bindingId,
                executionMode: strategy.executionMode,
                tddMode: strategy.tddMode,
                planId: plan.planId,
                planRevision: plan.revision,
                ...(nextPackage
                  ? {
                      packageId: nextPackage.packageId,
                      writeScopes: nextPackage.writeScopes,
                    }
                  : {}),
                stableInput: {
                  strategyDigest: strategy.semanticDigest,
                  bindingStateDigest: binding.stateDigest,
                  workspaceCheckpointDigest: workspaceCheckpoint.digest,
                  planDigest: plan.digest,
                  ...(nextPackage ? { packageDigest: nextPackage.digest } : {}),
                  planEvidenceId: evidence.evidenceId,
                  completedPackageIds: [...completedPackageIds].sort(),
                },
              });
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const evidenced = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-plan-evidence-accepted',
                evidence,
                work: nextWork,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, nextWork);
              return { ...evidenced, value: await this.coordinator.status(runId) };
            }
            const executeExecution = current.workExecution;
            const executeExecutionIsCurrent =
              executeExecution !== undefined &&
              executeExecution.workId === lifecycle.currentWork?.workId &&
              executeExecution.checkEpoch === lifecycle.currentWork?.checkEpoch;
            const executeHostOutcome =
              !executeExecution || !executeExecutionIsCurrent
                ? undefined
                : executeExecution.status === 'submitted'
                  ? executeExecution.pendingSubmission?.outcome
                  : executeExecution.status === 'validated' &&
                      executeExecution.validatorId === lifecycle.currentWork?.validatorProfile.id &&
                      executeExecution.actionOutcome?.status === 'succeeded' &&
                      executeExecution.receiptId
                    ? executeExecution.acceptedSubmission?.outcome
                    : executeExecution.status === 'outcome' &&
                        executeExecution.actionOutcome?.status === 'succeeded'
                      ? executeExecution.hostOutcome
                      : undefined;
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.execute' &&
              executeHostOutcome?.status === 'succeeded'
            ) {
              const protocol = lifecycle.buildProtocol;
              const strategy = protocol?.strategy;
              const binding = protocol?.binding;
              const plan = protocol?.plan;
              const result = executeHostOutcome.result;
              const invocationId = executeHostOutcome.invocationId;
              if (!protocol || !strategy || !binding || !plan || !invocationId) {
                throw new Error('Build Execute Outcome has no current Plan');
              }
              const invocationHost = executeExecution?.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== executeHostOutcome.hostId) {
                throw new Error('Build Execute Host does not match the persisted invocation');
              }
              if (
                result?.kind !== 'build-package-completion' ||
                result.packageId !== lifecycle.currentWork.packageId
              ) {
                throw new Error('Build Execute Host must return the current package completion');
              }
              const workPackage = plan.packages.find(
                (candidate) => candidate.packageId === result.packageId,
              );
              if (!workPackage) throw new Error('Build Execute package is absent from the Plan');
              if (!protocol.workspaceCheckpoint) {
                throw new Error('Build Execute requires a Runtime-owned workspace checkpoint');
              }
              const bindingDrift = await this.executionBindingDrift(
                current,
                lifecycle,
                projectSnapshot,
                binding,
                invocationHost,
              );
              if (bindingDrift) {
                return this.dispatchExecutionBindingRevalidation({
                  state: current,
                  lifecycle,
                  projectSnapshot,
                  projectConfigDigest,
                  workspaceRepositoryId,
                  reasonCode: bindingDrift,
                  ...(signal ? { signal } : {}),
                });
              }
              let workspaceCheckpoint: BuildWorkspaceCheckpoint;
              try {
                workspaceCheckpoint = await this.advanceBuildWorkspaceProgress(
                  current,
                  lifecycle,
                  projectSnapshot,
                  protocol.workspaceCheckpoint,
                  workPackage.writeScopes.map((scope) => scope.repositoryId),
                );
              } catch (error) {
                const progressError =
                  error instanceof BuildWorkspaceProgressError
                    ? error
                    : new BuildWorkspaceProgressError(
                        'Runtime could not observe Build workspace progress',
                        'observation-failed',
                        { cause: error },
                      );
                const reasonCode =
                  progressError.classification === 'unauthorized-head-change'
                    ? ('workspace-unauthorized-change' as const)
                    : progressError.classification === 'non-fast-forward'
                      ? ('workspace-non-fast-forward' as const)
                      : progressError.classification === 'identity-drift'
                        ? ('workspace-identity-drift' as const)
                        : ('workspace-observation-failed' as const);
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                if (executeExecution?.status === 'submitted') {
                  await this.ctx.workExecutionAuthority.rejectHostSubmission({
                    intent,
                    reasonCode,
                    diagnostic: progressError.message,
                  });
                }
                return {
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    {
                      level: 'warning' as const,
                      code: 'change.build-workspace-progress-rejected',
                      message: progressError.message,
                    },
                  ],
                };
              }
              const implementerExecutionIds = (executeHostOutcome.delegationReceipts ?? [])
                .filter(
                  (receipt) => receipt.role === 'implementer' && receipt.status === 'succeeded',
                )
                .map((receipt) => receipt.executionId)
                .sort();
              const implementationExecutionId =
                implementerExecutionIds.length === 0
                  ? invocationId
                  : implementerExecutionIds.length === 1
                    ? implementerExecutionIds[0]!
                    : `subagents:${createHash('sha256')
                        .update(canonicalJson(implementerExecutionIds))
                        .digest('hex')}`;
              const completion = createPackageCompletionEvidence({
                workPackage,
                executionId: implementationExecutionId,
                acceptanceEvidenceIds: result.acceptanceEvidenceIds,
                testEvidenceIds: result.testEvidenceIds,
                tddMode: strategy.tddMode,
                ...(result.tddEvidence ? { tddEvidence: result.tddEvidence } : {}),
                workspaceCheckpointDigest: workspaceCheckpoint.digest,
                implementationDigest: result.implementationDigest,
              });
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              const validation = await validator.validate({
                profileId: lifecycle.currentWork.validatorProfile.id,
                work: lifecycle.currentWork,
                fact: completion,
              });
              if (!validation.accepted) {
                throw new Error(`Build Package Validator rejected: ${validation.diagnostic}`);
              }
              if (executeExecution?.status === 'submitted') {
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                await this.ctx.workDispatcher.acceptOutcome(
                  this.ctx.workDispatcher.outcome(intent, 'succeeded', executeHostOutcome.summary),
                );
              }
              await this.ctx.workExecutionAuthority.markValidated({
                intent: await this.ctx.workExecutionAuthority.loadIntent(runId),
                validatorId: lifecycle.currentWork.validatorProfile.id,
                continuation: 'execute',
              });
              const completedIds = new Set([
                ...protocol.packageCompletions.map((entry) => entry.packageId),
                completion.packageId,
              ]);
              for (const task of lifecycle.tasks ?? []) {
                const required = plan.packages.filter((entry) =>
                  entry.taskIds.includes(task.taskId),
                );
                if (
                  task.status === 'pending' &&
                  required.length > 0 &&
                  required.every((entry) => completedIds.has(entry.packageId))
                ) {
                  await this.ctx.specification.completeTask({
                    changeId: lifecycle.identity.changeId,
                    taskId: task.taskId,
                    taskRevision: task.taskRevision,
                    workId: lifecycle.currentWork.workId,
                    ...(signal ? { signal } : {}),
                  });
                }
              }
              const projectedTasks = await this.ctx.specification.tasks(
                lifecycle.identity.changeId,
                signal,
              );
              const nextPackage = plan.packages.find(
                (candidate) =>
                  !completedIds.has(candidate.packageId) &&
                  candidate.dependsOn.every((dependency) => completedIds.has(dependency)),
              );
              const nextKind = nextPackage ? 'build.execute' : 'build.check';
              if (!nextPackage && completedIds.size !== plan.packages.length) {
                throw new Error('Build Plan has incomplete packages but no ready package');
              }
              const composition = buildActionSkillComposition({
                action: nextPackage ? 'execute' : 'check',
                tddMode: strategy.tddMode,
              });
              const skills = await this.resolveLifecycleWorkSkills(
                nextKind,
                signal,
                composition.augmentationSkills,
                runId,
              );
              const nextWork = createBuildActionWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: nextKind,
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                skillComposition: skills.skillComposition,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                strategyId: strategy.strategyId,
                bindingId: binding.bindingId,
                executionMode: strategy.executionMode,
                tddMode: strategy.tddMode,
                planId: plan.planId,
                planRevision: plan.revision,
                ...(nextPackage
                  ? {
                      packageId: nextPackage.packageId,
                      writeScopes: nextPackage.writeScopes,
                    }
                  : {}),
                stableInput: nextPackage
                  ? {
                      strategyDigest: strategy.semanticDigest,
                      bindingStateDigest: binding.stateDigest,
                      workspaceCheckpointDigest: workspaceCheckpoint.digest,
                      planDigest: plan.digest,
                      packageDigest: nextPackage.digest,
                      completedPackageIds: [...completedIds].sort(),
                    }
                  : {
                      strategyDigest: strategy.semanticDigest,
                      bindingStateDigest: binding.stateDigest,
                      workspaceCheckpointDigest: workspaceCheckpoint.digest,
                      planDigest: plan.digest,
                      completedPackageIds: [...completedIds].sort(),
                    },
              });
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const completed = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-package-completed',
                completion,
                workspaceCheckpoint,
                work: nextWork,
                tasks: projectedTasks.tasks,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, nextWork);
              return { ...completed, value: await this.coordinator.status(runId) };
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.check' &&
              current.workExecution?.status === 'outcome' &&
              !current.workExecution.acceptedSubmission
            ) {
              const reason =
                'Pre-release Build Check checkpoint has no accepted submission and requires migration';
              const migrated = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'work-execution-migration-required',
                reason,
                evidenceIds: current.workExecution.actionOutcome?.outcomeId
                  ? [current.workExecution.actionOutcome.outcomeId]
                  : [],
              });
              return {
                ...migrated,
                value: await this.coordinator.status(runId),
                diagnostics: [
                  ...migrated.diagnostics,
                  {
                    level: 'error' as const,
                    code: 'change.build-check-migration-required',
                    message: reason,
                  },
                ],
              };
            }
            const checkExecution = current.workExecution;
            const checkHostOutcome =
              checkExecution?.status === 'submitted'
                ? checkExecution.pendingSubmission?.outcome
                : checkExecution?.status === 'validated' &&
                    checkExecution.validatorId === lifecycle.currentWork?.validatorProfile.id &&
                    checkExecution.actionOutcome?.status === 'succeeded' &&
                    checkExecution.receiptId
                  ? checkExecution.acceptedSubmission?.outcome
                  : undefined;
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.check' &&
              checkHostOutcome?.status === 'succeeded'
            ) {
              const protocol = lifecycle.buildProtocol;
              const strategy = protocol?.strategy;
              const binding = protocol?.binding;
              const plan = protocol?.plan;
              const hostOutcome = checkHostOutcome;
              const result = hostOutcome?.result;
              if (
                !protocol ||
                !strategy ||
                !binding ||
                !plan ||
                !hostOutcome ||
                !protocol.workspaceCheckpoint
              ) {
                throw new Error('Build Check Outcome has no current Plan');
              }
              const invocationHost = checkExecution?.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== hostOutcome.hostId) {
                throw new Error('Build Check Host does not match the persisted invocation');
              }
              const bindingDrift = await this.executionBindingDrift(
                current,
                lifecycle,
                projectSnapshot,
                binding,
                invocationHost,
              );
              if (bindingDrift) {
                return this.dispatchExecutionBindingRevalidation({
                  state: current,
                  lifecycle,
                  projectSnapshot,
                  projectConfigDigest,
                  workspaceRepositoryId,
                  reasonCode: bindingDrift,
                  ...(signal ? { signal } : {}),
                });
              }
              try {
                await this.assertBuildWorkspaceCheckpointCurrent(
                  current,
                  lifecycle,
                  projectSnapshot,
                  protocol.workspaceCheckpoint,
                );
              } catch (error) {
                const diagnostic = error instanceof Error ? error.message : String(error);
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                await this.ctx.workExecutionAuthority.rejectHostSubmission({
                  intent,
                  reasonCode: 'outcome-rejected',
                  diagnostic,
                });
                return {
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    {
                      level: 'warning' as const,
                      code: 'change.build-check-workspace-stale',
                      message: diagnostic,
                    },
                  ],
                };
              }
              const rejectSubmission = async (
                reasonCode: 'output-invalid' | 'outcome-rejected' | 'outcome-processing-error',
                diagnostic: string,
              ) => {
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                await this.ctx.workExecutionAuthority.rejectHostSubmission({
                  intent,
                  reasonCode,
                  diagnostic,
                });
                return {
                  value: await this.coordinator.status(runId),
                  diagnostics: [
                    {
                      level: 'warning' as const,
                      code:
                        reasonCode === 'outcome-processing-error'
                          ? 'change.build-check-outcome-processing-error'
                          : 'change.build-check-outcome-rejected',
                      message: diagnostic,
                    },
                  ],
                };
              };
              if (result?.kind !== 'build-check-candidate') {
                return rejectSubmission(
                  'output-invalid',
                  'Build Check Host must return a structured check candidate',
                );
              }
              if (result.reviewerExecutionId !== hostOutcome.invocationId) {
                return rejectSubmission(
                  'outcome-rejected',
                  'Build Check reviewer identity does not match the managed invocation',
                );
              }
              if (
                protocol.packageCompletions.some(
                  (completion) => completion.executionId === result.reviewerExecutionId,
                )
              ) {
                return rejectSubmission(
                  'outcome-rejected',
                  'Standard review requires an independent reviewer execution',
                );
              }
              const expectedPackages = plan.packages.map((entry) => entry.packageId).sort();
              if (
                canonicalJson([...result.completedPackageIds].sort()) !==
                canonicalJson(expectedPackages)
              ) {
                return rejectSubmission(
                  'outcome-rejected',
                  'Build Check does not cover every required package',
                );
              }
              const expectedTasks = [
                ...new Set(plan.packages.flatMap((entry) => entry.taskIds)),
              ].sort();
              if (
                canonicalJson([...result.acceptedTaskIds].sort()) !== canonicalJson(expectedTasks)
              ) {
                return rejectSubmission(
                  'outcome-rejected',
                  'Build Check does not cover every Task acceptance',
                );
              }
              let checkEvidence: ReturnType<typeof createBuildCheckEvidence>;
              try {
                const knownTaskIds = new Set((lifecycle.tasks ?? []).map((task) => task.taskId));
                const knownRequirementRefs = new Set(
                  (lifecycle.tasks ?? []).flatMap((task) => task.requirementRefs),
                );
                const findings = (hostOutcome.findings ?? []).map((finding) => {
                  const classification =
                    finding.kind === 'implementation_failure'
                      ? ('implementation' as const)
                      : finding.kind === 'design_assumption_invalid' ||
                          finding.kind === 'planning_semantics_changed'
                        ? ('planning' as const)
                        : finding.kind === 'evidence_unavailable'
                          ? ('evidence-infrastructure' as const)
                          : ('unknown' as const);
                  const taskIds = [...new Set(finding.taskIds ?? [])].sort();
                  const requirementRefs = [...new Set(finding.requirementIds ?? [])].sort();
                  if (taskIds.some((taskId) => !knownTaskIds.has(taskId))) {
                    throw new Error('Build finding references an unknown Task');
                  }
                  if (
                    requirementRefs.some(
                      (requirementRef) => !knownRequirementRefs.has(requirementRef),
                    )
                  ) {
                    throw new Error('Build finding references an unknown requirement');
                  }
                  const packageIds = plan.packages
                    .filter((entry) => entry.taskIds.some((taskId) => taskIds.includes(taskId)))
                    .map((entry) => entry.packageId)
                    .sort();
                  const findingId = `finding:${createHash('sha256')
                    .update(canonicalJson({ finding, packageIds }))
                    .digest('hex')
                    .slice(0, 24)}`;
                  return {
                    findingId,
                    classification,
                    blocking: true,
                    requirementRefs,
                    taskIds,
                    packageIds,
                    summary: finding.summary,
                  };
                });
                const implementationExecutionId = `implementation:${createHash('sha256')
                  .update(
                    canonicalJson(
                      protocol.packageCompletions.map((entry) => entry.executionId).sort(),
                    ),
                  )
                  .digest('hex')}`;
                checkEvidence = createBuildCheckEvidence({
                  strategyDigest: strategy.semanticDigest,
                  bindingStateDigest: binding.stateDigest,
                  planDigest: plan.digest,
                  workspaceCheckpointDigest: protocol.workspaceCheckpoint.digest,
                  implementationDigest: result.implementationDigest,
                  completedPackageIds: result.completedPackageIds,
                  acceptedTaskIds: result.acceptedTaskIds,
                  testEvidenceIds: result.testEvidenceIds,
                  review: {
                    mode: 'standard',
                    implementationExecutionId,
                    reviewerExecutionId: result.reviewerExecutionId,
                  },
                  findings,
                });
              } catch (error) {
                return rejectSubmission(
                  'outcome-rejected',
                  `Build Check candidate rejected: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              let validation;
              try {
                validation = await validator.validate({
                  profileId: lifecycle.currentWork.validatorProfile.id,
                  work: lifecycle.currentWork,
                  fact: checkEvidence,
                });
              } catch (error) {
                return rejectSubmission(
                  'outcome-processing-error',
                  `Build Check Validator failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              if (!validation.accepted) {
                return rejectSubmission(
                  'outcome-rejected',
                  `Build Check Validator rejected: ${validation.diagnostic}`,
                );
              }
              if (checkExecution?.status === 'submitted') {
                const intent = await this.ctx.workExecutionAuthority.loadIntent(runId);
                await this.ctx.workDispatcher.acceptOutcome(
                  this.ctx.workDispatcher.outcome(intent, 'succeeded', hostOutcome.summary),
                );
                await this.ctx.workExecutionAuthority.markValidated({
                  intent,
                  validatorId: lifecycle.currentWork.validatorProfile.id,
                  continuation: 'execute',
                });
              }
              if (!checkEvidence.accepted) {
                const planningFinding = checkEvidence.findings.find(
                  (finding) => finding.classification === 'planning',
                );
                if (planningFinding) {
                  const proposalDigest = `sha256:${createHash('sha256')
                    .update(canonicalJson({ plan: plan.digest, finding: planningFinding }))
                    .digest('hex')}` as const;
                  const requested = await this.coordinator.acceptChangeObservation(runId, {
                    kind: 'build-design-revision-required',
                    requestId: `build-design:${proposalDigest.slice(-24)}`,
                    proposalDigest,
                    reason: planningFinding.summary,
                    evidenceIds: [checkEvidence.evidenceId],
                  });
                  return { ...requested, value: await this.coordinator.status(runId) };
                }
                const affectedPackageIds = [
                  ...new Set(checkEvidence.findings.flatMap((finding) => finding.packageIds)),
                ];
                const invalidation = createBuildInvalidation({
                  source: 'build-check',
                  plan,
                  classification: checkEvidence.findings[0]?.classification ?? 'unknown',
                  affectedPackageIds:
                    affectedPackageIds.length > 0
                      ? affectedPackageIds
                      : plan.packages.map((workPackage) => workPackage.packageId),
                  packageCompletions: protocol.packageCompletions,
                  reason: checkEvidence.findings.map((finding) => finding.summary).join('; '),
                });
                const planSkills = await this.resolveLifecycleWorkSkills(
                  'build.plan',
                  signal,
                  [],
                  runId,
                );
                const planWork = createBuildActionWork({
                  runId,
                  checkEpoch: lifecycle.checkEpoch + 1,
                  definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                  kind: 'build.plan',
                  actionSkill: planSkills.actionSkill,
                  augmentationSkills: planSkills.augmentationSkills,
                  skillComposition: planSkills.skillComposition,
                  compositionDigest: current.composition.compositionDigest,
                  projectConfigDigest,
                  projectSnapshotDigest: current.projectSnapshotDigest,
                  workspaceRepositoryId,
                  repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                  strategyId: strategy.strategyId,
                  bindingId: binding.bindingId,
                  executionMode: strategy.executionMode,
                  tddMode: strategy.tddMode,
                  planId: plan.planId,
                  planRevision: plan.revision,
                  stableInput: {
                    strategyDigest: strategy.semanticDigest,
                    bindingStateDigest: binding.stateDigest,
                    planDigest: plan.digest,
                    invalidationDigest: invalidation.digest,
                  },
                });
                for (const skill of [planSkills.actionSkill, ...planSkills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
                await this.ctx.workExecutionAuthority.recordCurrentSkillCorrection(
                  runId,
                  'repair-work',
                  `build-check:${checkEvidence.evidenceId}`,
                );
                const revised = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'build-check-rejected',
                  evidence: checkEvidence,
                  invalidation,
                  work: planWork,
                });
                await this.ctx.workExecutionAuthority.recordWorkCreated(runId, planWork);
                return { ...revised, value: await this.coordinator.status(runId) };
              }
              const profileId = current.trigger?.facts.verificationProfileId;
              if (typeof profileId !== 'string' || !profileId.trim()) {
                throw new Error('Verification Evidence Profile identity is missing');
              }
              const evidencePlan = await this.ctx.evidenceCoordinator.plan(profileId);
              const verifySkills = await this.resolveLifecycleWorkSkills(
                'evidence.verify',
                signal,
                [],
                runId,
              );
              const boundSkills = [
                ...(current.skillUsageSnapshots ?? []),
                verifySkills.actionSkill,
                ...verifySkills.augmentationSkills,
              ].filter(
                (skill, index, all) =>
                  all.findIndex(
                    (candidate) =>
                      candidate.name === skill.name && candidate.provider === skill.provider,
                  ) === index,
              );
              const verificationInput = createVerificationInput({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                tasks: lifecycle.tasks ?? [],
                fingerprint: evidencePlan.fingerprint,
                plan: evidencePlan.plan,
                projectConfigDigest,
                compositionDigest: current.composition.compositionDigest,
                skills: boundSkills,
              });
              const verifyWork = createVerifyWork({
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                checkEpoch: lifecycle.checkEpoch + 1,
                verification: verificationInput,
                actionSkill: verifySkills.actionSkill,
                augmentationSkills: verifySkills.augmentationSkills,
                skillComposition: verifySkills.skillComposition,
                workspaceRepositoryId,
                repositoryIds: evidencePlan.fingerprint.manifest.repositories.map(
                  (repository) => repository.repositoryId,
                ),
              });
              for (const skill of [verifySkills.actionSkill, ...verifySkills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const checked = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-check-accepted',
                evidence: checkEvidence,
                verificationInput,
                work: verifyWork,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, verifyWork);
              return { ...checked, value: await this.coordinator.status(runId) };
            }
            if (lifecycle.phase === 'verify' || lifecycle.currentWork) {
              return {
                value: await this.coordinator.status(runId),
                diagnostics: [
                  ...diagnostics,
                  {
                    level: 'info',
                    code: 'change.work-current',
                    message: 'Current lifecycle Work remains valid',
                  },
                ],
              };
            }
          }
          if (assessment.status === 'approved' && assessment.validation) {
            try {
              const approvalHash = assessment.approval?.decision?.approvalHash;
              if (!approvalHash) throw new Error('Approved Design has no approval hash');
              const taskSet = await this.ctx.specification.tasks(
                lifecycle.identity.changeId,
                signal,
              );
              if (!lifecycle.workspaceIntent) {
                throw new Error('Approved Open has no Execution Workspace intent');
              }
              const planningDigest =
                assessment.snapshot?.planningManifestDigest ??
                assessment.validation.validationDigest;
              const suspended = lifecycle.buildProtocol;
              const strategy = this.buildStrategy(current, lifecycle);
              const canRetainBinding = canRetainSuspendedExecutionBinding(suspended, {
                strategy,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
              });
              const workKind = canRetainBinding ? 'build.plan' : 'build.configure';
              const skills = await this.resolveLifecycleWorkSkills(workKind, signal, [], runId);
              if (canRetainBinding) {
                if (!suspended?.binding) {
                  throw new Error('Compatible suspended Execution Binding is missing');
                }
                const binding = suspended.binding;
                const protocol = revalidateSuspendedBuildProtocol(suspended, {
                  planningDigest,
                  strategy,
                  bindingCompatible: true,
                  planCompatible:
                    suspended.plan?.planningDigest === planningDigest &&
                    suspended.plan.taskSetDigest === taskSet.digest,
                  retainedPackageIds: suspended.packageCompletions.map(
                    (completion) => completion.packageId,
                  ),
                });
                build = {
                  tasks: structuredClone(taskSet.tasks),
                  protocol,
                  work: createBuildActionWork({
                    runId,
                    checkEpoch: lifecycle.checkEpoch + 1,
                    definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                    kind: 'build.plan',
                    actionSkill: skills.actionSkill,
                    augmentationSkills: skills.augmentationSkills,
                    skillComposition: skills.skillComposition,
                    compositionDigest: current.composition.compositionDigest,
                    projectConfigDigest,
                    projectSnapshotDigest: current.projectSnapshotDigest,
                    workspaceRepositoryId,
                    repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                    stableInput: {
                      planningDigest,
                      taskSetDigest: taskSet.digest,
                      strategyDigest: strategy.semanticDigest,
                      bindingStateDigest: binding.stateDigest,
                      candidatePlanDigest: suspended.plan?.digest ?? null,
                    },
                    strategyId: strategy.strategyId,
                    bindingId: binding.bindingId,
                    executionMode: strategy.executionMode,
                    tddMode: strategy.tddMode,
                  }),
                };
              } else {
                const initial = createInitialBuildWork({
                  runId,
                  checkEpoch: lifecycle.checkEpoch + 1,
                  definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                  actionSkill: skills.actionSkill,
                  augmentationSkills: skills.augmentationSkills,
                  skillComposition: skills.skillComposition,
                  taskSet,
                  approvalHash,
                  compositionDigest: current.composition.compositionDigest,
                  projectConfigDigest,
                  projectSnapshotDigest: current.projectSnapshotDigest,
                  workspaceRepositoryId,
                  repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                  strategyId: strategy.strategyId,
                  executionMode: strategy.executionMode,
                  tddMode: strategy.tddMode,
                });
                build = {
                  ...initial,
                  protocol: createBuildProtocolState({
                    runId,
                    planningDigest,
                    strategy: this.buildStrategy(current, lifecycle),
                  }),
                };
              }
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
            } catch (error) {
              assessment = {
                status: 'blocked',
                reason: error instanceof Error ? error.message : 'Build Task planning failed',
                evidenceDigests: assessment.evidenceDigests,
                validation: assessment.validation,
                ...(assessment.snapshot ? { snapshot: assessment.snapshot } : {}),
                ...(assessment.approval ? { approval: assessment.approval } : {}),
              };
            }
          }
          if (assessment.status === 'approved' && assessment.validation && build) {
            await this.coordinator.bindSpecification(runId, {
              schemaVersion: 1,
              changeId: assessment.validation.changeId,
              provider: structuredClone(assessment.validation.provider),
              validationDigest: assessment.validation.validationDigest,
            });
          }
          const inputDigest =
            assessment.snapshot?.planningManifestDigest ??
            assessment.validation?.validationDigest ??
            (`sha256:${createHash('sha256')
              .update(canonicalJson({ reason: assessment.reason }))
              .digest('hex')}` as const);
          if (
            lifecycle.phase === 'design' &&
            lifecycle.currentWork?.kind === 'specification.plan' &&
            assessment.status !== 'blocked'
          ) {
            const execution = current.workExecution;
            if (
              execution?.status !== 'outcome' ||
              execution.actionOutcome?.status !== 'succeeded'
            ) {
              throw new Error('Design Provider validation requires a succeeded Host Outcome');
            }
            const validator = this.ctx.lifecycleValidators.resolve(
              lifecycle.currentWork.validatorProfile.id,
            );
            const validation = await validator.validate({
              profileId: lifecycle.currentWork.validatorProfile.id,
              work: lifecycle.currentWork,
              fact: {
                validationDigest: assessment.validation?.validationDigest,
                result: assessment.status,
              },
            });
            if (!validation.accepted) {
              throw new Error(`Design Validator rejected: ${validation.diagnostic}`);
            }
            await this.ctx.workExecutionAuthority.markValidated({
              intent: await this.ctx.workExecutionAuthority.loadIntent(runId),
              validatorId: lifecycle.currentWork.validatorProfile.id,
              continuation: assessment.status === 'waiting' ? 'ask' : 'execute',
            });
          }
          const advanced = await this.coordinator.acceptChangeObservation(runId, {
            kind: 'design-gate',
            result: assessment.status,
            reason: assessment.reason,
            evidenceIds: assessment.evidenceDigests,
            inputDigest,
            ...(assessment.status === 'waiting' && assessment.approval
              ? {
                  requestId: assessment.approval.decisionRequest.requestId,
                  proposalDigest: assessment.approval.decisionRequest.proposalHash,
                }
              : {}),
            ...(assessment.status === 'approved' && build
              ? { tasks: build.tasks, work: build.work, buildProtocol: build.protocol }
              : {}),
          });
          if (advanced.value.state.changeLifecycle?.currentWork) {
            await this.ctx.workExecutionAuthority.recordWorkCreated(
              runId,
              advanced.value.state.changeLifecycle.currentWork,
            );
          }
          return {
            ...advanced,
            diagnostics: [...diagnostics, ...advanced.diagnostics],
          };
        }
        const skillCompatibility = await this.assertSkillCompatibility(runId, signal);
        const specificationCompatibility = await this.assertSpecificationCompatibility(runId);
        const result = await this.coordinator.next(runId, confirmations);
        const action = result.value.nextAction;
        if (action && result.value.state.pendingActionId === action.id) {
          await this.ctx.actionDispatcher.propose(runId, action, result.value.state.composition);
        }
        return {
          ...result,
          value: { ...result.value, skillCompatibility, specificationCompatibility },
        };
      },
    );
    const afterNext = await this.ctx.runStore.loadRun(runId);
    const beforeWait = beforeNext.changeLifecycle?.waitCondition;
    const afterWait = afterNext.changeLifecycle?.waitCondition;
    if (!beforeWait && afterWait) {
      await this.ctx.workExecutionAuthority.recordWaitBoundary({
        runId,
        waitId: afterWait.waitId,
        stage: 'started',
        kind: afterWait.kind,
        reason: afterWait.reason,
      });
    } else if (beforeWait && !afterWait) {
      await this.ctx.workExecutionAuthority.recordWaitBoundary({
        runId,
        waitId: beforeWait.waitId,
        stage: 'ended',
        kind: beforeWait.kind,
        reason: beforeWait.reason,
      });
    }
    const recoveredContinuation = await this.ctx.workExecutionAuthority.recovery(runId);
    const continuation =
      result.value.continuation?.reason === 'open-observation-unavailable'
        ? result.value.continuation
        : recoveredContinuation;
    await this.ctx.workExecutionAuthority.recordContinuation(runId, continuation);
    return {
      ...result,
      value: {
        ...(await this.coordinator.status(runId)),
        ...(result.value.skillCompatibility
          ? { skillCompatibility: result.value.skillCompatibility }
          : {}),
        ...(result.value.specificationCompatibility
          ? { specificationCompatibility: result.value.specificationCompatibility }
          : {}),
      },
    };
  }

  async record(
    options: {
      runId: string;
      actionId: string;
      status: ActionOutcome['status'];
      summary: string;
      eventId?: string;
      evidenceAttemptId?: string;
      correlationReceiptId?: `sha256:${string}`;
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(options.runId);
      if (state.changeLifecycle) {
        throw new Error('Generic Action outcomes cannot advance a Change Run lifecycle');
      }
      const skillCompatibility = await this.assertSkillCompatibility(options.runId, signal);
      const specificationCompatibility = await this.assertSpecificationCompatibility(options.runId);
      const eventId = options.eventId ?? randomUUID();
      const receipt = await this.ctx.actionDispatcher.completeManual({
        runId: options.runId,
        actionId: options.actionId,
        status: options.status,
        summary: options.summary,
        eventId,
      });
      const result = await this.coordinator.record({
        ...options,
        eventId,
        actionReceiptId: receipt.receiptId,
      });
      return {
        ...result,
        value: { ...result.value, skillCompatibility, specificationCompatibility },
      };
    });
  }

  private async createVerifyFailureContinuation(
    state: RunState,
    result: 'implementation-failure' | 'evidence-unavailable',
    signal?: AbortSignal,
  ): Promise<{
    tasks?: SpecificationTask[];
    work: WorkDescriptor;
    invalidation?: ReturnType<typeof createBuildInvalidation>;
    verificationInput?: ReturnType<typeof rebaseVerificationInput>;
  }> {
    const lifecycle = state.changeLifecycle;
    if (!lifecycle?.verificationInput || lifecycle.phase !== 'verify') {
      throw new Error('Verify failure continuation requires an active verification input');
    }
    const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(state.runId);
    const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
    const specificationRoot = state.trigger?.facts.specificationRoot as
      | { repositoryId?: unknown }
      | undefined;
    if (
      typeof projectConfigDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
      typeof specificationRoot?.repositoryId !== 'string'
    ) {
      throw new Error('Verify failure continuation trigger identities are missing');
    }
    if (result === 'evidence-unavailable') {
      const skills = await this.resolveLifecycleWorkSkills(
        'evidence.verify',
        signal,
        [],
        state.runId,
      );
      const verificationInput = rebaseVerificationInput(
        lifecycle.verificationInput,
        lifecycle.checkEpoch + 1,
      );
      const work = createVerifyWork({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        checkEpoch: lifecycle.checkEpoch + 1,
        verification: verificationInput,
        actionSkill: skills.actionSkill,
        augmentationSkills: skills.augmentationSkills,
        skillComposition: skills.skillComposition,
        workspaceRepositoryId: specificationRoot.repositoryId,
        repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
      });
      for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
        await this.coordinator.bindSkill(state.runId, skill);
      }
      return { work, verificationInput };
    }
    if (
      !lifecycle.planningDigest ||
      !lifecycle.buildProtocol?.plan ||
      !lifecycle.buildProtocol.binding
    ) {
      throw new Error('Build Plan revision requires an approved Design digest');
    }
    const protocol = lifecycle.buildProtocol;
    const plan = protocol.plan!;
    const strategy = protocol.strategy;
    const binding = protocol.binding!;
    const invalidation = createBuildInvalidation({
      source: 'verify',
      plan,
      classification: 'implementation',
      affectedPackageIds: plan.packages.map((workPackage) => workPackage.packageId),
      packageCompletions: protocol.packageCompletions,
      reason: 'Verify rejected the current implementation; conservatively revise all packages',
    });
    const skills = await this.resolveLifecycleWorkSkills('build.plan', signal, [], state.runId);
    const work = createBuildActionWork({
      runId: state.runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.plan',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      skillComposition: skills.skillComposition,
      compositionDigest: state.composition.compositionDigest,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      projectSnapshotDigest: state.projectSnapshotDigest,
      workspaceRepositoryId: specificationRoot.repositoryId,
      repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
      strategyId: strategy.strategyId,
      bindingId: binding.bindingId,
      executionMode: strategy.executionMode,
      tddMode: strategy.tddMode,
      planId: plan.planId,
      planRevision: plan.revision,
      stableInput: {
        planningDigest: lifecycle.planningDigest,
        taskRevisions: (lifecycle.tasks ?? []).map(({ taskId, taskRevision }) => ({
          taskId,
          taskRevision,
        })),
        reason: 'verify-finding-plan-revision',
        invalidationDigest: invalidation.digest,
      },
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(state.runId, skill);
    }
    return {
      tasks: Array.from(lifecycle.tasks ?? [], (task) => structuredClone(task)),
      work,
      invalidation,
    };
  }

  verifyChange(
    input: VerifyChangeRunInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<VerifyChangeRunResult>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(input.runId);
      const lifecycle = state.changeLifecycle;
      if (!lifecycle) throw new Error(`Run is not a Change Run: ${input.runId}`);
      const current = { ...structuredClone(lifecycle), status: state.status };
      if (
        current.phase !== 'verify' ||
        current.status !== 'running' ||
        current.currentWork?.kind !== 'evidence.verify' ||
        !current.verificationInput
      ) {
        throw new Error(`Change Run has no active Verify Work: ${input.runId}`);
      }
      const execution = state.workExecution;
      const reviewOutcomeIsReusable =
        execution?.workId === current.currentWork.workId &&
        (execution.status === 'outcome' ||
          (execution.status === 'validated' &&
            execution.validatorId === current.currentWork.validatorProfile.id)) &&
        execution.actionOutcome?.status === 'succeeded' &&
        Boolean(execution.receiptId);
      if (!reviewOutcomeIsReusable || !execution?.receiptId) {
        throw new Error('Verify Evidence requires a succeeded managed Host review Outcome');
      }
      if (execution.status === 'outcome') {
        const validator = this.ctx.lifecycleValidators.resolve(
          current.currentWork.validatorProfile.id,
        );
        const validation = await validator.validate({
          profileId: current.currentWork.validatorProfile.id,
          work: current.currentWork,
          fact: { receiptId: execution.receiptId, review: 'host-succeeded' },
        });
        if (!validation.accepted) {
          throw new Error(`Verify Validator rejected: ${validation.diagnostic}`);
        }
        await this.ctx.workExecutionAuthority.markValidated({
          intent: await this.ctx.workExecutionAuthority.loadIntent(input.runId),
          validatorId: current.currentWork.validatorProfile.id,
          continuation: 'wait',
        });
      }
      const checkEpoch = current.checkEpoch;
      const attemptId =
        input.attemptId ??
        `verify-${createHash('sha256')
          .update(
            canonicalJson({
              runId: input.runId,
              workId: current.currentWork.workId,
              workAttempt: execution.attempt,
              verificationInputDigest: current.verificationInput.digest,
            }),
          )
          .digest('hex')}`;
      let result;
      try {
        result = await this.ctx.evidenceCoordinator.runOrResume(
          current.verificationInput.evidenceProfile.id,
          attemptId,
          input.runId,
          signal,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const classification = reason.includes(
          'input fingerprint changed before Evidence execution',
        )
          ? ('implementation-failure' as const)
          : ('evidence-unavailable' as const);
        const continuation = await this.createVerifyFailureContinuation(
          state,
          classification,
          signal,
        );
        const fallback = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'verify-gate-rejected',
          workId: current.currentWork.workId,
          inputDigest: current.verificationInput.digest,
          evidenceInputFingerprint: current.verificationInput.evidenceProfile.fingerprintDigest,
          attemptId,
          bundleId: null,
          reason,
          result: classification,
          checkEpoch,
          ...continuation,
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, continuation.work);
        return {
          value: { attemptId, bundleId: null, gate: 'blocked', run: fallback.value },
          diagnostics: fallback.diagnostics,
        };
      }
      if (!result.bundle) {
        throw new Error(`Evidence attempt has no completed bundle: ${attemptId}`);
      }
      const gate = await this.ctx.evidenceCoordinator.evaluate({
        workflowRunId: input.runId,
        workflowActionId: current.currentWork.workId,
        workflowStepId: 'verify',
        checkEpoch,
        profileId: current.verificationInput.evidenceProfile.id,
        attemptId,
      });
      if (gate.status === 'blocked') {
        const rejected = rejectVerifyGate({
          runId: input.runId,
          lifecycle: current,
          gate,
          attemptId,
          checkEpoch,
          result: 'implementation-failure',
        });
        const continuation = await this.createVerifyFailureContinuation(
          state,
          rejected.result,
          signal,
        );
        const fallback = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'verify-gate-rejected',
          ...rejected,
          ...continuation,
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, continuation.work);
        return {
          value: {
            attemptId,
            bundleId: gate.bundleId,
            gate: 'blocked',
            run: fallback.value,
          },
          diagnostics: fallback.diagnostics,
        };
      }
      const accepted = acceptVerifyGate({
        runId: input.runId,
        lifecycle: current,
        gate,
        attemptId,
        checkEpoch,
      });
      const advanced = await this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'verify-gate-satisfied',
        ...accepted,
      });
      return {
        value: {
          attemptId,
          bundleId: accepted.bundleId,
          gate: 'satisfied',
          run: advanced.value,
        },
        diagnostics: advanced.diagnostics,
      };
    });
  }

  private async reverifyArchiveIfFingerprintChanged(
    runId: string,
    state: RunState,
    lifecycle: ChangeLifecycleState,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView> | null> {
    if (
      lifecycle.phase !== 'archive' ||
      !lifecycle.verificationInput ||
      lifecycle.specificationClosure ||
      lifecycle.publicationReceipt
    ) {
      return null;
    }
    const refreshed = await this.ctx.evidenceCoordinator.plan(
      lifecycle.verificationInput.evidenceProfile.id,
    );
    if (
      refreshed.fingerprint.digest === lifecycle.verificationInput.evidenceProfile.fingerprintDigest
    ) {
      return null;
    }
    const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
    const specificationRoot = state.trigger?.facts.specificationRoot as
      | { repositoryId?: unknown }
      | undefined;
    if (
      typeof projectConfigDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
      typeof specificationRoot?.repositoryId !== 'string'
    ) {
      throw new Error('Archive reverify trigger identities are missing');
    }
    const skills = await this.resolveLifecycleWorkSkills('evidence.verify', signal, [], runId);
    const verificationInput = createVerificationInput({
      runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      tasks: lifecycle.tasks ?? [],
      fingerprint: refreshed.fingerprint,
      plan: refreshed.plan,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      compositionDigest: state.composition.compositionDigest,
      skills: [
        ...(state.skillUsageSnapshots ?? []),
        skills.actionSkill,
        ...skills.augmentationSkills,
      ].filter(
        (skill, index, all) =>
          all.findIndex(
            (candidate) => candidate.name === skill.name && candidate.provider === skill.provider,
          ) === index,
      ),
    });
    const work = createVerifyWork({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      checkEpoch: lifecycle.checkEpoch + 1,
      verification: verificationInput,
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      skillComposition: skills.skillComposition,
      workspaceRepositoryId: specificationRoot.repositoryId,
      repositoryIds: refreshed.fingerprint.manifest.repositories.map(
        (repository) => repository.repositoryId,
      ),
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(runId, skill);
    }
    const fallback = await this.coordinator.acceptChangeObservation(runId, {
      kind: 'archive-reverify-required',
      reason: 'Verification input changed before Archive side effects',
      verificationInput,
      work,
    });
    await this.ctx.workExecutionAuthority.recordWorkCreated(runId, work);
    return {
      ...fallback,
      value: await this.coordinator.status(runId),
      diagnostics: [
        ...fallback.diagnostics,
        {
          level: 'warning',
          code: 'change.archive-reverify',
          message: 'Archive returned to Verify before any closure or publication side effect',
        },
      ],
    };
  }

  prepareArchiveDelivery(
    input: PrepareArchiveDeliveryInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const [state, evidence, projectSnapshot] = await Promise.all([
        this.ctx.runStore.loadRun(input.runId),
        this.ctx.evidenceCoordinator.status(input.attemptId),
        this.ctx.runStore.loadProjectSnapshot(input.runId),
      ]);
      const lifecycle = state.changeLifecycle;
      if (
        !lifecycle ||
        state.status !== 'running' ||
        lifecycle.phase !== 'archive' ||
        lifecycle.currentWork !== null ||
        !lifecycle.verificationInput
      ) {
        throw new Error(`Change Run is not ready to plan Archive Delivery: ${input.runId}`);
      }
      const reverify = await this.reverifyArchiveIfFingerprintChanged(
        input.runId,
        state,
        lifecycle,
        signal,
      );
      if (reverify) return reverify;
      if (!evidence.bundle || !evidence.bundle.verificationReport) {
        throw new Error('Archive Delivery requires a completed formal verification report');
      }
      const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
      const specificationRoot = state.trigger?.facts.specificationRoot as
        | { repositoryId?: unknown }
        | undefined;
      if (
        !lifecycle.planningDigest ||
        typeof projectConfigDigest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
        typeof specificationRoot?.repositoryId !== 'string'
      ) {
        throw new Error('Archive planning authority identities are missing');
      }
      const planningAuthority = await this.ctx.specificationPlanning.observeAuthority({
        changeId: lifecycle.identity.changeId,
        approvalPhase: 'design',
        changeBranch: input.intent.changeBranch,
        expectedPlanningDigest: lifecycle.planningDigest,
        buildStrategyDigest: this.buildStrategy(state, lifecycle).semanticDigest,
        ...(signal ? { signal } : {}),
      });
      if (planningAuthority.status === 'invalid') {
        return this.returnToDesignForPlanningRevision(
          state,
          lifecycle,
          planningAuthority,
          projectSnapshot,
          projectConfigDigest as `sha256:${string}`,
          specificationRoot.repositoryId,
          signal,
        );
      }
      await this.ctx.delivery.validateArchiveIntent(
        input.intent,
        input.policy,
        state.composition.compositionDigest,
        signal,
      );
      const archiveInput = createArchiveDeliveryInput({
        runId: input.runId,
        changeId: lifecycle.identity.changeId,
        verificationInputDigest: lifecycle.verificationInput.digest,
        acceptedEvidenceBundleIds: state.acceptedEvidenceBundleIds,
        evidenceBundleId: evidence.bundle.bundleId,
        verificationReport: evidence.bundle.verificationReport,
        intent: input.intent,
        policy: input.policy,
        planningCompositionDigest: state.composition.compositionDigest,
        evidenceCompositionDigest: lifecycle.verificationInput
          .compositionDigest as `sha256:${string}`,
      });
      const repositoryIds = Array.isArray(state.trigger?.facts.repositoryIds)
        ? state.trigger.facts.repositoryIds.filter(
            (repositoryId): repositoryId is string => typeof repositoryId === 'string',
          )
        : [];
      const archiveSkills = await this.resolveLifecycleWorkSkills(
        'specification.close',
        signal,
        [],
        input.runId,
      );
      const work = createSpecificationCloseWork({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        checkEpoch: lifecycle.checkEpoch + 1,
        archive: archiveInput,
        actionSkill: archiveSkills.actionSkill,
        skillComposition: archiveSkills.skillComposition,
        workspaceRepositoryId: input.intent.changeBranch.repositoryId,
        repositoryIds,
      });
      await this.coordinator.bindSkill(input.runId, archiveSkills.actionSkill);
      const created = await this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'archive-preflight-ready',
        archiveInput,
        work,
      });
      await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, work);
      return { ...created, value: await this.coordinator.status(input.runId) };
    });
  }

  executeArchiveDelivery(
    input: ExecuteArchiveDeliveryInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<ExecuteArchiveDeliveryResult>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      await this.coordinator.recoverChangeLifecycleDefinition(input.runId);
      const state = await this.ctx.runStore.loadRun(input.runId);
      const lifecycle = state.changeLifecycle;
      if (
        lifecycle &&
        state.status === 'running' &&
        lifecycle.phase === 'archive' &&
        lifecycle.currentWork === null &&
        lifecycle.archiveDeliveryInput &&
        lifecycle.specificationClosure &&
        !lifecycle.publicationReceipt
      ) {
        const skills = await this.resolveLifecycleWorkSkills(
          'delivery.publish',
          signal,
          [],
          input.runId,
        );
        const restoredWork = createDeliveryPublishWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          archive: lifecycle.archiveDeliveryInput,
          closure: lifecycle.specificationClosure,
          actionSkill: skills.actionSkill,
          skillComposition: skills.skillComposition,
          workspaceRepositoryId: lifecycle.archiveDeliveryInput.changeBranch.repositoryId,
          repositoryIds: input.project.repositories.map((repository) => repository.id),
        });
        await this.coordinator.bindSkill(input.runId, skills.actionSkill);
        const restored = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'archive-work-restored',
          work: restoredWork,
          reason: 'Compatible lifecycle definition upgrade restored interrupted Archive Work',
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, restoredWork);
        return {
          value: {
            stage: 'definition-recovered',
            publication: null,
            receipt: null,
            run: await this.coordinator.status(input.runId),
          },
          diagnostics: [
            ...restored.diagnostics,
            {
              level: 'warning',
              code: 'change.archive-work-restored',
              message:
                'Archive publication Work was rebuilt after an explicitly compatible definition upgrade',
            },
          ],
        };
      }
      const archive = lifecycle?.archiveDeliveryInput;
      const workKind = lifecycle?.currentWork?.kind;
      if (
        !lifecycle ||
        state.status !== 'running' ||
        lifecycle.phase !== 'archive' ||
        !['specification.close', 'delivery.publish'].includes(workKind ?? '') ||
        !archive
      ) {
        throw new Error(`Change Run has no active Archive Delivery Work: ${input.runId}`);
      }
      if (workKind === 'specification.close') {
        const reverify = await this.reverifyArchiveIfFingerprintChanged(
          input.runId,
          state,
          lifecycle,
          signal,
        );
        if (reverify) {
          return {
            value: {
              stage: 'reverify-required',
              publication: null,
              receipt: null,
              run: reverify.value,
            },
            diagnostics: reverify.diagnostics,
          };
        }
      }
      if (deliveryPolicyDigest(input.policy) !== archive.publicationPolicyDigest) {
        throw new Error('Archive Delivery policy changed after Work planning');
      }
      const currentWork = lifecycle.currentWork!;
      const execution = state.workExecution;
      const reconcilingExternalPublication =
        execution?.status === 'unknown' &&
        execution.unknownKind === 'external-side-effect' &&
        execution.continuation === 'reconcile';
      if (
        !execution ||
        execution.workId !== currentWork.workId ||
        (!['outcome', 'validated'].includes(execution.status) && !reconcilingExternalPublication) ||
        execution.actionOutcome?.status !== 'succeeded' ||
        execution.hostOutcome?.status !== 'succeeded' ||
        execution.hostOutcome.invocationId !== execution.hostInvocation?.invocationId ||
        !execution.receiptId
      ) {
        throw new Error('Archive Work requires a succeeded managed Host Outcome');
      }
      if (execution.status === 'outcome') {
        const validator = this.ctx.lifecycleValidators.resolve(currentWork.validatorProfile.id);
        const validation = await validator.validate({
          profileId: currentWork.validatorProfile.id,
          work: currentWork,
          fact: {
            receiptId: execution.receiptId,
            hostInvocationId: execution.hostInvocation.invocationId,
            result: 'host-succeeded',
          },
        });
        if (!validation.accepted) {
          throw new Error(`Archive Validator rejected: ${validation.diagnostic}`);
        }
        await this.ctx.workExecutionAuthority.markValidated({
          intent: await this.ctx.workExecutionAuthority.loadIntent(input.runId),
          validatorId: currentWork.validatorProfile.id,
          continuation: 'execute',
        });
      }
      const targetBaselineDigest = `sha256:${createHash('sha256')
        .update(archive.changeBranch.remoteOid)
        .digest('hex')}` as const;
      let closure = lifecycle.specificationClosure;
      if (workKind === 'specification.close') {
        const plan = await this.ctx.specification.prepareClosure({
          changeId: archive.changeId,
          mergeFactsDigest: archive.digest,
          targetBaselineDigest,
          ...(signal ? { signal } : {}),
        });
        closure = await this.ctx.specification.close(plan, signal);
        const skills = await this.resolveLifecycleWorkSkills(
          'delivery.publish',
          signal,
          [],
          input.runId,
        );
        const publishWork = createDeliveryPublishWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          archive,
          closure,
          actionSkill: skills.actionSkill,
          skillComposition: skills.skillComposition,
          workspaceRepositoryId: archive.changeBranch.repositoryId,
          repositoryIds: input.project.repositories.map((repository) => repository.id),
        });
        await this.coordinator.bindSkill(input.runId, skills.actionSkill);
        const advanced = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'archive-specification-closed',
          closure,
          work: publishWork,
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, publishWork);
        return {
          value: {
            stage: 'specification-closed',
            publication: null,
            receipt: null,
            run: await this.coordinator.status(input.runId),
          },
          diagnostics: advanced.diagnostics,
        };
      }
      if (!closure) {
        throw new Error('Archive Delivery Work is missing its Specification Closure Receipt');
      }
      const verificationCompositionDigest = lifecycle.verificationInput?.compositionDigest;
      if (!verificationCompositionDigest) {
        throw new Error('Archive Delivery is missing its Verification composition identity');
      }
      const intent: DeliveryIntentV3 = {
        schemaVersion: 3,
        changeId: archive.changeId,
        changeBranch: structuredClone(archive.changeBranch),
        businessDeliveries: structuredClone(archive.businessDeliveries),
        ...(archive.businessSplitReason
          ? { businessSplitReason: structuredClone(archive.businessSplitReason) }
          : {}),
      };
      const planningApproval = await this.ctx.specificationPlanning.status(
        lifecycle.identity.changeId,
        'design',
      );
      const planningCompositionDigest = archive.planningCompositionDigest;
      if (!planningCompositionDigest) {
        throw new Error('Archive Delivery is missing its planning composition identity');
      }
      try {
        await this.ctx.delivery.validateArchiveIntent(
          intent,
          input.policy,
          planningCompositionDigest,
          signal,
        );
      } catch (error) {
        if (
          !planningApproval ||
          planningApproval.status !== 'approved' ||
          planningApproval.decision?.decision !== 'approve' ||
          planningApproval.snapshot.changeId !== lifecycle.identity.changeId ||
          canonicalJson(deliveryBranchRoute(archive.changeBranch)) !==
            canonicalJson(deliveryBranchRoute(planningApproval.snapshot.changeBranch)) ||
          (archive.changeBranch.remoteOid === closure.candidate.baseOid &&
            archive.changeBranch.remoteIdentity ===
              planningApproval.snapshot.changeBranch.remoteIdentity)
        ) {
          throw error;
        }
        const normalizeCorrection = (candidate: DeliveryIntentV3) => ({
          ...candidate,
          changeBranch: {
            ...candidate.changeBranch,
            remoteIdentity: '<corrected>',
            remoteOid: '<corrected>',
          },
        });
        const correctedIntent: DeliveryIntentV3 = {
          ...intent,
          changeBranch: {
            ...structuredClone(intent.changeBranch),
            remoteIdentity: planningApproval.snapshot.changeBranch.remoteIdentity,
            remoteOid: closure.candidate.baseOid,
          },
        };
        if (
          canonicalJson(normalizeCorrection(intent)) !==
          canonicalJson(normalizeCorrection(correctedIntent))
        ) {
          throw new Error(
            'Archive intent correction may change only the approved Change branch remote identity and OID',
            {
              cause: error,
            },
          );
        }
        try {
          await this.ctx.delivery.validateArchiveIntent(
            correctedIntent,
            input.policy,
            planningCompositionDigest,
            signal,
          );
        } catch (correctedError) {
          const projectConfigDigest = state.trigger?.facts.projectConfigDigest;
          const specificationRoot = state.trigger?.facts.specificationRoot as
            | { repositoryId?: unknown }
            | undefined;
          if (
            typeof projectConfigDigest !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
            typeof specificationRoot?.repositoryId !== 'string'
          ) {
            throw new Error('Archive planning repair identities are missing', {
              cause: correctedError,
            });
          }
          const skills = await this.resolveLifecycleWorkSkills(
            'specification.plan',
            signal,
            [],
            input.runId,
          );
          const designWork = createLifecyclePhaseWork({
            runId: input.runId,
            checkEpoch: lifecycle.checkEpoch + 1,
            changeId: lifecycle.identity.changeId,
            definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
            kind: 'specification.plan',
            actionSkill: skills.actionSkill,
            augmentationSkills: skills.augmentationSkills,
            skillComposition: skills.skillComposition,
            compositionDigest: state.composition.compositionDigest,
            projectSnapshotDigest: state.projectSnapshotDigest,
            projectConfigDigest: projectConfigDigest as `sha256:${string}`,
            workspaceRepositoryId: specificationRoot.repositoryId,
            repositoryIds: input.project.repositories.map((repository) => repository.id),
          });
          for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
            await this.coordinator.bindSkill(input.runId, skill);
          }
          const revised = await this.coordinator.acceptChangeObservation(input.runId, {
            kind: 'planning-authority-invalidated',
            expectedRevision: lifecycle.revision,
            fromPhase: 'archive',
            invalidationKind: 'semantic',
            work: designWork,
            inputDigest: planningApproval.snapshot.digest,
            reason:
              correctedError instanceof Error
                ? correctedError.message
                : 'Approved Change branch no longer matches the live remote branch',
            evidenceIds: [archive.digest, closure.closureId, planningApproval.snapshot.digest],
          });
          await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, designWork);
          return {
            value: {
              stage: 'planning-revision-required',
              publication: null,
              receipt: null,
              run: await this.coordinator.status(input.runId),
            },
            diagnostics: [
              ...revised.diagnostics,
              {
                level: 'warning',
                code: 'change.archive-planning-drift',
                message:
                  'Archive returned to Design because the approved Change branch drifted before remote publication',
              },
            ],
          };
        }
        const correctedArchive = createArchiveDeliveryInput({
          runId: input.runId,
          changeId: archive.changeId,
          verificationInputDigest: archive.verificationInputDigest,
          acceptedEvidenceBundleIds: state.acceptedEvidenceBundleIds,
          evidenceBundleId: archive.evidenceBundleId,
          verificationReport: archive.verificationReport,
          intent: correctedIntent,
          policy: input.policy,
          planningCompositionDigest,
          evidenceCompositionDigest:
            archive.evidenceCompositionDigest ??
            (verificationCompositionDigest as `sha256:${string}`),
        });
        const skills = await this.resolveLifecycleWorkSkills(
          'delivery.publish',
          signal,
          [],
          input.runId,
        );
        const correctedWork = createDeliveryPublishWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          archive: correctedArchive,
          closure,
          actionSkill: skills.actionSkill,
          skillComposition: skills.skillComposition,
          workspaceRepositoryId: correctedArchive.changeBranch.repositoryId,
          repositoryIds: input.project.repositories.map((repository) => repository.id),
        });
        await this.coordinator.bindSkill(input.runId, skills.actionSkill);
        const corrected = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'archive-intent-corrected',
          priorArchiveInputDigest: archive.digest,
          archiveInput: correctedArchive,
          closure,
          work: correctedWork,
          reason:
            error instanceof Error
              ? error.message
              : 'Archive planning approval rejected the frozen Change branch OID',
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, correctedWork);
        return {
          value: {
            stage: 'intent-corrected',
            publication: null,
            receipt: null,
            run: await this.coordinator.status(input.runId),
          },
          diagnostics: [
            ...corrected.diagnostics,
            {
              level: 'warning',
              code: 'change.archive-intent-corrected',
              message:
                'Archive Change branch remote identity and OID were rebound to the approved closure baseline before publication',
            },
          ],
        };
      }
      let publication: ArchivePublicationResult;
      let receipt: PublicationReceipt;
      try {
        publication = await this.ctx.delivery.publishArchive(
          {
            runId: input.runId,
            project: input.project,
            intent,
            policy: input.policy,
            reportContents: `verification-report:sha256:${archive.verificationReport.sha256}`,
            evidenceBundleIds: [archive.evidenceBundleId],
            planningCompositionDigest,
            evidenceCompositionDigest:
              archive.evidenceCompositionDigest ??
              (verificationCompositionDigest as `sha256:${string}`),
          },
          signal,
        );
        const verifiedAt = new Date().toISOString();
        const businessItems: PublicationReceiptItem[] = archive.businessDeliveries.map(
          (delivery) => {
            const mergeRequestReceipt = publication.receipts.find(
              (item) => item.deliveryId === delivery.deliveryId && item.mergeRequest,
            );
            const pushReceipt = publication.receipts.find(
              (item) => item.deliveryId === delivery.deliveryId && item.remoteOid,
            );
            if (!mergeRequestReceipt?.mergeRequest || !pushReceipt?.remoteOid) {
              throw new Error(`Business publication Receipt is incomplete: ${delivery.deliveryId}`);
            }
            return {
              publicationId: `business:${delivery.deliveryId}`,
              role: 'business',
              deliveryId: delivery.deliveryId,
              repositoryId: delivery.repositoryId,
              remoteIdentity:
                input.project.repositories.find(
                  (repository) => repository.id === delivery.repositoryId,
                )?.remoteIdentity ??
                (() => {
                  throw new Error(
                    `Repository remote identity is missing: ${delivery.repositoryId}`,
                  );
                })(),
              remote: input.policy.publication.remote,
              sourceBranch: delivery.sourceBranch,
              targetBranch: delivery.targetBranch,
              publishedOid: pushReceipt.remoteOid,
              mergeRequest: mergeRequestReceipt.mergeRequest,
              provenance: mergeRequestReceipt.provenance ?? 'recovered',
              verifiedAt,
            };
          },
        );
        const specification = await this.ctx.delivery.publishSpecification(
          {
            changeId: archive.changeId,
            runId: lifecycle.identity.runId,
            workspaceRoot: input.project.root,
            changeBranch: archive.changeBranch,
            closure,
            remote: input.policy.publication.remote,
            title: `Archive specification: ${archive.changeId}`,
            body: `Closes verified specification change ${archive.changeId}.`,
          },
          signal,
        );
        receipt = createPublicationReceipt({
          apiVersion: PUBLICATION_RECEIPT_API_VERSION,
          kind: 'PublicationReceipt',
          schemaVersion: 2,
          changeId: archive.changeId,
          runId: input.runId,
          deliverySnapshotDigest: publication.snapshot.digest as `sha256:${string}`,
          verificationInputDigest: archive.verificationInputDigest,
          evidenceBundleIds: [archive.evidenceBundleId],
          specificationClosure: { closureId: closure.closureId, planDigest: closure.planDigest },
          items: [...businessItems, specification.item],
        });
      } catch (error) {
        if (error instanceof PublicationResultUnknownError) {
          await this.ctx.workExecutionAuthority.markExternalSideEffectUnknown(
            await this.ctx.workExecutionAuthority.loadIntent(input.runId),
            error.stage,
          );
        } else if (error instanceof PublicationNotAppliedError) {
          await this.ctx.workExecutionAuthority.recordExternalSideEffectNotApplied(
            await this.ctx.workExecutionAuthority.loadIntent(input.runId),
            error.stage,
            error.reason,
          );
        }
        throw error;
      }
      if (reconcilingExternalPublication) {
        await this.ctx.workExecutionAuthority.markExternalSideEffectObserved(
          await this.ctx.workExecutionAuthority.loadIntent(input.runId),
        );
      }
      const advanced = await this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'archive-publication-receipt-accepted',
        receipt,
      });
      return {
        value: {
          stage: 'published',
          publication,
          receipt,
          run: advanced.value,
        },
        diagnostics: advanced.diagnostics,
      };
    });
  }

  resume(
    options: {
      runId: string;
      currentProjectSnapshot: ProjectSnapshot;
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<ResumeView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const [skillCompatibility, specificationCompatibility, previousProjectSnapshot] =
        await Promise.all([
          this.skillCompatibility(options.runId, signal),
          this.specificationCompatibility(options.runId),
          this.ctx.runStore.loadProjectSnapshot(options.runId),
        ]);
      if (
        skillCompatibility.status === 'drifted' ||
        specificationCompatibility.status === 'drifted'
      ) {
        if (skillCompatibility.status === 'drifted') {
          await this.ctx.workExecutionAuthority.recordSkillCompositionDrift(
            options.runId,
            skillCompatibility.changedSkills.length,
          );
        }
        const reconciliation = reconcileProjectSnapshots(
          previousProjectSnapshot,
          options.currentProjectSnapshot,
        );
        const status = await this.coordinator.status(options.runId);
        return {
          value: {
            ...status,
            skillCompatibility,
            specificationCompatibility,
            reconciliation,
            execution: {
              schemaVersion: 2,
              continuation: 'reconcile',
              workId: status.state.workExecution?.workId ?? null,
              attempt: status.state.workExecution?.attempt ?? null,
              checkEpoch:
                status.state.workExecution?.checkEpoch ??
                status.state.changeLifecycle?.checkEpoch ??
                null,
              reason: reconciliation.requiresReconciliation
                ? 'project-drift'
                : 'content-missing-or-corrupt',
            },
          },
          diagnostics: [
            {
              level: 'error',
              code: 'runtime.migration-required',
              message:
                skillCompatibility.status === 'drifted'
                  ? skillCompatibility.reason
                  : specificationCompatibility.reason,
            },
          ],
        };
      }
      const currentState = await this.ctx.runStore.loadRun(options.runId);
      const lifecycle = currentState.changeLifecycle;
      if (
        lifecycle?.phase === 'build' &&
        lifecycle.currentWork?.kind === 'build.plan' &&
        lifecycle.buildProtocol?.binding &&
        currentState.workExecution?.status === 'invoking' &&
        currentState.workExecution.continuation === 'awaiting-correction'
      ) {
        const authorization = await this.authorizedProtectedBranchRebind(
          currentState,
          lifecycle,
          options.currentProjectSnapshot,
        );
        if (authorization) {
          const projectConfigDigest = currentState.trigger?.facts.projectConfigDigest;
          const specificationRoot = currentState.trigger?.facts.specificationRoot as
            | { repositoryId?: unknown }
            | undefined;
          if (
            typeof projectConfigDigest !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/u.test(projectConfigDigest) ||
            typeof specificationRoot?.repositoryId !== 'string'
          ) {
            throw new Error('Protected branch recovery trigger identities are missing');
          }
          const dispatched = await this.dispatchExecutionBindingRevalidation({
            state: currentState,
            lifecycle,
            projectSnapshot: options.currentProjectSnapshot,
            projectConfigDigest: projectConfigDigest as `sha256:${string}`,
            workspaceRepositoryId: specificationRoot.repositoryId,
            reasonCode: 'protected-branch-correction',
            authorizedRebind: { entrypoint: 'resume', evidence: authorization },
            ...(signal ? { signal } : {}),
          });
          return {
            ...dispatched,
            value: {
              ...dispatched.value,
              reconciliation: authorization.reconciliation,
              skillCompatibility,
              specificationCompatibility,
              execution: await this.ctx.workExecutionAuthority.recovery(options.runId),
            },
          };
        }
      }
      await this.ctx.workExecutionAuthority.reconcileCurrentCheckpoint(options.runId);
      const priorAuthorization = await this.priorAuthorizedBranchRebind(
        currentState,
        options.currentProjectSnapshot,
      );
      const result = await this.coordinator.resume({
        ...options,
        ...(priorAuthorization ? { authorizedReconciliation: priorAuthorization } : {}),
      });
      let execution = await this.ctx.workExecutionAuthority.recovery(options.runId);
      if (result.value.reconciliation.requiresReconciliation) {
        execution = { ...execution, continuation: 'reconcile', reason: 'project-drift' };
      } else if (
        execution.continuation === 'execute' &&
        result.value.state.workExecution &&
        ['claimed', 'context-delivered'].includes(result.value.state.workExecution.status)
      ) {
        try {
          await this.ctx.workDispatcher.resumeClaim(options.runId);
        } catch {
          execution = {
            ...execution,
            continuation: 'reconcile',
            reason: 'content-missing-or-corrupt',
          };
        }
      }
      return {
        ...result,
        value: {
          ...result.value,
          skillCompatibility,
          specificationCompatibility,
          execution,
        },
      };
    });
  }

  private async skillCompatibility(
    runId: string,
    signal?: AbortSignal,
  ): Promise<SkillCompatibility> {
    const state = await this.ctx.runStore.loadRun(runId);
    const changedSkills = new Set<string>();
    const frozenComposition = state.changeLifecycle?.skillCompositionDigest;
    if (frozenComposition) {
      try {
        const currentComposition = await this.ctx.teamSkillComposition.compile(
          BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          signal,
        );
        if (currentComposition.digest !== frozenComposition) {
          changedSkills.add('effective-composition');
        }
      } catch {
        signal?.throwIfAborted();
        changedSkills.add('effective-composition');
      }
    }
    for (const expected of state.skillUsageSnapshots ?? []) {
      signal?.throwIfAborted();
      const definition = await this.ctx.skills
        .get(expected.name, {
          cwd: this.workspaceRoot,
          signal,
        })
        .catch(() => {
          signal?.throwIfAborted();
          return undefined;
        });
      if (!definition) {
        changedSkills.add(expected.name);
        continue;
      }
      const current = await snapshotSkillDefinition(definition);
      if (!sameSkillUsageSnapshot(expected, current)) changedSkills.add(expected.name);
    }
    const changed = [...changedSkills].sort();
    return changed.length === 0
      ? { status: 'same', changedSkills: [], reason: 'used Skill snapshots are unchanged' }
      : {
          status: 'drifted',
          changedSkills: changed,
          reason: `used Skill snapshots or effective composition changed: ${changed.join(', ')}`,
        };
  }

  private async assertSkillCompatibility(
    runId: string,
    signal?: AbortSignal,
  ): Promise<SkillCompatibility> {
    const compatibility = await this.skillCompatibility(runId, signal);
    if (compatibility.status === 'drifted') {
      await this.ctx.workExecutionAuthority.recordSkillCompositionDrift(
        runId,
        compatibility.changedSkills.length,
      );
      throw new Error(
        `Run ${runId} requires a Human Decision or a new Run because ${compatibility.reason}`,
      );
    }
    return compatibility;
  }

  private async specificationCompatibility(runId: string): Promise<SpecificationCompatibility> {
    const state = await this.ctx.runStore.loadRun(runId);
    const expected = state.specificationUsageSnapshot;
    if (!expected) return { status: 'same', reason: 'Run has not bound a Specification Provider' };
    const current = this.ctx.specification.identity();
    const same =
      expected.provider.id === current.id &&
      expected.provider.version === current.version &&
      expected.provider.protocolVersion === current.protocolVersion;
    return same
      ? { status: 'same', reason: 'Specification Provider identity is unchanged' }
      : {
          status: 'drifted',
          reason: `Specification Provider changed from ${expected.provider.id}@${expected.provider.version} to ${current.id}@${current.version}`,
        };
  }

  private async assertSpecificationCompatibility(
    runId: string,
  ): Promise<SpecificationCompatibility> {
    const compatibility = await this.specificationCompatibility(runId);
    if (compatibility.status === 'drifted') {
      throw new Error(`Run ${runId} requires migration because ${compatibility.reason}`);
    }
    return compatibility;
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowRuns: WorkflowRuns;
  }
}
