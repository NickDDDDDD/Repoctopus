import { createHash, randomUUID } from 'node:crypto';

import { decide, recordOutcome, startRun } from '../engine/loop.js';
import type { ActionOutcome, EngineAction, RunState } from '../engine/types.js';
import { reconcileProjectSnapshots } from '../project/snapshot.js';
import type { ProjectSnapshot } from '../project/types.js';
import type { TrajectoryEvent, TrajectoryEventType } from '../trajectory/types.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import type { FileRuntimeStore } from '../../platform/runtime/file-runtime-store.js';
import type {
  ResumeView,
  RunStatusView,
  RuntimeDiagnostic,
  RuntimeResult,
  TelemetryPort,
  WorkflowSourcePort,
} from './types.js';

function stableEventId(...parts: string[]): string {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function event(options: {
  eventId: string;
  sequence: number;
  timestamp: string;
  type: TrajectoryEventType;
  state: RunState;
  data?: Record<string, unknown>;
}): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence: options.sequence,
    eventId: options.eventId,
    timestamp: options.timestamp,
    type: options.type,
    runId: options.state.runId,
    stateVersion: options.state.stateVersion,
    data: options.data ?? {},
  };
}

export class RepoctopusRuntime {
  constructor(
    private readonly store: FileRuntimeStore,
    private readonly telemetry: TelemetryPort,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = () => randomUUID(),
    private readonly workflowSource?: WorkflowSourcePort,
  ) {}

  async start(options: {
    workflow: WorkflowPackage;
    projectSnapshot: ProjectSnapshot;
    runId?: string;
    workflowSource?: string;
  }): Promise<RuntimeResult<RunStatusView>> {
    const timestamp = this.clock().toISOString();
    const state = startRun({
      workflow: options.workflow,
      runId: options.runId ?? this.uuid(),
      projectSnapshotDigest: options.projectSnapshot.digest,
      timestamp,
      ...(options.workflowSource ? { workflowSource: options.workflowSource } : {}),
    });
    const started = event({
      eventId: stableEventId(state.runId, 'run.started'),
      sequence: 1,
      timestamp,
      type: 'run.started',
      state,
      data: {
        workflowName: state.workflowName,
        workflowVersion: state.workflowVersion,
        workflowDigest: state.workflowDigest,
        projectSnapshotDigest: state.projectSnapshotDigest,
        repositoryCount: options.projectSnapshot.repositories.length,
      },
    });
    await this.store.initialize({
      state,
      workflow: options.workflow,
      projectSnapshot: options.projectSnapshot,
      event: started,
    });
    const diagnostics = await this.flushTelemetry(state.runId);
    return { value: await this.status(state.runId), diagnostics };
  }

  async status(runId: string): Promise<RunStatusView> {
    const [state, workflow, checkpoint, trajectory] = await Promise.all([
      this.store.loadRun(runId),
      this.store.loadWorkflow(runId),
      this.store.loadCheckpoint(runId),
      this.store.loadTrajectory(runId),
    ]);
    const preview = decide(workflow, state, state.updatedAt);
    const workflowDrift = await this.inspectWorkflowDrift(state);
    return {
      state,
      checkpoint,
      trajectoryLength: trajectory.length,
      nextAction: preview.action,
      workflowDrift,
      ...(preview.reason ? { reason: preview.reason } : {}),
    };
  }

  async next(
    runId: string,
    confirmations: ReadonlySet<string> = new Set(),
  ): Promise<RuntimeResult<RunStatusView>> {
    const [state, workflow, trajectory] = await Promise.all([
      this.store.loadRun(runId),
      this.store.loadWorkflow(runId),
      this.store.loadTrajectory(runId),
    ]);
    const timestamp = this.clock().toISOString();
    const decision = decide(workflow, state, timestamp, confirmations);
    if (!decision.action) {
      return {
        value: await this.status(runId),
        diagnostics: decision.reason
          ? [{ level: 'warning', code: 'runtime.no-action', message: decision.reason }]
          : [],
      };
    }
    const proposed = event({
      eventId: stableEventId(runId, String(state.stateVersion), decision.action.id, 'proposed'),
      sequence: trajectory.length + 1,
      timestamp,
      type: 'action.proposed',
      state: decision.state,
      data: { action: decision.action },
    });
    await this.store.commit({
      state: decision.state,
      event: proposed,
      previousStateVersion: state.stateVersion,
    });
    const diagnostics = await this.flushTelemetry(runId);
    return { value: await this.status(runId), diagnostics };
  }

  async record(options: {
    runId: string;
    actionId: string;
    status: ActionOutcome['status'];
    summary: string;
    eventId?: string;
  }): Promise<RuntimeResult<RunStatusView>> {
    const eventId = options.eventId ?? this.uuid();
    const duplicate = await this.store.findEvent(options.runId, eventId);
    if (duplicate) {
      return {
        value: await this.status(options.runId),
        diagnostics: [
          {
            level: 'info',
            code: 'runtime.idempotent-replay',
            message: `Event already recorded: ${eventId}`,
          },
        ],
      };
    }
    const [state, workflow, trajectory] = await Promise.all([
      this.store.loadRun(options.runId),
      this.store.loadWorkflow(options.runId),
      this.store.loadTrajectory(options.runId),
    ]);
    const timestamp = this.clock().toISOString();
    const outcome: ActionOutcome = {
      eventId,
      actionId: options.actionId,
      status: options.status,
      summary: options.summary,
    };
    const nextState = recordOutcome(workflow, state, outcome, timestamp);
    const completed = event({
      eventId,
      sequence: trajectory.length + 1,
      timestamp,
      type: 'action.completed',
      state: nextState,
      data: {
        actionId: options.actionId,
        result: options.status,
        summary: options.summary,
      },
    });
    await this.store.commit({
      state: nextState,
      event: completed,
      previousStateVersion: state.stateVersion,
    });
    const diagnostics = await this.flushTelemetry(options.runId);
    return { value: await this.status(options.runId), diagnostics };
  }

  async resume(options: {
    runId: string;
    currentProjectSnapshot: ProjectSnapshot;
  }): Promise<RuntimeResult<ResumeView>> {
    const recovered = await this.store.recover(options.runId);
    const [state, previousSnapshot, trajectory] = await Promise.all([
      this.store.loadRun(options.runId),
      this.store.loadProjectSnapshot(options.runId),
      this.store.loadTrajectory(options.runId),
    ]);
    const reconciliation = reconcileProjectSnapshots(
      previousSnapshot,
      options.currentProjectSnapshot,
    );
    const timestamp = this.clock().toISOString();
    const nextState: RunState = {
      ...state,
      reconciliationRequired: state.reconciliationRequired || reconciliation.changed,
      stateVersion: state.stateVersion + 1,
      updatedAt: timestamp,
    };
    const resumed = event({
      eventId: this.uuid(),
      sequence: trajectory.length + 1,
      timestamp,
      type: reconciliation.changed ? 'recovery.reconciled' : 'run.resumed',
      state: nextState,
      data: { recoveredTransition: recovered, reconciliation },
    });
    await this.store.commit({
      state: nextState,
      event: resumed,
      previousStateVersion: state.stateVersion,
    });
    const diagnostics: RuntimeDiagnostic[] = reconciliation.changed
      ? [
          {
            level: 'warning',
            code: 'runtime.project-changed',
            message:
              'Project repositories changed after the checkpoint; dependent decisions require reconciliation',
          },
        ]
      : [];
    diagnostics.push(...(await this.flushTelemetry(options.runId)));
    return {
      value: { ...(await this.status(options.runId)), reconciliation },
      diagnostics,
    };
  }

  private async flushTelemetry(runId: string): Promise<RuntimeDiagnostic[]> {
    try {
      const [cursor, run, workflow, projectSnapshot, trajectory] = await Promise.all([
        this.store.readTelemetryCursor(runId),
        this.store.loadRun(runId),
        this.store.loadWorkflow(runId),
        this.store.loadProjectSnapshot(runId),
        this.store.loadTrajectory(runId),
      ]);
      const events = trajectory.filter((item) => item.sequence > cursor.trajectoryOffset);
      if (events.length === 0) return [];
      await this.telemetry.export({ run, workflow, projectSnapshot, events, trajectory });
      const last = events.at(-1);
      if (!last) return [];
      await this.store.writeTelemetryCursor({
        schemaVersion: 1,
        runId,
        trajectoryOffset: last.sequence,
        updatedAt: this.clock().toISOString(),
      });
      return [];
    } catch (error) {
      return [
        {
          level: 'warning',
          code: 'telemetry.export-failed',
          message: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }

  private async inspectWorkflowDrift(state: RunState): Promise<RunStatusView['workflowDrift']> {
    const base = { expectedDigest: state.workflowDigest };
    if (!state.workflowSource || !this.workflowSource) {
      return { ...base, checked: false, changed: false };
    }
    try {
      const current = await this.workflowSource.load(state.workflowSource);
      return {
        ...base,
        checked: true,
        changed: current.digest !== state.workflowDigest,
        currentDigest: current.digest,
      };
    } catch (error) {
      return {
        ...base,
        checked: true,
        changed: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class NoopTelemetry implements TelemetryPort {
  async export(): Promise<void> {}
}

export function previewAction(status: RunStatusView): EngineAction | null {
  return status.nextAction;
}
