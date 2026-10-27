import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ActionOutcome, RunState, RunTriggerSnapshot } from '../domains/engine/types.js';
import type { BuildTaskValidation } from '../domains/change-lifecycle/build-validator.js';
import { validateBuildTaskOutcome } from '../domains/change-lifecycle/build-validator.js';
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
import { decisionKindForWaitId } from '../domains/telemetry/decision-trajectory.js';
import { DecisionTelemetryRecorder } from './decision-telemetry-recorder.js';
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
import { createInitialBuildWork } from '../domains/change-lifecycle/build-work.js';
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
import type { ActionIntent, WorkExecutorIdentity } from '../domains/action/types.js';
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
}

export interface DecideChangeRunInput {
  runId: string;
  response: SpecificationApprovalDecisionResponse;
  actor: SpecificationApprovalActor;
}

export interface ValidateBuildTaskInput {
  runId: string;
  receiptId: string;
}

export interface ValidateBuildTaskResult {
  validation: BuildTaskValidation;
  run: RunStatusView;
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
  private readonly decisionTelemetry: DecisionTelemetryRecorder;
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
    this.decisionTelemetry = new DecisionTelemetryRecorder(
      context.runStore,
      context.workflowTelemetry,
    );
  }

  private async validateLifecycleWork(input: {
    runId: string;
    work: WorkDescriptor;
    fact: unknown;
  }): Promise<{
    intent: ActionIntent;
    validation: { accepted: boolean; diagnostic: string };
  }> {
    const intent = await this.ctx.workExecutionAuthority.loadIntent(input.runId);
    await this.ctx.workExecutionAuthority.recordValidatorStarted({
      intent,
      validatorId: input.work.validatorProfile.id,
    });
    const validator = this.ctx.lifecycleValidators.resolve(input.work.validatorProfile.id);
    let validation: { accepted: boolean; diagnostic: string };
    try {
      validation = await validator.validate({
        profileId: input.work.validatorProfile.id,
        work: input.work,
        fact: input.fact,
      });
    } catch (error) {
      await this.ctx.workExecutionAuthority.recordValidatorCompleted({
        intent,
        validatorId: input.work.validatorProfile.id,
        result: 'failed',
        findingKind: 'validator-error',
      });
      throw error;
    }
    if (!validation.accepted) {
      await this.ctx.workExecutionAuthority.recordValidatorCompleted({
        intent,
        validatorId: input.work.validatorProfile.id,
        result: 'rejected',
        findingKind: 'contract-rejected',
      });
    }
    return { intent, validation };
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
      };
      const desktopActivation = await this.ctx.serial('repoctopus/desktop-before-change-run', {
        schemaVersion: 1,
        workspaceId,
        changeId,
        runId,
      });
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
      return {
        ...started,
        value: await this.coordinator.status(runId),
        diagnostics: [...(desktopActivation?.diagnostics ?? []), ...started.diagnostics],
      };
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
        lifecycle.waitCondition.waitId.startsWith('build-adoption:')
      ) {
        if (!input.actor.authenticated) throw new Error('Adopt-existing requires a trusted actor');
        if (
          input.response.requestId !== lifecycle.waitCondition.requestId ||
          input.response.proposalHash !== lifecycle.waitCondition.proposalDigest
        ) {
          throw new Error('Adopt-existing response does not match the current proposal');
        }
        const waitId = lifecycle.waitCondition.waitId;
        const decided = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'build-adoption-decision',
          decision: input.response.decision === 'approve' ? 'approve' : 'reject',
          requestId: input.response.requestId,
          proposalDigest: input.response.proposalHash,
          actorId: input.actor.actorId,
        });
        await this.decisionTelemetry.record({
          runId: input.runId,
          decisionId: input.response.requestId,
          kind: 'adopt-existing',
          stage: 'resolved',
          outcome: input.response.decision,
        });
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
        await this.decisionTelemetry.record({
          runId: input.runId,
          decisionId: input.response.requestId,
          kind: 'design-revision',
          stage: 'resolved',
          outcome: input.response.decision,
        });
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
      const decided = await this.ctx.specificationPlanning.decide({
        changeId: lifecycle.identity.changeId,
        approvalPhase: lifecycle.phase,
        response: input.response,
        actor: input.actor,
      });
      if (decided.decision?.proposalHash !== lifecycle.waitCondition.proposalDigest) {
        throw new Error('Recorded Human Decision does not match the current Change Run proposal');
      }
      await this.decisionTelemetry.record({
        runId: input.runId,
        decisionId: input.response.requestId,
        kind: lifecycle.phase === 'open' ? 'open-approval' : 'design-approval',
        stage: 'resolved',
        outcome: input.response.decision,
      });
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
        observation: 'unavailable',
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

  private async resolveLifecycleWorkSkills(
    kind: string,
    signal?: AbortSignal,
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
        work.augmentationSkills.map((skill) => resolve(skill.name)),
      ),
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
    const [receipt, change] = await Promise.all([
      this.ctx.actionStore.loadReceipt(state.runId, execution.receiptId),
      this.ctx.specification.inspect(lifecycle.identity.changeId, signal),
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
    const { intent, validation } = await this.validateLifecycleWork({
      runId: state.runId,
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
      preflightLifecycle?.phase === 'build' &&
      preflightLifecycle.currentWork &&
      preflight.workExecution?.workId === preflightLifecycle.currentWork.workId &&
      preflight.workExecution.checkEpoch === preflightLifecycle.checkEpoch &&
      preflight.workExecution?.status === 'outcome' &&
      preflight.workExecution.actionOutcome?.status === 'succeeded' &&
      preflight.workExecution.receiptId
    ) {
      const validated = await this.validateBuildTask(
        { runId, receiptId: preflight.workExecution.receiptId },
        signal,
      );
      const continuation = await this.ctx.workExecutionAuthority.recovery(runId);
      await this.ctx.workExecutionAuthority.recordContinuation(runId, continuation);
      return {
        diagnostics: validated.diagnostics,
        value: { ...validated.value.run, continuation },
      };
    }
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
                : work.phase === 'build' || work.phase === 'verify'
                  ? 'process'
                  : 'specification';
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
          let build: { tasks: SpecificationTask[]; work: WorkDescriptor | null } | undefined;
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
            if (assessment.observation === 'unavailable') {
              return {
                value: await this.coordinator.status(runId),
                diagnostics: [
                  {
                    level: 'warning',
                    code: 'change.planning-observation-unavailable',
                    message: `${assessment.reason}; the approved planning state was preserved and may be retried`,
                  },
                ],
              };
            }
            const observedDigest =
              assessment.snapshot?.digest ??
              (`sha256:${createHash('sha256')
                .update(canonicalJson({ reason: assessment.reason }))
                .digest('hex')}` as const);
            if (assessment.status !== 'approved' || observedDigest !== lifecycle.planningDigest) {
              const drift = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'planning-semantic-drift',
                reason: assessment.reason,
                evidenceIds: assessment.evidenceDigests,
                inputDigest: observedDigest,
              });
              return {
                ...drift,
                diagnostics: [
                  ...drift.diagnostics,
                  {
                    level: 'warning',
                    code: 'change.planning-semantic-drift',
                    message: `${assessment.reason}; approved=${lifecycle.planningDigest}; observed=${observedDigest}`,
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
            const tasks = lifecycle.tasks ?? [];
            if (tasks.some((task) => task.status !== 'completed')) {
              try {
                const approvalHash = assessment.approval?.decision?.approvalHash;
                if (!approvalHash) throw new Error('Approved Design has no approval hash');
                const taskSet = await this.ctx.specification.tasks(
                  lifecycle.identity.changeId,
                  signal,
                );
                const skills = await this.resolveLifecycleWorkSkills('task.implement', signal);
                const nextBuild = createInitialBuildWork({
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
                for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
                const created = await this.coordinator.acceptChangeObservation(runId, {
                  kind: 'build-task-ready',
                  work: nextBuild.work,
                  tasks: nextBuild.tasks,
                });
                await this.ctx.workExecutionAuthority.recordWorkCreated(runId, nextBuild.work);
                return { ...created, value: await this.coordinator.status(runId) };
              } catch (error) {
                throw new Error(
                  error instanceof Error ? error.message : 'Next Build Task planning failed',
                  { cause: error },
                );
              }
            }
            try {
              const profileId = current.trigger?.facts.verificationProfileId;
              if (typeof profileId !== 'string' || !profileId.trim()) {
                throw new Error('Verification Evidence Profile identity is missing');
              }
              const planned = await this.ctx.evidenceCoordinator.plan(profileId);
              const skills = await this.resolveLifecycleWorkSkills('evidence.verify', signal);
              const boundSkills = [
                ...(current.skillUsageSnapshots ?? []),
                skills.actionSkill,
                ...skills.augmentationSkills,
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
                tasks,
                fingerprint: planned.fingerprint,
                plan: planned.plan,
                projectConfigDigest,
                compositionDigest: current.composition.compositionDigest,
                skills: boundSkills,
              });
              const verifyWork = createVerifyWork({
                definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
                checkEpoch: lifecycle.checkEpoch + 1,
                verification: verificationInput,
                actionSkill: skills.actionSkill,
                augmentationSkills: skills.augmentationSkills,
                workspaceRepositoryId,
                repositoryIds: planned.fingerprint.manifest.repositories.map(
                  (repository) => repository.repositoryId,
                ),
              });
              for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                await this.coordinator.bindSkill(runId, skill);
              }
              const created = await this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-verification-ready',
                verificationInput,
                work: verifyWork,
              });
              await this.ctx.workExecutionAuthority.recordWorkCreated(runId, verifyWork);
              return { ...created, value: await this.coordinator.status(runId) };
            } catch (error) {
              return this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-verification-blocked',
                reason:
                  error instanceof Error ? error.message : 'Verification input preparation failed',
                evidenceIds: [],
              });
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
              const hasImportedClaims = taskSet.tasks.some(
                (task) =>
                  task.status === 'completed' && task.completion?.source === 'imported-claim',
              );
              if (hasImportedClaims || taskSet.tasks.every((task) => task.status === 'completed')) {
                build = { tasks: structuredClone(taskSet.tasks), work: null };
              } else {
                const skills = await this.resolveLifecycleWorkSkills('task.implement', signal);
                build = createInitialBuildWork({
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
                for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
                  await this.coordinator.bindSkill(runId, skill);
                }
              }
            } catch (error) {
              assessment = {
                observation: 'available',
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
            assessment.snapshot?.digest ??
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
            const { intent, validation } = await this.validateLifecycleWork({
              runId,
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
              intent,
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
              ? { tasks: build.tasks, ...(build.work ? { work: build.work } : {}) }
              : {}),
          });
          const importedClaims = advanced.value.state.changeLifecycle?.tasks?.filter(
            (task) => task.status === 'completed' && task.completion?.source === 'imported-claim',
          );
          if (advanced.value.state.changeLifecycle?.phase === 'build' && importedClaims?.length) {
            const proposalDigest = `sha256:${createHash('sha256')
              .update(
                canonicalJson({
                  kind: 'BuildCompletionClaimAdoption',
                  runId,
                  planningDigest: inputDigest,
                  tasks: importedClaims.map(({ taskId, taskRevision }) => ({
                    taskId,
                    taskRevision,
                  })),
                  repositories: projectSnapshot.repositories.map((repository) => repository.id),
                }),
              )
              .digest('hex')}` as const;
            const requestId = `adopt-existing:${proposalDigest.slice(-24)}`;
            const adoption = await this.coordinator.acceptChangeObservation(runId, {
              kind: 'build-adoption-required',
              requestId,
              proposalDigest,
              reason: 'Pre-completed OpenSpec Tasks require explicit completion-claim adoption',
            });
            return { ...adoption, value: await this.coordinator.status(runId) };
          }
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
      const decisionKind = decisionKindForWaitId(afterWait.waitId);
      if (decisionKind && afterWait.kind === 'human-decision') {
        await this.decisionTelemetry.record({
          runId,
          decisionId: afterWait.requestId,
          kind: decisionKind,
          stage: 'requested',
        });
      }
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
    if (!lifecycle.planningDigest)
      throw new Error('Repair Work requires an approved Design digest');
    const taskSet = await this.ctx.specification.tasks(lifecycle.identity.changeId, signal);
    const approved = new Map(
      (lifecycle.tasks ?? []).map((task) => [task.taskId, task.taskRevision]),
    );
    if (
      taskSet.tasks.length !== approved.size ||
      taskSet.tasks.some((task) => approved.get(task.taskId) !== task.taskRevision)
    ) {
      throw new Error('Repair Work Task revisions drifted from the approved Design');
    }
    const reopened = taskSet.tasks.map((task) => ({
      ...task,
      status: 'pending' as const,
      completion: null,
    }));
    const skills = await this.resolveLifecycleWorkSkills('task.implement', signal);
    const repair = createInitialBuildWork({
      runId: state.runId,
      checkEpoch: lifecycle.checkEpoch + 1,
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      actionSkill: skills.actionSkill,
      augmentationSkills: skills.augmentationSkills,
      taskSet: { ...taskSet, tasks: reopened },
      approvalHash: lifecycle.planningDigest,
      compositionDigest: state.composition.compositionDigest,
      projectConfigDigest: projectConfigDigest as `sha256:${string}`,
      projectSnapshotDigest: state.projectSnapshotDigest,
      workspaceRepositoryId: specificationRoot.repositoryId,
      repositoryIds: projectSnapshot.repositories.map((repository) => repository.id),
    });
    for (const skill of [skills.actionSkill, ...skills.augmentationSkills]) {
      await this.coordinator.bindSkill(state.runId, skill);
    }
    return repair;
  }

  validateBuildTask(
    input: ValidateBuildTaskInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<ValidateBuildTaskResult>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const [state, receipt] = await Promise.all([
        this.ctx.runStore.loadRun(input.runId),
        this.ctx.actionStore.loadReceipt(input.runId, input.receiptId),
      ]);
      const lifecycle = state.changeLifecycle;
      if (!lifecycle) throw new Error(`Run is not a Change Run: ${input.runId}`);
      if (!lifecycle.currentWork) {
        const trajectory = await this.ctx.runStore.loadTrajectory(input.runId);
        const accepted = trajectory.find((entry) => {
          const observation = entry.data.observation;
          return (
            entry.data.observationKind === 'build-task-completed' &&
            observation !== null &&
            typeof observation === 'object' &&
            'receiptId' in observation &&
            observation.receiptId === input.receiptId
          );
        });
        if (!accepted) throw new Error(`Run has no active Build Task Work: ${input.runId}`);
        const observation = accepted.data.observation as { taskId?: unknown };
        const task = lifecycle.tasks?.find(
          (candidate) =>
            candidate.taskId === observation.taskId && candidate.status === 'completed',
        );
        if (!task) throw new Error('Accepted Build Task completion has no Task projection');
        await this.ctx.workExecutionAuthority.recordTaskCompleted({
          runId: input.runId,
          task: { id: task.taskId, revision: task.taskRevision },
          receiptId: receipt.receiptId,
        });
        return {
          value: {
            validation: {
              status: 'already-completed',
              runId: input.runId,
              workId: receipt.workId,
              taskId: task.taskId,
              taskRevision: task.taskRevision,
              receiptId: receipt.receiptId,
              diagnostic: 'Build Task completion was already accepted',
            },
            run: await this.coordinator.status(input.runId),
          },
          diagnostics: [],
        };
      }
      const tasks = await this.ctx.specification.tasks(lifecycle.identity.changeId, signal);
      const validation = validateBuildTaskOutcome({ state, receipt, tasks });
      if (!['validated', 'already-completed'].includes(validation.status)) {
        return {
          value: { validation, run: await this.coordinator.status(input.runId) },
          diagnostics: [],
        };
      }
      if (
        state.workExecution?.status !== 'outcome' ||
        state.workExecution.hostOutcome?.status !== 'succeeded' ||
        state.workExecution.hostOutcome.invocationId !==
          state.workExecution.hostInvocation?.invocationId
      ) {
        throw new Error('Build Task validation requires a succeeded managed Host Outcome');
      }
      await this.ctx.specification.completeTask({
        changeId: lifecycle.identity.changeId,
        taskId: validation.taskId,
        taskRevision: validation.taskRevision,
        workId: validation.workId,
        ...(signal ? { signal } : {}),
      });
      const { intent, validation: validatorResult } = await this.validateLifecycleWork({
        runId: input.runId,
        work: lifecycle.currentWork,
        fact: {
          receiptId: receipt.receiptId,
          taskId: validation.taskId,
          taskRevision: validation.taskRevision,
        },
      });
      if (!validatorResult.accepted) {
        throw new Error(`Build Validator rejected: ${validatorResult.diagnostic}`);
      }
      await this.ctx.workExecutionAuthority.markValidated({
        intent,
        validatorId: lifecycle.currentWork.validatorProfile.id,
        continuation: 'execute',
      });
      const projectedTasks = (lifecycle.tasks ?? []).map((task) =>
        task.taskId === validation.taskId
          ? {
              ...task,
              status: 'completed' as const,
              completion: { source: 'runtime-work' as const, workId: validation.workId },
            }
          : task,
      );
      const advanced = await this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'build-task-completed',
        workId: validation.workId,
        taskId: validation.taskId,
        taskRevision: validation.taskRevision,
        inputDigest: lifecycle.currentWork.inputDigest,
        receiptId: receipt.receiptId,
        tasks: projectedTasks,
      });
      await this.ctx.workExecutionAuthority.recordTaskCompleted({
        runId: input.runId,
        task: { id: validation.taskId, revision: validation.taskRevision },
        receiptId: receipt.receiptId,
      });
      return {
        value: { validation, run: advanced.value },
        diagnostics: advanced.diagnostics,
      };
    });
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
        const { intent, validation } = await this.validateLifecycleWork({
          runId: input.runId,
          work: current.currentWork,
          fact: { receiptId: execution.receiptId, review: 'host-succeeded' },
        });
        if (!validation.accepted) {
          throw new Error(`Verify Validator rejected: ${validation.diagnostic}`);
        }
        await this.ctx.workExecutionAuthority.markValidated({
          intent,
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
        if (classification === 'implementation-failure' && continuation.tasks) {
          await this.ctx.workExecutionAuthority.recordTasksReopened({
            runId: input.runId,
            tasks: (lifecycle.tasks ?? []).map((task) => ({
              id: task.taskId,
              revision: task.taskRevision,
            })),
            recovery: {
              kind: 'fallback',
              sourcePhase: 'verify',
              evidence: {
                attemptId,
                inputFingerprint: current.verificationInput.evidenceProfile.fingerprintDigest,
              },
              continuation: {
                work: { id: continuation.work.workId, kind: continuation.work.kind },
                ...(continuation.work.taskId && continuation.work.taskRevision
                  ? {
                      task: {
                        id: continuation.work.taskId,
                        revision: continuation.work.taskRevision,
                      },
                    }
                  : {}),
                checkEpoch: continuation.work.checkEpoch,
              },
            },
          });
        }
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
        await this.ctx.workExecutionAuthority.recordTasksReopened({
          runId: input.runId,
          tasks: (lifecycle.tasks ?? []).map((task) => ({
            id: task.taskId,
            revision: task.taskRevision,
          })),
          recovery: {
            kind: 'fallback',
            sourcePhase: 'verify',
            evidence: {
              attemptId,
              bundleId: gate.bundleId,
              inputFingerprint: current.verificationInput.evidenceProfile.fingerprintDigest,
            },
            continuation: {
              work: { id: continuation.work.workId, kind: continuation.work.kind },
              ...(continuation.work.taskId && continuation.work.taskRevision
                ? {
                    task: {
                      id: continuation.work.taskId,
                      revision: continuation.work.taskRevision,
                    },
                  }
                : {}),
              checkEpoch: continuation.work.checkEpoch,
            },
          },
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
        const { intent, validation } = await this.validateLifecycleWork({
          runId: input.runId,
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
          intent,
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
          await this.ctx.workExecutionAuthority.recordTasksReopened({
            runId: input.runId,
            tasks: (lifecycle.tasks ?? []).map((task) => ({
              id: task.taskId,
              revision: task.taskRevision,
            })),
            recovery: {
              kind: 'fallback',
              sourcePhase: 'archive',
              evidence: {
                ids: [archive.digest, closure.closureId, planningApproval.snapshot.digest],
              },
              continuation: {
                work: { id: designWork.workId, kind: designWork.kind },
                checkEpoch: designWork.checkEpoch,
              },
            },
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
