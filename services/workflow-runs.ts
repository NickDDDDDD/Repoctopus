import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';
import { isModelInvocable, type SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ActionOutcome, RunState, RunTriggerSnapshot } from '../domains/engine/types.js';
import type { BuildTaskValidation } from '../domains/change-lifecycle/build-validator.js';
import { validateBuildTaskOutcome } from '../domains/change-lifecycle/build-validator.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import type { ResumeView, RunStatusView, RuntimeResult } from '../domains/runtime/types.js';
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
import { createInitialBuildWork } from '../domains/change-lifecycle/build-work.js';
import { createVerificationInput } from '../domains/change-lifecycle/verification-input.js';
import { createVerifyWork } from '../domains/change-lifecycle/verify-work.js';
import { acceptVerifyGate, rejectVerifyGate } from '../domains/change-lifecycle/verify-gate.js';
import type { SpecificationTask } from '../domains/specification/types.js';
import type {
  ChangeLifecycleState,
  WorkDescriptor,
} from '../domains/change-lifecycle/transition.js';
import {
  createArchiveDeliveryInput,
  createArchiveDeliveryWork,
  createAwaitMergeWork,
} from '../domains/change-lifecycle/archive-input.js';
import type { DeliveryIntentV3, DeliveryPolicy } from '../domains/delivery/types.js';
import { deliveryPolicyDigest } from '../domains/delivery/snapshot.js';
import type { WorkExecutorIdentity } from '../domains/action/types.js';
import type { ArchivePublicationResult } from '../domains/delivery/service-v3.js';

export interface StartChangeRunInput {
  workspaceId: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
  changeId: string;
  generation: number;
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
  publication: ArchivePublicationResult;
  actionReceiptId: string;
  run: RunStatusView;
}

export class WorkflowRuns extends Service {
  static inject = [
    'actionDispatcher',
    'actionStore',
    'compositionIdentity',
    'delivery',
    'evidenceCoordinator',
    'project',
    'runStore',
    'skills',
    'specification',
    'specificationPlanning',
    'workflowTelemetry',
    'workflowSource',
    'workDispatcher',
  ];

  private readonly coordinator: WorkflowRunCoordinator;
  private readonly operations: OperationOwnership;
  private readonly workspaceRoot: string;

  constructor(context: Context, config: { workspaceRoot?: string } = {}) {
    super(context, 'workflowRuns');
    this.workspaceRoot = config.workspaceRoot ?? process.cwd();
    this.operations = bindOperationOwnership(context, 'workflowRuns');
    this.coordinator = new WorkflowRunCoordinator(
      context.runStore,
      context.workflowTelemetry,
      context.compositionIdentity.current(),
      undefined,
      undefined,
      context.workflowSource,
      context.get('evidenceCoordinator'),
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
      if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
        throw new Error('Change Run generation must be a positive safe integer');
      }
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
      const runId = changeRunId({ workspaceId, changeId, generation: input.generation });
      const lifecycle = createChangeLifecycleSnapshot({
        identity: {
          workspaceId,
          changeId,
          generation: input.generation,
          runId,
        },
      });
      const triggerFacts = {
        workspaceId,
        changeId,
        generation: input.generation,
        specificationRoot,
        targetBranch,
        repositoryIds,
        projectConfigDigest: input.projectConfigDigest,
        verificationProfileId: input.verificationProfileId,
      };
      return this.coordinator.startOrResume({
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
    });
  }

  status(runId: string, signal?: AbortSignal): Promise<RunStatusView> {
    return this.operations.run({ cancellable: true, signal }, async () => ({
      ...(await this.coordinator.status(runId)),
      skillCompatibility: await this.skillCompatibility(runId, signal),
      specificationCompatibility: await this.specificationCompatibility(runId),
    }));
  }

  decideChange(
    input: DecideChangeRunInput,
    signal?: AbortSignal,
  ): Promise<SpecificationApprovalState> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(input.runId);
      const lifecycle = state.changeLifecycle;
      if (
        !lifecycle ||
        lifecycle.phase !== 'design' ||
        state.status !== 'waiting' ||
        lifecycle.waitCondition?.kind !== 'human-decision'
      ) {
        throw new Error('Change Run is not waiting for a Design Human Decision');
      }
      if (
        input.response.requestId !== lifecycle.waitCondition.requestId ||
        input.response.proposalHash !== lifecycle.waitCondition.proposalDigest
      ) {
        throw new Error('Human Decision does not match the current Change Run proposal');
      }
      const decided = await this.ctx.specificationPlanning.decide({
        changeId: lifecycle.identity.changeId,
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

  private async assessChangeDesign(
    state: RunState,
    lifecycle: ChangeLifecycleState,
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
      throw new Error('Change Run is missing its stable Design input facts');
    }
    const targetBranch = target as {
      repositoryId: string;
      remote: string;
      targetBranch: string;
    };
    const projectSnapshot = await this.ctx.runStore.loadProjectSnapshot(
      lifecycle.identity.runId,
    );
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
        changeBranch,
        compositionDigest: state.composition.compositionDigest,
        projectConfigDigest: projectConfigDigest as `sha256:${string}`,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      assessment = {
        status: 'blocked',
        reason: error instanceof Error ? error.message : 'Design gate assessment failed',
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

  async next(
    runId: string,
    confirmations: ReadonlySet<string> = new Set(),
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(runId);
      if (state.changeLifecycle) {
        const diagnostics = [];
        let current = state;
        if (state.changeLifecycle.phase === 'open') {
          const opened = await this.coordinator.acceptChangeObservation(runId, {
            kind: 'open-intake-ready',
          });
          diagnostics.push(...opened.diagnostics);
          current = opened.value.state;
        }
        const lifecycle = current.changeLifecycle;
        if (!lifecycle) throw new Error(`Run is not a Change Run: ${runId}`);
        if (!['design', 'build', 'verify'].includes(lifecycle.phase)) {
          throw new Error('Change Run next Work is not available before lifecycle Work dispatch');
        }
        let build:
          | { tasks: SpecificationTask[]; work: WorkDescriptor }
          | undefined;
        const evaluated = await this.assessChangeDesign(current, lifecycle, signal);
        let assessment = evaluated.assessment;
        const { projectSnapshot, projectConfigDigest, workspaceRepositoryId } = evaluated;
        if (lifecycle.phase === 'build' || lifecycle.phase === 'verify') {
          const observedDigest =
            assessment.snapshot?.digest ??
            (`sha256:${createHash('sha256')
              .update(canonicalJson({ reason: assessment.reason }))
              .digest('hex')}` as const);
          if (
            assessment.status !== 'approved' ||
            observedDigest !== lifecycle.planningDigest
          ) {
            return this.coordinator.acceptChangeObservation(runId, {
              kind: 'planning-semantic-drift',
              reason: assessment.reason,
              evidenceIds: assessment.evidenceDigests,
              inputDigest: observedDigest,
            });
          }
          if (lifecycle.phase === 'build' && lifecycle.verificationInvalidation) {
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
              return this.coordinator.acceptChangeObservation(runId, {
                kind: 'build-task-ready',
                work: nextBuild.work,
                tasks: nextBuild.tasks,
              });
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
              tasks,
              fingerprint: planned.fingerprint,
              plan: planned.plan,
              projectConfigDigest,
              compositionDigest: current.composition.compositionDigest,
              skills: boundSkills,
            });
            const verifyWork = createVerifyWork({
              definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
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
            return this.coordinator.acceptChangeObservation(runId, {
              kind: 'build-verification-ready',
              verificationInput,
              work: verifyWork,
            });
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
            const skills = await this.resolveLifecycleWorkSkills('task.implement', signal);
            build = createInitialBuildWork({
              runId,
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
          } catch (error) {
            assessment = {
              status: 'blocked',
              reason:
                error instanceof Error ? error.message : 'Build Task planning failed',
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
            ? { tasks: build.tasks, work: build.work }
            : {}),
        });
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
    });
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
          (candidate) => candidate.taskId === observation.taskId && candidate.status === 'completed',
        );
        if (!task) throw new Error('Accepted Build Task completion has no Task projection');
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
      const completed = await this.ctx.specification.completeTask({
        changeId: lifecycle.identity.changeId,
        taskId: validation.taskId,
        taskRevision: validation.taskRevision,
        ...(signal ? { signal } : {}),
      });
      const advanced = await this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'build-task-completed',
        workId: validation.workId,
        taskId: validation.taskId,
        taskRevision: validation.taskRevision,
        inputDigest: lifecycle.currentWork.inputDigest,
        receiptId: receipt.receiptId,
        tasks: completed.tasks.tasks,
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
      const attemptId = input.attemptId ?? randomUUID();
      let result;
      try {
        result = input.attemptId
          ? await this.ctx.evidenceCoordinator.status(attemptId)
          : await this.ctx.evidenceCoordinator.run(
              current.verificationInput.evidenceProfile.id,
              attemptId,
              input.runId,
              signal,
            );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (!reason.includes('input fingerprint changed before Evidence execution')) throw error;
        const fallback = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'verify-gate-rejected',
          workId: current.currentWork.workId,
          inputDigest: current.verificationInput.digest,
          evidenceInputFingerprint: current.verificationInput.evidenceProfile.fingerprintDigest,
          attemptId,
          bundleId: null,
          reason,
          result: 'implementation-drift',
          workflowStateVersion: state.stateVersion,
        });
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
        workflowStateVersion: state.stateVersion,
        profileId: current.verificationInput.evidenceProfile.id,
        attemptId,
      });
      if (gate.status === 'blocked') {
        const rejected = rejectVerifyGate({
          runId: input.runId,
          lifecycle: current,
          gate,
          attemptId,
          workflowStateVersion: state.stateVersion,
        });
        const fallback = await this.coordinator.acceptChangeObservation(input.runId, {
          kind: 'verify-gate-rejected',
          ...rejected,
          ...(result.attempt.status === 'superseded'
            ? { result: 'implementation-drift' as const }
            : {}),
        });
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
        workflowStateVersion: state.stateVersion,
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
      if (!evidence.bundle || !evidence.bundle.verificationReport) {
        throw new Error('Archive Delivery requires a completed formal verification report');
      }
      const archiveInput = createArchiveDeliveryInput({
        runId: input.runId,
        changeId: lifecycle.identity.changeId,
        verificationInputDigest: lifecycle.verificationInput.digest,
        acceptedEvidenceBundleIds: state.acceptedEvidenceBundleIds,
        evidenceBundleId: evidence.bundle.bundleId,
        verificationReport: evidence.bundle.verificationReport,
        intent: input.intent,
        policy: input.policy,
      });
      const skills = await this.resolveLifecycleWorkSkills('delivery.prepare', signal);
      const repositoryIds = Array.isArray(state.trigger?.facts.repositoryIds)
        ? state.trigger.facts.repositoryIds.filter(
            (repositoryId): repositoryId is string => typeof repositoryId === 'string',
          )
        : [];
      const work = createArchiveDeliveryWork({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        archive: archiveInput,
        actionSkill: skills.actionSkill,
        workspaceRepositoryId: input.intent.changeBranch.repositoryId,
        repositoryIds,
      });
      await this.coordinator.bindSkill(input.runId, skills.actionSkill);
      return this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'archive-delivery-ready',
        archiveInput,
        work,
      });
    });
  }

  executeArchiveDelivery(
    input: ExecuteArchiveDeliveryInput,
    signal?: AbortSignal,
  ): Promise<RuntimeResult<ExecuteArchiveDeliveryResult>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(input.runId);
      const lifecycle = state.changeLifecycle;
      const archive = lifecycle?.archiveDeliveryInput;
      if (
        !lifecycle ||
        state.status !== 'running' ||
        lifecycle.phase !== 'archive' ||
        lifecycle.currentWork?.kind !== 'delivery.prepare' ||
        !archive
      ) {
        throw new Error(`Change Run has no active Archive Delivery Work: ${input.runId}`);
      }
      if (deliveryPolicyDigest(input.policy) !== archive.publicationPolicyDigest) {
        throw new Error('Archive Delivery policy changed after Work planning');
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
      const claim = await this.ctx.workDispatcher.claim({
        runId: input.runId,
        adapter: 'git',
        ...(input.attempt ? { attempt: input.attempt } : {}),
        executor: input.executor,
      });
      let publication: ArchivePublicationResult;
      try {
        publication = await this.ctx.delivery.publishArchive(
          {
            project: input.project,
            intent,
            policy: input.policy,
            reportContents: `verification-report:sha256:${archive.verificationReport.sha256}`,
            evidenceBundleIds: [archive.evidenceBundleId],
          },
          signal,
        );
      } catch (error) {
        await this.ctx.workDispatcher.acceptOutcome(
          this.ctx.workDispatcher.outcome(
            claim,
            'failed',
            error instanceof Error ? error.message : String(error),
          ),
        );
        throw error;
      }
      const accepted = await this.ctx.workDispatcher.acceptOutcome(
        this.ctx.workDispatcher.outcome(claim, 'succeeded', 'Archive publication completed'),
      );
      const waitWork = createAwaitMergeWork({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        archive,
        publication,
        workspaceRepositoryId: archive.changeBranch.repositoryId,
        repositoryIds: input.project.repositories.map((repository) => repository.id),
      });
      const advanced = await this.coordinator.acceptChangeObservation(input.runId, {
        kind: 'archive-publication-completed',
        archiveInputDigest: archive.digest,
        actionReceiptId: accepted.receipt.receiptId,
        publication,
        work: waitWork,
      });
      return {
        value: {
          publication,
          actionReceiptId: accepted.receipt.receiptId,
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
      await this.assertSkillCompatibility(options.runId, signal);
      await this.assertSpecificationCompatibility(options.runId);
      const result = await this.coordinator.resume(options);
      return {
        ...result,
        value: {
          ...result.value,
          skillCompatibility: await this.skillCompatibility(options.runId, signal),
          specificationCompatibility: await this.specificationCompatibility(options.runId),
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
