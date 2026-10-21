import { Service, type Context } from '@deepseek-ai/cordis';

import type { RunState } from '../domains/engine/types.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import type { RunStoreInspection, RunStorePort } from '../domains/runtime/types.js';
import type {
  Checkpoint,
  TelemetryDeliveryCursor,
  TrajectoryEvent,
} from '../domains/trajectory/types.js';
import type { WorkflowPackage } from '../domains/workflow-contract/types.js';

export abstract class RunStore extends Service implements RunStorePort {
  protected abstract readonly port: RunStorePort;

  constructor(context: Context) {
    super(context, 'runStore');
  }

  initialize(options: {
    state: RunState;
    workflow: WorkflowPackage;
    projectSnapshot: ProjectSnapshot;
    event: TrajectoryEvent;
  }): Promise<void> {
    return this.port.initialize(options);
  }

  loadRun(runId: string): Promise<RunState> {
    return this.port.loadRun(runId);
  }

  loadWorkflow(runId: string): Promise<WorkflowPackage> {
    return this.port.loadWorkflow(runId);
  }

  loadProjectSnapshot(runId: string): Promise<ProjectSnapshot> {
    return this.port.loadProjectSnapshot(runId);
  }

  loadCheckpoint(runId: string): Promise<Checkpoint> {
    return this.port.loadCheckpoint(runId);
  }

  loadTrajectory(runId: string): Promise<TrajectoryEvent[]> {
    return this.port.loadTrajectory(runId);
  }

  findEvent(runId: string, eventId: string): Promise<TrajectoryEvent | null> {
    return this.port.findEvent(runId, eventId);
  }

  commit(options: {
    state: RunState;
    event: TrajectoryEvent;
    previousStateVersion: number | null;
  }): Promise<void> {
    return this.port.commit(options);
  }

  commitGuarded<T>(
    runId: string,
    operation: (current: {
      state: RunState;
      workflow: WorkflowPackage;
      trajectory: TrajectoryEvent[];
    }) =>
      | Promise<
          | { state: RunState; event: TrajectoryEvent; value: T }
          | { state?: never; event?: never; value: T }
        >
      | { state: RunState; event: TrajectoryEvent; value: T }
      | { state?: never; event?: never; value: T },
  ): Promise<T> {
    return this.port.commitGuarded(runId, operation);
  }

  recover(runId: string): Promise<boolean> {
    return this.port.recover(runId);
  }

  readTelemetryCursor(runId: string): Promise<TelemetryDeliveryCursor> {
    return this.port.readTelemetryCursor(runId);
  }

  writeTelemetryCursor(cursor: TelemetryDeliveryCursor): Promise<void> {
    return this.port.writeTelemetryCursor(cursor);
  }

  inspect(runId: string): Promise<RunStoreInspection> {
    return this.port.inspect(runId);
  }

  evidenceRetentionState(): Promise<{ deferred: boolean; acceptedBundleIds: string[] }> {
    return this.port.evidenceRetentionState();
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    runStore: RunStore;
  }
}
