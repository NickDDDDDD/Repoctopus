import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ActionOutcome, RunState, RunTriggerSnapshot } from '../domains/engine/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import { reconcileProjectSnapshots } from '../domains/project/snapshot.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import type {
  ResumeView,
  RunStatusView,
  RuntimeDiagnostic,
  RuntimeResult,
} from '../domains/runtime/types.js';
import type { WorkflowPackage } from '../domains/workflow-contract/types.js';
import {
  sameSkillUsageSnapshot,
  type SkillCompatibility,
  type SkillUsageSnapshot,
} from '../domains/skill/types.js';
import { snapshotSkillDefinition } from '../platform/skill/snapshot.js';
import type {
  SpecificationCompatibility,
  SpecificationApprovalActor,
  SpecificationApprovalDecisionResponse,
  SpecificationApprovalState,
  SpecificationClosurePlan,
  SpecificationUsageSnapshot,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import { lifecycleWorkDefinition } from '../domains/change-lifecycle/work-definition.js';
import {
  changeRunId,
  createChangeRunHostWorkflow,
} from '../domains/change-lifecycle/host-workflow.js';
import type { DesignGateAssessment } from './specification-planning.js';
import {
  buildActionSkillComposition,
  createBuildActionWork,
  createInitialBuildWork,
} from '../domains/change-lifecycle/build-work.js';
import {
  acceptBuildConfiguration,
  createBuildConfigurationProposal,
  createBuildCheckEvidence,
  createBuildInvalidation,
  createBuildPlan,
  createBuildProtocolState,
  createExecutionWorkspaceIntent,
  createPlanEvidence,
  createPackageCompletionEvidence,
  validateBuildPlan,
  type BuildConfiguration,
  type ExecutionWorkspaceBinding,
  type ExecutionIsolation,
} from '../domains/change-lifecycle/build-protocol.js';
import type { ExecutionCheckoutRequest } from './execution-workspace.js';
import {
  createVerificationInput,
  rebaseVerificationInput,
} from '../domains/change-lifecycle/verification-input.js';
import { createVerifyWork } from '../domains/change-lifecycle/verify-work.js';
import { acceptVerifyGate, rejectVerifyGate } from '../domains/change-lifecycle/verify-gate.js';
import type { SpecificationTask } from '../domains/specification/types.js';
import type {
  ChangeLifecycleState,
  ChangeRunProjection,
  WorkDescriptor,
} from '../domains/change-lifecycle/transition.js';
import {
  createArchiveDeliveryInput,
  createDeliveryPublishWork,
  createSpecificationCloseWork,
} from '../domains/change-lifecycle/archive-input.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import { deliveryPolicyDigest } from '../domains/delivery/snapshot.js';
import type { WorkExecutorIdentity } from '../domains/action/types.js';
import type { WorkExecutionHostIdentity } from '../domains/work-execution/types.js';
import type { ArchivePublicationResult } from '../domains/delivery/service-v3.js';
import {
  createPublicationReceipt,
  PUBLICATION_RECEIPT_API_VERSION,
  type PublicationReceipt,
  type PublicationReceiptItem,
} from '../domains/delivery/publication-receipt.js';
import { lifecycleContributorSnapshot } from '../domains/change-lifecycle/contributors.js';
import { createLifecyclePhaseWork } from '../domains/change-lifecycle/phase-work.js';

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
    | 'intent-corrected'
    | 'definition-recovered'
    | 'planning-revision-required'
    | 'published';
  publication: ArchivePublicationResult | null;
  receipt: PublicationReceipt | null;
  run: RunStatusView;
}

function deliveryBranchCoordinates(branch: DeliveryIntentV3['changeBranch']) {
  return {
    repositoryId: branch.repositoryId,
    remoteIdentity: branch.remoteIdentity,
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
    'evidenceCoordinator',
    'executionWorkspace',
    'lifecycleDefinitions',
    'lifecycleExtensions',
    'lifecycleValidators',
    'managedWorkExecutor',
    'project',
    'runStore',
    'skills',
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
  ): Promise<RuntimeResult<RunStatusView>> {
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
      const runId = changeRunId({ workspaceId, changeId });
      const lifecycle = createChangeLifecycleSnapshot({
        identity: {
          workspaceId,
          changeId,
          runId,
        },
      });
      const openSkills = await this.resolveLifecycleWorkSkills('change.intake', signal);
      lifecycle.currentWork = createLifecyclePhaseWork({
        runId,
        checkEpoch: lifecycle.checkEpoch,
        changeId,
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'change.intake',
        actionSkill: openSkills.actionSkill,
        augmentationSkills: openSkills.augmentationSkills,
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
        repositoryIds,
        projectConfigDigest: input.projectConfigDigest,
        verificationProfileId: input.verificationProfileId,
        specificationProvider: this.ctx.specification.identity(),
        executionCheckouts: input.executionCheckouts.map((checkout) => ({
          repositoryId: checkout.repositoryId,
          checkoutPath: checkout.checkoutPath,
        })),
      };
      const started = await this.coordinator.startOrResume({
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
      for (const skill of [openSkills.actionSkill, ...openSkills.augmentationSkills]) {
        await this.coordinator.bindSkill(runId, skill);
      }
      await this.ctx.workExecutionAuthority.recordWorkCreated(runId, lifecycle.currentWork);
      return { ...started, value: await this.coordinator.status(runId) };
    });
  }

  status(runId: string, signal?: AbortSignal): Promise<RunStatusView> {
    return this.operations.run({ cancellable: true, signal }, async () => {
      const status = await this.coordinator.status(runId);
      return {
        ...status,
        skillCompatibility: await this.skillCompatibility(runId, signal),
        specificationCompatibility: await this.specificationCompatibility(runId),
        ...(status.state.changeLifecycle
          ? { continuation: await this.ctx.workExecutionAuthority.recovery(runId) }
          : {}),
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
        lifecycle?.phase === 'build' &&
        state.status === 'waiting' &&
        lifecycle.waitCondition?.kind === 'human-decision' &&
        lifecycle.waitCondition.waitId.startsWith('build-configuration:')
      ) {
        if (!input.actor.authenticated) {
          throw new Error('Build Configuration approval requires a trusted actor');
        }
        if (
          input.response.requestId !== lifecycle.waitCondition.requestId ||
          input.response.proposalHash !== lifecycle.waitCondition.proposalDigest
        ) {
          throw new Error('Build Configuration response does not match the current proposal');
        }
        const proposal = lifecycle.buildProtocol?.configurationProposal;
        if (!proposal || proposal.semanticDigest !== input.response.proposalHash) {
          throw new Error('Build Configuration proposal is missing or stale');
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
          throw new Error('Build Configuration decision trigger identities are missing');
        }
        const approved = input.response.decision === 'approve';
        const kind = approved ? 'build.plan' : 'build.configure';
        const skills = await this.resolveLifecycleWorkSkills(kind, signal);
        const configuration = approved
          ? acceptBuildConfiguration({
              proposal,
              requestId: input.response.requestId,
              actorId: input.actor.actorId,
              decidedAt: new Date().toISOString(),
            })
          : undefined;
        const work = createBuildActionWork({
          runId: input.runId,
          checkEpoch: lifecycle.checkEpoch + 1,
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          kind,
          actionSkill: skills.actionSkill,
          augmentationSkills: skills.augmentationSkills,
          compositionDigest: state.composition.compositionDigest,
          projectConfigDigest: projectConfigDigest as `sha256:${string}`,
          projectSnapshotDigest: state.projectSnapshotDigest,
          workspaceRepositoryId: specificationRoot.repositoryId,
          repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
          ...(configuration
            ? { executionMode: configuration.executionMode, tddMode: configuration.tddMode }
            : {}),
          stableInput: approved
            ? {
                configurationId: configuration!.configurationId,
                configurationDigest: configuration!.semanticDigest,
                planningDigest: lifecycle.planningDigest,
                tasks: lifecycle.tasks?.map(({ taskId, taskRevision }) => ({
                  taskId,
                  taskRevision,
                })),
              }
            : { proposalDigest: proposal.semanticDigest, reason: 'configuration-revision' },
        });
        for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
          await this.coordinator.bindSkill(input.runId, skill);
        }
        const waitId = lifecycle.waitCondition.waitId;
        const decided = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'build-configuration-decision',
          decision: approved ? 'approve' : 'reject',
          requestId: input.response.requestId,
          proposalDigest: input.response.proposalHash,
          actorId: input.actor.actorId,
          ...(configuration ? { configuration } : {}),
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
        const configuration = protocol?.configuration;
        const plan = protocol?.plan;
        if (!protocol || !configuration || !plan || protocol.currentAction !== 'plan-evidence') {
          throw new Error('Build Plan approval has no active Plan Evidence');
        }
        const taskSet = await this.ctx.specification.tasks(lifecycle.identity.changeId, signal);
        const evidence = createPlanEvidence({
          plan,
          configuration,
          validation: validateBuildPlan({ plan, configuration, tasks: taskSet }),
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
          tddMode: configuration.tddMode,
        });
        const skills = await this.resolveLifecycleWorkSkills(
          kind,
          signal,
          composition.augmentationSkills,
        );
        const work = createBuildActionWork({
          runId: input.runId,
          checkEpoch: lifecycle.checkEpoch + 1,
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          kind,
          actionSkill: skills.actionSkill,
          augmentationSkills: skills.augmentationSkills,
          compositionDigest: state.composition.compositionDigest,
          projectConfigDigest: projectConfigDigest as `sha256:${string}`,
          projectSnapshotDigest: state.projectSnapshotDigest,
          workspaceRepositoryId: specificationRoot.repositoryId,
          repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
          configurationId: configuration.configurationId,
          executionMode: configuration.executionMode,
          tddMode: configuration.tddMode,
          planId: plan.planId,
          planRevision: plan.revision,
          ...(nextPackage
            ? { packageId: nextPackage.packageId, writeScopes: nextPackage.writeScopes }
            : {}),
          stableInput: approved
            ? {
                planEvidenceId: evidence.evidenceId,
                planDigest: plan.digest,
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
          const skills = await this.resolveLifecycleWorkSkills('specification.plan', signal);
          designWork = createLifecyclePhaseWork({
            runId: input.runId,
            checkEpoch: lifecycle.checkEpoch + 1,
            changeId: lifecycle.identity.changeId,
            definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
            kind: 'specification.plan',
            actionSkill: skills.actionSkill,
            augmentationSkills: skills.augmentationSkills,
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
        const target = state.trigger?.facts.targetBranch as
          | { targetBranch?: unknown }
          | undefined;
        const intent = createExecutionWorkspaceIntent({
          workspaceId: lifecycle.identity.workspaceId,
          changeId: lifecycle.identity.changeId,
          isolation: input.isolation,
          ...(input.isolation === 'branch' && typeof target?.targetBranch === 'string'
            ? { targetBranch: target.targetBranch }
            : {}),
        });
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
    projectSnapshot: ProjectSnapshot;
    projectConfigDigest: `sha256:${string}`;
    workspaceRepositoryId: string;
  }> {
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
    let assessment: DesignGateAssessment;
    try {
      const changeBranch = await this.ctx.project.changeBranch({
        repositoryId: targetBranch.repositoryId,
        repositoryPath: workspaceRepository.path,
        remote: targetBranch.remote,
        targetBranch: targetBranch.targetBranch,
      });
      assessment = await this.ctx.specificationPlanning.assess({
        changeId: lifecycle.identity.changeId,
        approvalPhase,
        changeBranch,
        compositionDigest: state.composition.compositionDigest,
        projectConfigDigest: projectConfigDigest as `sha256:${string}`,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      assessment = {
        status: 'blocked',
        reason: error instanceof Error ? error.message : `${approvalPhase} gate assessment failed`,
        evidenceDigests: [],
      };
    }
    return {
      assessment,
      projectSnapshot,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      workspaceRepositoryId: targetBranch.repositoryId,
    };
  }

  private async inspectPlanningSemantics(changeId: string, signal?: AbortSignal): Promise<{
    approved: boolean;
    digest: `sha256:${string}`;
    reason: string;
    evidenceDigests: `sha256:${string}`[];
  }> {
    try {
      const [manifest, validation] = await Promise.all([
        this.ctx.specification.planningManifest(changeId, signal),
        this.ctx.specification.validate(changeId, {
          strict: true,
          ...(signal ? { signal } : {}),
        }),
      ]);
      const approved = manifest.change.planningComplete && validation.strict && validation.valid;
      return {
        approved,
        digest: manifest.semanticDigest,
        reason: approved
          ? 'Planning semantics remain strictly valid'
          : 'Planning semantics are incomplete or invalid',
        evidenceDigests: [
          manifest.semanticDigest,
          manifest.change.changeDigest,
          validation.validationDigest,
        ],
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Planning semantic inspection failed';
      return {
        approved: false,
        digest: `sha256:${createHash('sha256')
          .update(canonicalJson({ kind: 'planning-semantic-inspection-failed', reason }))
          .digest('hex')}`,
        reason,
        evidenceDigests: [],
      };
    }
  }

  private async resolveLifecycleWorkSkills(
    kind: string,
    signal?: AbortSignal,
    configuredAugmentationNames: readonly string[] = [],
  ): Promise<{
    actionSkill: SkillUsageSnapshot;
    augmentationSkills: SkillUsageSnapshot[];
  }> {
    const work = lifecycleWorkDefinition(BUILTIN_CHANGE_LIFECYCLE_DEFINITION, kind);
    if (!work.actionSkill) {
      throw new Error(`Lifecycle Work has no executable action Skill: ${kind}`);
    }
    const resolve = async (name: string): Promise<SkillUsageSnapshot> => {
      const definition = await this.ctx.skills.get(name, {
        cwd: this.workspaceRoot,
        ...(signal ? { signal } : {}),
      });
      if (!definition || !isModelInvocable(definition)) {
        throw new Error(`Lifecycle executable Skill is unavailable: ${name}`);
      }
      return snapshotSkillDefinition(definition);
    };
    return {
      actionSkill: await resolve(work.actionSkill.name),
      augmentationSkills: await Promise.all(
        [
          ...work.augmentationSkills.map((skill) => skill.name),
          ...configuredAugmentationNames,
        ].map((name) => resolve(name)),
      ),
    };
  }

  private assertFrozenBuildHost(
    configuration: BuildConfiguration,
    invocationHost: WorkExecutionHostIdentity,
  ): void {
    if (invocationHost.id !== configuration.hostId) {
      throw new Error('Build Host identity drifted from the approved Configuration');
    }
    if (
      configuration.hostCapabilities.some(
        (capability) => !invocationHost.capabilities.includes(capability),
      )
    ) {
      throw new Error('Build Host capabilities drifted from the approved Configuration');
    }
    const required =
      configuration.executionMode === 'autonomous'
        ? 'build.autonomous'
        : 'subagent.dispatch.attested';
    if (!invocationHost.capabilities.includes(required)) {
      throw new Error(`Approved Build Host no longer supports ${required}`);
    }
  }

  private async bindExecutionWorkspace(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
  ): Promise<ExecutionWorkspaceBinding> {
    const checkoutInput = state.trigger?.facts.executionCheckouts;
    if (!Array.isArray(checkoutInput)) {
      throw new Error('Runner did not provide execution checkout bindings');
    }
    if (!lifecycle.workspaceIntent) {
      throw new Error('Build requires the approved Workspace intent');
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
      intent: lifecycle.workspaceIntent,
      project: projectSnapshot,
      checkouts,
    });
  }

  private async assertFrozenExecutionWorkspace(
    state: RunState,
    lifecycle: NonNullable<RunState['changeLifecycle']>,
    projectSnapshot: ProjectSnapshot,
    configuration: BuildConfiguration,
  ): Promise<void> {
    const binding = await this.bindExecutionWorkspace(state, lifecycle, projectSnapshot);
    if (
      binding.localDigest !== configuration.bindingDigest ||
      binding.semanticDigest !== configuration.bindingSemanticDigest
    ) {
      throw new Error('Execution Workspace identity drifted from the approved Configuration');
    }
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
    const skills = await this.resolveLifecycleWorkSkills('specification.plan', signal);
    const work = createLifecyclePhaseWork({
      runId: state.runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      changeId: lifecycle.identity.changeId,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'specification.plan',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
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
    const [receipt, change, intent] = await Promise.all([
      this.ctx.actionStore.loadReceipt(state.runId, execution.receiptId),
      this.ctx.specification.inspect(lifecycle.identity.changeId, signal),
      this.ctx.workExecutionAuthority.loadIntent(state.runId),
    ]);
    const requiredArtifacts = new Set(['proposal', 'delta-specs', 'design', 'tasks']);
    if (
      receipt.intentId !== execution.intentId ||
      receipt.outcome !== 'succeeded' ||
      change.changeId !== lifecycle.identity.changeId
    ) {
      throw new Error('Open Provider validation is not bound to the authoritative Work Outcome');
    }
    if (
      change.artifacts.filter(
        (artifact) => requiredArtifacts.has(artifact.kind) && artifact.status === 'ready',
      ).length !== requiredArtifacts.size
    ) {
      const blocked = await this.coordinator.acceptChangeObservation(state.runId, {
        kind: 'open-gate',
        result: 'blocked',
        reason: 'Open Provider validation requires the complete four-artifact OpenSpec set',
        evidenceIds: change.artifacts.flatMap((artifact) =>
          artifact.digest ? [artifact.digest] : [],
        ),
        inputDigest: change.changeDigest,
      });
      return { ...blocked, value: await this.coordinator.status(state.runId) };
    }
    const validator = this.ctx.lifecycleValidators.resolve(work.validatorProfile.id);
    const validation = await validator.validate({
      profileId: work.validatorProfile.id,
      work,
      fact: { receiptId: receipt.receiptId, changeDigest: change.changeDigest },
    });
    if (!validation.accepted) {
      const blocked = await this.coordinator.acceptChangeObservation(state.runId, {
        kind: 'open-gate',
        result: 'blocked',
        reason: `Open Validator rejected: ${validation.diagnostic}`,
        evidenceIds: [receipt.receiptId, change.changeDigest],
        inputDigest: change.changeDigest,
      });
      return { ...blocked, value: await this.coordinator.status(state.runId) };
    }
    await this.ctx.workExecutionAuthority.markValidated({
      intent,
      validatorId: work.validatorProfile.id,
      continuation: 'execute',
    });
    return this.advanceOpenGate(state, signal);
  }

  private async advanceOpenGate(
    state: RunState,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    const lifecycle = state.changeLifecycle;
    if (!lifecycle || lifecycle.phase !== 'open') {
      throw new Error('Open gate requires an Open Change Run');
    }
    const evaluated = await this.assessChangePlanning(state, lifecycle, 'open', signal);
    const assessment = evaluated.assessment;
    if (assessment.approval?.status === 'changes_requested') {
      const skills = await this.resolveLifecycleWorkSkills('change.intake', signal);
      const revisionWork = createLifecyclePhaseWork({
        runId: state.runId,
        checkEpoch: lifecycle.checkEpoch + 1,
        changeId: lifecycle.identity.changeId,
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'change.intake',
        actionSkill: skills.actionSkill,
        augmentationSkills: skills.augmentationSkills,
        compositionDigest: state.composition.compositionDigest,
        projectSnapshotDigest: state.projectSnapshotDigest,
        projectConfigDigest: evaluated.projectConfigDigest,
        workspaceRepositoryId: evaluated.workspaceRepositoryId,
        repositoryIds: evaluated.projectSnapshot.repositories.map((repository) => repository.id),
      });
      for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
        await this.coordinator.bindSkill(state.runId, skill);
      }
      const revised = await this.coordinator.acceptChangeObservation(state.runId, {
        kind: 'open-work-ready',
        work: revisionWork,
      });
      await this.ctx.workExecutionAuthority.recordWorkCreated(state.runId, revisionWork);
      return { ...revised, value: await this.coordinator.status(state.runId) };
    }
    const inputDigest =
      assessment.snapshot?.digest ??
      assessment.validation?.validationDigest ??
      (`sha256:${createHash('sha256')
        .update(canonicalJson({ phase: 'open', reason: assessment.reason }))
        .digest('hex')}` as const);
    let designWork: WorkDescriptor | undefined;
    if (assessment.status === 'approved') {
      const skills = await this.resolveLifecycleWorkSkills('specification.plan', signal);
      designWork = createLifecyclePhaseWork({
        runId: state.runId,
        checkEpoch: lifecycle.checkEpoch + 1,
        changeId: lifecycle.identity.changeId,
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        kind: 'specification.plan',
        actionSkill: skills.actionSkill,
        augmentationSkills: skills.augmentationSkills,
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
        value: { ...verified.value.run, continuation },
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
          const dispatchable =
            work &&
            this.ctx.workExecutionHosts.snapshot().hosts.length > 0 &&
            (!execution ||
              execution.workId !== work.workId ||
              ['claimed', 'context-delivered', 'not-executed'].includes(execution.status) ||
              (execution.status === 'outcome' && execution.actionOutcome?.status === 'failed'));
          if (dispatchable) {
            const adapter =
              work.kind === 'delivery.publish'
                ? 'git'
                : work.capabilities.includes('process.execute')
                  ? 'process'
                  : work.capabilities.includes('specification.write')
                    ? 'specification'
                    : 'manual';
            await this.ctx.managedWorkExecutor.execute({
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
              return this.advanceOpenGate(state, signal);
            }
            if (
              state.workExecution?.status === 'outcome' &&
              state.workExecution.actionOutcome?.status === 'succeeded'
            ) {
              return this.validateOpenWork(state, signal);
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
          const evaluated = await this.assessChangePlanning(current, lifecycle, 'design', signal);
          let assessment = evaluated.assessment;
          const { projectSnapshot, projectConfigDigest, workspaceRepositoryId } = evaluated;
          if (
            lifecycle.phase === 'design' &&
            lifecycle.currentWork === null &&
            assessment.approval?.status === 'changes_requested'
          ) {
            return this.createDesignWork(current, signal);
          }
          if (lifecycle.phase === 'build' || lifecycle.phase === 'verify') {
            const semantics = await this.inspectPlanningSemantics(
              lifecycle.identity.changeId,
              signal,
            );
            if (!semantics.approved || semantics.digest !== lifecycle.planningDigest) {
              const drift = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'planning-semantic-drift',
                reason: semantics.reason,
                evidenceIds: semantics.evidenceDigests,
                inputDigest: semantics.digest,
              });
              return {
                ...drift,
                diagnostics: [
                  ...drift.diagnostics,
                  {
                    level: 'warning',
                    code: 'change.planning-semantic-drift',
                    message: `${semantics.reason}; approved=${lifecycle.planningDigest}; observed=${semantics.digest}`,
                  },
                ],
              };
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork === null &&
              lifecycle.buildProtocol?.currentAction === 'configure'
            ) {
              const skills = await this.resolveLifecycleWorkSkills('build.configure', signal);
              const work = createBuildActionWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: 'build.configure',
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                stableInput: {
                  reason: 'compatible-definition-recovery',
                  actionAttempt: lifecycle.buildProtocol.actionAttempt + 1,
                },
              });
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const restored = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-configuration-retry-required',
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
                    code: 'change.build-configuration-work-restored',
                    message: 'Compatible lifecycle recovery restored interrupted Configure Work',
                  },
                ],
              };
            }
            if (
              lifecycle.phase === 'build' &&
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
              const configurationCandidate = hostOutcome.result;
              if (configurationCandidate?.kind !== 'build-configuration-candidate') {
                throw new Error(
                  'Build Configure Host must return a structured build-configuration-candidate',
                );
              }
              const invocationHost = current.workExecution.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== hostOutcome.hostId) {
                throw new Error('Build Configure Host does not match the persisted invocation');
              }
              if (!lifecycle.workspaceIntent || !lifecycle.buildProtocol) {
                throw new Error('Build Configure requires the approved Workspace intent');
              }
              const requiredCapability =
                configurationCandidate.executionMode === 'autonomous'
                  ? 'build.autonomous'
                  : 'subagent.dispatch.attested';
              if (!invocationHost.capabilities.includes(requiredCapability)) {
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
                const skills = await this.resolveLifecycleWorkSkills('build.configure', signal);
                const retryWork = createBuildActionWork({
                  runId,
                  checkEpoch: lifecycle.checkEpoch + 1,
                  definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                  kind: 'build.configure',
                  actionSkill: skills.actionSkill,
                  augmentationSkills: skills.augmentationSkills,
                  compositionDigest: current.composition.compositionDigest,
                  projectConfigDigest: projectConfigDigest as `sha256:${string}`,
                  projectSnapshotDigest: current.projectSnapshotDigest,
                  workspaceRepositoryId: specificationRoot.repositoryId,
                  repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                  stableInput: {
                    reason: 'configuration-host-capability-missing',
                    priorWorkId: lifecycle.currentWork.workId,
                    executionMode: configurationCandidate.executionMode,
                    requiredCapability,
                  },
                });
                for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
                const retried = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'build-configuration-retry-required',
                  reason: `Configure Host did not attest ${requiredCapability}`,
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
                      code: 'change.build-configuration-host-capability-retry',
                      message: `Build Configure will retry with a Host that attests ${requiredCapability}`,
                    },
                  ],
                };
              }
              const binding = await this.bindExecutionWorkspace(
                current,
                lifecycle,
                projectSnapshot,
              );
              const proposal = createBuildConfigurationProposal({
                intent: lifecycle.workspaceIntent,
                binding,
                executionMode: configurationCandidate.executionMode,
                tddMode: configurationCandidate.tddMode,
                reviewMode: 'standard',
                hostId: invocationHost.id,
                hostCapabilities: invocationHost.capabilities,
              });
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              const validation = await validator.validate({
                profileId: lifecycle.currentWork.validatorProfile.id,
                work: lifecycle.currentWork,
                fact: proposal,
              });
              if (!validation.accepted) {
                throw new Error(`Build Configure Validator rejected: ${validation.diagnostic}`);
              }
              await this.ctx.workExecutionAuthority.markValidated({
                intent: await this.ctx.workExecutionAuthority.loadIntent(runId),
                validatorId: lifecycle.currentWork.validatorProfile.id,
                continuation: 'ask',
              });
              const requestId = `configuration:${proposal.semanticDigest.slice(-24)}`;
              const proposed = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-configuration-proposed',
                proposal,
                requestId,
                reason: 'Approve the immutable Build execution configuration',
              });
              await this.ctx.workExecutionAuthority.recordWaitBoundary({
                runId,
                waitId: `build-configuration:${requestId}`,
                stage: 'started',
                kind: 'human-decision',
                reason: 'Approve the immutable Build execution configuration',
              });
              return { ...proposed, value: await this.coordinator.status(runId) };
            }
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.plan' &&
              current.workExecution?.status === 'outcome' &&
              current.workExecution.actionOutcome?.status === 'succeeded'
            ) {
              const protocol = lifecycle.buildProtocol;
              const configuration = protocol?.configuration;
              const hostOutcome = current.workExecution.hostOutcome;
              const result = hostOutcome?.result;
              if (!protocol || !configuration || protocol.currentAction !== 'plan') {
                throw new Error('Build Plan Outcome has no frozen configuration');
              }
              if (!hostOutcome) throw new Error('Build Plan Host Outcome is missing');
              const invocationHost = current.workExecution.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== hostOutcome.hostId) {
                throw new Error('Build Plan Host does not match the persisted invocation');
              }
              if (
                invocationHost.id !== configuration.hostId ||
                configuration.hostCapabilities.some(
                  (capability) => !invocationHost.capabilities.includes(capability),
                )
              ) {
                const planSkills = await this.resolveLifecycleWorkSkills('build.plan', signal);
                const retryWork = createBuildActionWork({
                  runId,
                  checkEpoch: lifecycle.checkEpoch + 1,
                  definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                  kind: 'build.plan',
                  actionSkill: planSkills.actionSkill,
                  augmentationSkills: planSkills.augmentationSkills,
                  compositionDigest: current.composition.compositionDigest,
                  projectConfigDigest,
                  projectSnapshotDigest: current.projectSnapshotDigest,
                  workspaceRepositoryId,
                  repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                  configurationId: configuration.configurationId,
                  executionMode: configuration.executionMode,
                  tddMode: configuration.tddMode,
                  stableInput: {
                    reason: 'plan-host-drift',
                    priorWorkId: lifecycle.currentWork.workId,
                    approvedHostId: configuration.hostId,
                    observedHostId: invocationHost.id,
                  },
                });
                for (const skill of [planSkills.actionSkill, ...planSkills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
                const retried = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'build-plan-retry-required',
                  reason: 'Build Plan Outcome came from a Host outside the approved Configuration',
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
                      code: 'change.build-plan-host-retry',
                      message: 'Build Plan will retry with the Host approved by the Configuration',
                    },
                  ],
                };
              }
              this.assertFrozenBuildHost(configuration, invocationHost);
              await this.assertFrozenExecutionWorkspace(
                current,
                lifecycle,
                projectSnapshot,
                configuration,
              );
              if (result?.kind !== 'build-plan-candidate') {
                throw new Error('Build Plan Host must return a structured build-plan-candidate');
              }
              const taskSet = await this.ctx.specification.tasks(
                lifecycle.identity.changeId,
                signal,
              );
              const plan = createBuildPlan({
                runId,
                revision: (protocol.plan?.revision ?? 0) + 1,
                configuration,
                planningDigest: lifecycle.planningDigest,
                tasks: taskSet,
                candidate: { packages: result.packages },
              });
              const planValidation = validateBuildPlan({ plan, configuration, tasks: taskSet });
              if (!planValidation.accepted) {
                throw new Error(`Build Plan rejected: ${planValidation.diagnostics.join('; ')}`);
              }
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              const validation = await validator.validate({
                profileId: lifecycle.currentWork.validatorProfile.id,
                work: lifecycle.currentWork,
                fact: planValidation,
              });
              if (!validation.accepted) {
                throw new Error(`Build Plan Validator rejected: ${validation.diagnostic}`);
              }
              await this.ctx.workExecutionAuthority.markValidated({
                intent: await this.ctx.workExecutionAuthority.loadIntent(runId),
                validatorId: lifecycle.currentWork.validatorProfile.id,
                continuation: 'execute',
              });
              const planned = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-plan-accepted',
                plan,
              });
              const evidence = createPlanEvidence({ plan, configuration, validation: planValidation });
              if (evidence.risk.level === 'high') {
                const requestId = `plan:${evidence.validationDigest.slice(-24)}`;
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
                tddMode: configuration.tddMode,
              });
              const skills = await this.resolveLifecycleWorkSkills(
                nextKind,
                signal,
                composition.augmentationSkills,
              );
              const nextWork = createBuildActionWork({
                runId,
                checkEpoch: planned.value.state.changeLifecycle!.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: nextKind,
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                configurationId: configuration.configurationId,
                executionMode: configuration.executionMode,
                tddMode: configuration.tddMode,
                planId: plan.planId,
                planRevision: plan.revision,
                ...(nextPackage
                  ? {
                      packageId: nextPackage.packageId,
                      writeScopes: nextPackage.writeScopes,
                    }
                  : {}),
                stableInput: {
                  configurationDigest: configuration.semanticDigest,
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
            if (
              lifecycle.phase === 'build' &&
              lifecycle.currentWork?.kind === 'build.execute' &&
              current.workExecution?.status === 'outcome' &&
              current.workExecution.actionOutcome?.status === 'succeeded'
            ) {
              const protocol = lifecycle.buildProtocol;
              const configuration = protocol?.configuration;
              const plan = protocol?.plan;
              const result = current.workExecution.hostOutcome?.result;
              const invocationId = current.workExecution.hostOutcome?.invocationId;
              if (!protocol || !configuration || !plan || !invocationId) {
                throw new Error('Build Execute Outcome has no current Plan');
              }
              const invocationHost = current.workExecution.hostInvocation?.host;
              if (
                !invocationHost ||
                invocationHost.id !== current.workExecution.hostOutcome!.hostId
              ) {
                throw new Error('Build Execute Host does not match the persisted invocation');
              }
              this.assertFrozenBuildHost(configuration, invocationHost);
              await this.assertFrozenExecutionWorkspace(
                current,
                lifecycle,
                projectSnapshot,
                configuration,
              );
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
              const implementerExecutionIds = (
                current.workExecution.hostOutcome?.delegationReceipts ?? []
              )
                .filter((receipt) => receipt.role === 'implementer' && receipt.status === 'succeeded')
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
                tddMode: configuration.tddMode,
                ...(result.tddEvidence ? { tddEvidence: result.tddEvidence } : {}),
                repositoryDigest: result.repositoryDigest,
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
                const required = plan.packages.filter((entry) => entry.taskIds.includes(task.taskId));
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
                tddMode: configuration.tddMode,
              });
              const skills = await this.resolveLifecycleWorkSkills(
                nextKind,
                signal,
                composition.augmentationSkills,
              );
              const nextWork = createBuildActionWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                kind: nextKind,
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                configurationId: configuration.configurationId,
                executionMode: configuration.executionMode,
                tddMode: configuration.tddMode,
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
                      configurationDigest: configuration.semanticDigest,
                      planDigest: plan.digest,
                      packageDigest: nextPackage.digest,
                      completedPackageIds: [...completedIds].sort(),
                    }
                  : {
                      configurationDigest: configuration.semanticDigest,
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
              current.workExecution.actionOutcome?.status === 'succeeded'
            ) {
              const protocol = lifecycle.buildProtocol;
              const configuration = protocol?.configuration;
              const plan = protocol?.plan;
              const hostOutcome = current.workExecution.hostOutcome;
              const result = hostOutcome?.result;
              if (!protocol || !configuration || !plan || !hostOutcome) {
                throw new Error('Build Check Outcome has no current Plan');
              }
              const invocationHost = current.workExecution.hostInvocation?.host;
              if (!invocationHost || invocationHost.id !== hostOutcome.hostId) {
                throw new Error('Build Check Host does not match the persisted invocation');
              }
              this.assertFrozenBuildHost(configuration, invocationHost);
              await this.assertFrozenExecutionWorkspace(
                current,
                lifecycle,
                projectSnapshot,
                configuration,
              );
              if (result?.kind !== 'build-check-candidate') {
                throw new Error('Build Check Host must return a structured check candidate');
              }
              if (result.reviewerExecutionId !== hostOutcome.invocationId) {
                throw new Error('Build Check reviewer identity does not match the managed invocation');
              }
              if (
                protocol.packageCompletions.some(
                  (completion) => completion.executionId === result.reviewerExecutionId,
                )
              ) {
                throw new Error('Standard review requires an independent reviewer execution');
              }
              const expectedPackages = plan.packages.map((entry) => entry.packageId).sort();
              if (
                canonicalJson([...result.completedPackageIds].sort()) !==
                canonicalJson(expectedPackages)
              ) {
                throw new Error('Build Check does not cover every required package');
              }
              const expectedTasks = [...new Set(plan.packages.flatMap((entry) => entry.taskIds))].sort();
              if (
                canonicalJson([...result.acceptedTaskIds].sort()) !== canonicalJson(expectedTasks)
              ) {
                throw new Error('Build Check does not cover every Task acceptance');
              }
              if (result.repositoryDigest !== configuration.bindingDigest) {
                throw new Error('Build Check repository binding drifted');
              }
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
              const checkEvidence = createBuildCheckEvidence({
                configurationDigest: configuration.semanticDigest,
                planDigest: plan.digest,
                repositoryDigest: result.repositoryDigest,
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
              const validator = this.ctx.lifecycleValidators.resolve(
                lifecycle.currentWork.validatorProfile.id,
              );
              const validation = await validator.validate({
                profileId: lifecycle.currentWork.validatorProfile.id,
                work: lifecycle.currentWork,
                fact: checkEvidence,
              });
              if (!validation.accepted) {
                throw new Error(`Build Check Validator rejected: ${validation.diagnostic}`);
              }
              await this.ctx.workExecutionAuthority.markValidated({
                intent: await this.ctx.workExecutionAuthority.loadIntent(runId),
                validatorId: lifecycle.currentWork.validatorProfile.id,
                continuation: 'execute',
              });
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
                const planSkills = await this.resolveLifecycleWorkSkills('build.plan', signal);
                const planWork = createBuildActionWork({
                  runId,
                  checkEpoch: lifecycle.checkEpoch + 1,
                  definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                  kind: 'build.plan',
                  actionSkill: planSkills.actionSkill,
                  augmentationSkills: planSkills.augmentationSkills,
                  compositionDigest: current.composition.compositionDigest,
                  projectConfigDigest,
                  projectSnapshotDigest: current.projectSnapshotDigest,
                  workspaceRepositoryId,
                  repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
                  configurationId: configuration.configurationId,
                  executionMode: configuration.executionMode,
                  tddMode: configuration.tddMode,
                  planId: plan.planId,
                  planRevision: plan.revision,
                  stableInput: {
                    configurationDigest: configuration.semanticDigest,
                    planDigest: plan.digest,
                    invalidationDigest: invalidation.digest,
                  },
                });
                for (const skill of [planSkills.actionSkill, ...planSkills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
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
              const verifySkills = await this.resolveLifecycleWorkSkills('evidence.verify', signal);
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
              const skills = await this.resolveLifecycleWorkSkills('build.configure', signal);
              const initial = createInitialBuildWork({
                runId,
                checkEpoch: lifecycle.checkEpoch + 1,
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                taskSet,
                approvalHash,
                compositionDigest: current.composition.compositionDigest,
                projectConfigDigest,
                projectSnapshotDigest: current.projectSnapshotDigest,
                workspaceRepositoryId,
                repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
              });
              const planningDigest =
                assessment.snapshot?.planningManifestDigest ?? assessment.validation.validationDigest;
              build = {
                ...initial,
                protocol: createBuildProtocolState({
                  runId,
                  planningDigest,
                  workspaceIntent: lifecycle.workspaceIntent,
                }),
              };
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
    const continuation = await this.ctx.workExecutionAuthority.recovery(runId);
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
        continuation,
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
      const skills = await this.resolveLifecycleWorkSkills('evidence.verify', signal);
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
      !lifecycle.buildProtocol.configuration
    ) {
      throw new Error('Build Plan revision requires an approved Design digest');
    }
    const protocol = lifecycle.buildProtocol;
    const plan = protocol.plan!;
    const configuration = protocol.configuration!;
    const invalidation = createBuildInvalidation({
      source: 'verify',
      plan,
      classification: 'implementation',
      affectedPackageIds: plan.packages.map((workPackage) => workPackage.packageId),
      packageCompletions: protocol.packageCompletions,
      reason: 'Verify rejected the current implementation; conservatively revise all packages',
    });
    const skills = await this.resolveLifecycleWorkSkills('build.plan', signal);
    const work = createBuildActionWork({
      runId: state.runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      kind: 'build.plan',
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      compositionDigest: state.composition.compositionDigest,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      projectSnapshotDigest: state.projectSnapshotDigest,
      workspaceRepositoryId: specificationRoot.repositoryId,
      repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
      configurationId: configuration.configurationId,
      executionMode: configuration.executionMode,
      tddMode: configuration.tddMode,
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

  prepareArchiveDelivery(
    input: PrepareArchiveDeliveryInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const [state, evidence] = await Promise.all([
        this.ctx.runStore.loadRun(input.runId),
        this.ctx.evidenceCoordinator.status(input.attemptId),
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
      const refreshed = await this.ctx.evidenceCoordinator.plan(
        lifecycle.verificationInput.evidenceProfile.id,
      );
      if (
        refreshed.fingerprint.digest !==
        lifecycle.verificationInput.evidenceProfile.fingerprintDigest
      ) {
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
        const skills = await this.resolveLifecycleWorkSkills('evidence.verify', signal);
        const verificationInput = createVerificationInput({
          runId: input.runId,
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
                (candidate) =>
                  candidate.name === skill.name && candidate.provider === skill.provider,
              ) === index,
          ),
        });
        const work = createVerifyWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          verification: verificationInput,
          actionSkill: skills.actionSkill,
          augmentationSkills: skills.augmentationSkills,
          workspaceRepositoryId: specificationRoot.repositoryId,
          repositoryIds: refreshed.fingerprint.manifest.repositories.map(
            (repository) => repository.repositoryId,
          ),
        });
        for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
          await this.coordinator.bindSkill(input.runId, skill);
        }
        const fallback = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'archive-reverify-required',
          reason: 'Verification input changed before Archive side effects',
          verificationInput,
          work,
        });
        await this.ctx.workExecutionAuthority.recordWorkCreated(input.runId, work);
        return {
          ...fallback,
          value: await this.coordinator.status(input.runId),
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
      if (!evidence.bundle || !evidence.bundle.verificationReport) {
        throw new Error('Archive Delivery requires a completed formal verification report');
      }
      const planningApproval = await this.ctx.specificationPlanning.status(
        lifecycle.identity.changeId,
        'design',
      );
      if (
        !planningApproval ||
        planningApproval.status !== 'approved' ||
        planningApproval.decision?.decision !== 'approve' ||
        planningApproval.snapshot.changeId !== lifecycle.identity.changeId ||
        planningApproval.snapshot.compositionDigest !== state.composition.compositionDigest ||
        planningApproval.snapshot.projectConfigDigest !==
          state.trigger?.facts.projectConfigDigest ||
        canonicalJson(deliveryBranchCoordinates(planningApproval.snapshot.changeBranch)) !==
          canonicalJson(deliveryBranchCoordinates(input.intent.changeBranch))
      ) {
        throw new Error(
          `Archive Delivery requires the effective Design planning approval: ${lifecycle.identity.changeId}`,
        );
      }
      await this.ctx.delivery.validateArchiveIntent(
        input.intent,
        input.policy,
        planningApproval.snapshot.compositionDigest,
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
        planningCompositionDigest: planningApproval.snapshot.compositionDigest,
        evidenceCompositionDigest: lifecycle.verificationInput
          .compositionDigest as `sha256:${string}`,
      });
      const repositoryIds = Array.isArray(state.trigger?.facts.repositoryIds)
        ? state.trigger.facts.repositoryIds.filter(
            (repositoryId): repositoryId is string => typeof repositoryId === 'string',
          )
        : [];
      const archiveSkills = await this.resolveLifecycleWorkSkills('specification.close', signal);
      const work = createSpecificationCloseWork({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        checkEpoch: lifecycle.checkEpoch + 1,
        archive: archiveInput,
        actionSkill: archiveSkills.actionSkill,
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
        const skills = await this.resolveLifecycleWorkSkills('delivery.publish', signal);
        const restoredWork = createDeliveryPublishWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          archive: lifecycle.archiveDeliveryInput,
          closure: lifecycle.specificationClosure,
          actionSkill: skills.actionSkill,
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
      if (deliveryPolicyDigest(input.policy) !== archive.publicationPolicyDigest) {
        throw new Error('Archive Delivery policy changed after Work planning');
      }
      const currentWork = lifecycle.currentWork!;
      const execution = state.workExecution;
      if (
        !execution ||
        execution.workId !== currentWork.workId ||
        !['outcome', 'validated'].includes(execution.status) ||
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
        const skills = await this.resolveLifecycleWorkSkills('delivery.publish', signal);
        const publishWork = createDeliveryPublishWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          archive,
          closure,
          actionSkill: skills.actionSkill,
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
      const planningCompositionDigest =
        archive.planningCompositionDigest ?? planningApproval?.snapshot.compositionDigest;
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
          planningApproval.snapshot.projectConfigDigest !==
            state.trigger?.facts.projectConfigDigest ||
          canonicalJson(deliveryBranchCoordinates(archive.changeBranch)) !==
            canonicalJson(deliveryBranchCoordinates(planningApproval.snapshot.changeBranch)) ||
          archive.changeBranch.remoteOid === closure.candidate.baseOid
        ) {
          throw error;
        }
        const normalizeCorrection = (candidate: DeliveryIntentV3) => ({
          ...candidate,
          changeBranch: { ...candidate.changeBranch, remoteOid: '<corrected>' },
        });
        const correctedIntent: DeliveryIntentV3 = {
          ...intent,
          changeBranch: {
            ...structuredClone(intent.changeBranch),
            remoteOid: closure.candidate.baseOid,
          },
        };
        if (
          canonicalJson(normalizeCorrection(intent)) !==
          canonicalJson(normalizeCorrection(correctedIntent))
        ) {
          throw new Error(
            'Archive intent correction may change only the Change branch remote OID',
            {
              cause: error,
            },
          );
        }
        try {
          await this.ctx.delivery.validateArchiveIntent(
            correctedIntent,
            input.policy,
            planningApproval.snapshot.compositionDigest,
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
          const skills = await this.resolveLifecycleWorkSkills('specification.plan', signal);
          const designWork = createLifecyclePhaseWork({
            runId: input.runId,
            checkEpoch: lifecycle.checkEpoch + 1,
            changeId: lifecycle.identity.changeId,
            definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
            kind: 'specification.plan',
            actionSkill: skills.actionSkill,
            augmentationSkills: skills.augmentationSkills,
            compositionDigest: state.composition.compositionDigest,
            projectSnapshotDigest: state.projectSnapshotDigest,
            projectConfigDigest,
            workspaceRepositoryId: specificationRoot.repositoryId,
            repositoryIds: input.project.repositories.map((repository) => repository.id),
          });
          for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
            await this.coordinator.bindSkill(input.runId, skill);
          }
          const revised = await this.coordinator.acceptChangeObservation(input.runId, {
            kind: 'archive-planning-drift',
            work: designWork,
            observedPlanningDigest: planningApproval.snapshot.digest,
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
          planningCompositionDigest: planningApproval.snapshot.compositionDigest,
          evidenceCompositionDigest:
            archive.evidenceCompositionDigest ??
            (verificationCompositionDigest as `sha256:${string}`),
        });
        const skills = await this.resolveLifecycleWorkSkills('delivery.publish', signal);
        const correctedWork = createDeliveryPublishWork({
          definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
          checkEpoch: lifecycle.checkEpoch + 1,
          archive: correctedArchive,
          closure,
          actionSkill: skills.actionSkill,
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
                'Archive Change branch OID was rebound to the approved closure baseline before publication',
            },
          ],
        };
      }
      const publication = await this.ctx.delivery.publishArchive(
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
      let receipt: PublicationReceipt;
      {
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
              reason: reconciliation.changed ? 'project-drift' : 'content-missing-or-corrupt',
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
      const result = await this.coordinator.resume(options);
      let execution = await this.ctx.workExecutionAuthority.recovery(options.runId);
      if (result.value.reconciliation.changed) {
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
    const changedSkills: string[] = [];
    for (const expected of state.skillUsageSnapshots ?? []) {
      signal?.throwIfAborted();
      const definition = await this.ctx.skills.get(expected.name, {
        cwd: this.workspaceRoot,
        signal,
      });
      if (!definition) {
        changedSkills.push(expected.name);
        continue;
      }
      const current = await snapshotSkillDefinition(definition);
      if (!sameSkillUsageSnapshot(expected, current)) changedSkills.push(expected.name);
    }
    return changedSkills.length === 0
      ? { status: 'same', changedSkills: [], reason: 'used Skill snapshots are unchanged' }
      : {
          status: 'drifted',
          changedSkills,
          reason: `used Skill snapshots changed: ${changedSkills.join(', ')}`,
        };
  }

  private async assertSkillCompatibility(
    runId: string,
    signal?: AbortSignal,
  ): Promise<SkillCompatibility> {
    const compatibility = await this.skillCompatibility(runId, signal);
    if (compatibility.status === 'drifted') {
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
