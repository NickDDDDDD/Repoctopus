import { randomUUID } from 'node:crypto';

import { Service, type Context } from '@deepseek-ai/cordis';

import type { ActionOutcome } from '../domains/engine/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import type { ResumeView, RunStatusView, RuntimeResult } from '../domains/runtime/types.js';
import type { WorkflowPackage } from '../domains/workflow-contract/types.js';
import { bindOperationOwnership, type OperationOwnership } from './operation-ownership.js';

export class WorkflowRuns extends Service {
  static inject = [
    'actionDispatcher',
    'compositionIdentity',
    'evidenceCoordinator',
    'runStore',
    'workflowTelemetry',
    'workflowSource',
  ];

  private readonly coordinator: WorkflowRunCoordinator;
  private readonly operations: OperationOwnership;

  constructor(context: Context) {
    super(context, 'workflowRuns');
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
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.coordinator.start(options),
    );
  }

  status(runId: string, signal?: AbortSignal): Promise<RunStatusView> {
    return this.operations.run({ cancellable: true, signal }, () => this.coordinator.status(runId));
  }

  async next(
    runId: string,
    confirmations: ReadonlySet<string> = new Set(),
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const result = await this.coordinator.next(runId, confirmations);
      const action = result.value.nextAction;
      if (action && result.value.state.pendingActionId === action.id) {
        await this.ctx.actionDispatcher.propose(runId, action, result.value.state.composition);
      }
      return result;
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
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<RunStatusView>> {
    return this.operations.run({ cancellable: false, signal }, async () => {
      const eventId = options.eventId ?? randomUUID();
      const receipt = await this.ctx.actionDispatcher.completeManual({
        runId: options.runId,
        actionId: options.actionId,
        status: options.status,
        summary: options.summary,
        eventId,
      });
      return this.coordinator.record({
        ...options,
        eventId,
        actionReceiptId: receipt.receiptId,
      });
    });
  }

  resume(
    options: {
      runId: string;
      currentProjectSnapshot: ProjectSnapshot;
    },
    signal?: AbortSignal,
  ): Promise<RuntimeResult<ResumeView>> {
    return this.operations.run({ cancellable: false, signal }, () =>
      this.coordinator.resume(options),
    );
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowRuns: WorkflowRuns;
  }
}
