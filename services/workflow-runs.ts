import { createHash, randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ActionOutcome, RunTriggerSnapshot } from '../domains/engine/types.js';
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
  SpecificationClosurePlan,
  SpecificationUsageSnapshot,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import {
  changeRunId,
  createChangeRunHostWorkflow,
} from '../domains/change-lifecycle/host-workflow.js';

export interface StartChangeRunInput {
  workspaceId: string;
  workspaceRepositoryId: string;
  repositoryIds: readonly string[];
  changeId: string;
  generation: number;
  targetBranch: string;
  remote: string;
  projectSnapshot: ProjectSnapshot;
}

export class WorkflowRuns extends Service {
  static inject = [
    'actionDispatcher',
    'compositionIdentity',
    'evidenceCoordinator',
    'project',
    'runStore',
    'skills',
    'specification',
    'workflowTelemetry',
    'workflowSource',
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

  async next(
    runId: string,
    confirmations: ReadonlySet<string> = new Set(),
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const state = await this.ctx.runStore.loadRun(runId);
      if (state.changeLifecycle) {
        throw new Error('Change Run next Work is not available before lifecycle Work dispatch');
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
