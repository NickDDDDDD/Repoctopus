import { randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';

import type { ActionOutcome, RunTriggerSnapshot } from '../domains/engine/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
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
  SpecificationClosurePlan,
  SpecificationUsageSnapshot,
  SpecificationValidation,
} from '../domains/specification/types.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';
import type { DesktopTelemetryEndpoint } from './desktop-telemetry-receiver.js';
import type { DesktopActivationResult } from './desktop-runtime.js';

export class WorkflowRuns extends Service {
  static inject = [
    'actionDispatcher',
    'compositionIdentity',
    'desktopLauncher',
    'desktopTelemetryDestination',
    'evidenceCoordinator',
    'runStore',
    'skills',
    'specification',
    'workflowTelemetry',
    'workflowSource',
  ];

  private readonly coordinator: WorkflowRunCoordinator;
  private readonly operations: OperationOwnership;
  private readonly workspaceRoot: string;
  private readonly workspaceId: string;

  constructor(
    context: Context,
    config: { workspaceRoot?: string; workspaceId?: string } = {},
  ) {
    super(context, 'workflowRuns');
    this.workspaceRoot = config.workspaceRoot ?? process.cwd();
    this.workspaceId = config.workspaceId ?? 'repoctopus';
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

  async start(
    options: {
      workflow: WorkflowPackage;
      projectSnapshot: ProjectSnapshot;
      runId?: string;
      workflowSource?: string;
      changeId?: string;
      trigger?: RunTriggerSnapshot;
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const runId = options.runId ?? randomUUID();
      const desktop = await this.prepareDesktop({
        schemaVersion: 1,
        workspaceId: this.workspaceId,
        runId,
        ...(options.changeId ? { changeId: options.changeId } : {}),
      });
      const result = await this.coordinator.start({ ...options, runId });
      const replayDiagnostics = desktop.receiver
        ? await this.replayDesktop(desktop.receiver)
        : [];
      return {
        ...result,
        diagnostics: [...desktop.diagnostics, ...result.diagnostics, ...replayDiagnostics],
      };
    });
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

  private async prepareDesktop(context: {
    schemaVersion: 1;
    workspaceId: string;
    runId: string;
    changeId?: string;
  }): Promise<{ diagnostics: RuntimeDiagnostic[]; receiver?: DesktopTelemetryEndpoint }> {
    let activation: DesktopActivationResult;
    try {
      activation = await this.ctx.desktopLauncher.activate(context);
    } catch {
      return {
        diagnostics: [
          {
            level: 'warning',
            code: 'desktop-activation-failed',
            message: 'Desktop Dashboard activation failed; the Run and remote telemetry continue.',
          },
        ],
      };
    }
    if (activation.status === 'unavailable') {
      return {
        diagnostics: [
          {
            level: 'warning',
            code: activation.diagnostic,
            message: 'Desktop Dashboard is unavailable; the Run and remote telemetry continue.',
          },
        ],
      };
    }
    const diagnostics = await this.replayDesktop(activation.receiver);
    return { diagnostics, receiver: activation.receiver };
  }

  private async replayDesktop(
    receiver: DesktopTelemetryEndpoint,
  ): Promise<RuntimeDiagnostic[]> {
    try {
      await this.ctx.desktopTelemetryDestination.replay(receiver);
      return [];
    } catch {
      return [
        {
          level: 'warning',
          code: 'desktop-telemetry-replay-failed',
          message: 'Desktop telemetry replay failed; the Run and remote telemetry continue.',
        },
      ];
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowRuns: WorkflowRuns;
  }
}
