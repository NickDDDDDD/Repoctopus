import type { EngineAction, RunState } from '../engine/types.js';
import type { EvidenceGateProjection } from '../evidence/types.js';
import type { ProjectReconciliation, ProjectSnapshot } from '../project/types.js';
import type { Checkpoint, TrajectoryEvent } from '../trajectory/types.js';
import type { TelemetryDeliveryCursor } from '../trajectory/types.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';
import type { CompositionCompatibility } from '../composition/types.js';

export interface RuntimeDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface RuntimeResult<T> {
  value: T;
  diagnostics: RuntimeDiagnostic[];
}

export interface RunStatusView {
  state: RunState;
  checkpoint: Checkpoint;
  trajectoryLength: number;
  nextAction: EngineAction | null;
  workflowDrift: {
    checked: boolean;
    changed: boolean;
    expectedDigest: string;
    currentDigest?: string;
    message?: string;
  };
  compositionCompatibility: CompositionCompatibility;
  reason?: string;
}

export interface ResumeView extends RunStatusView {
  reconciliation: ProjectReconciliation;
}

export interface TelemetryBatch {
  run: RunState;
  workflow: WorkflowPackage;
  projectSnapshot: ProjectSnapshot;
  events: TrajectoryEvent[];
  trajectory: TrajectoryEvent[];
}

export interface TelemetryPort {
  export(batch: TelemetryBatch): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface WorkflowSourcePort {
  load(source: string): Promise<WorkflowPackage>;
}

export interface EvidenceGatePort {
  evaluate(input: {
    workflowRunId: string;
    workflowActionId: string;
    workflowStepId: string;
    workflowStateVersion: number;
    profileId: string;
    attemptId: string;
  }): Promise<EvidenceGateProjection>;
}

export interface RunStoreInspection {
  state: RunState | null;
  checkpoint: Checkpoint | null;
  trajectory: TrajectoryEvent[];
  cursor: TelemetryDeliveryCursor;
  pendingTransition: boolean;
}

export interface RunStorePort {
  initialize(options: {
    state: RunState;
    workflow: WorkflowPackage;
    projectSnapshot: ProjectSnapshot;
    event: TrajectoryEvent;
  }): Promise<void>;
  loadRun(runId: string): Promise<RunState>;
  loadWorkflow(runId: string): Promise<WorkflowPackage>;
  loadProjectSnapshot(runId: string): Promise<ProjectSnapshot>;
  loadCheckpoint(runId: string): Promise<Checkpoint>;
  loadTrajectory(runId: string): Promise<TrajectoryEvent[]>;
  findEvent(runId: string, eventId: string): Promise<TrajectoryEvent | null>;
  commit(options: {
    state: RunState;
    event: TrajectoryEvent;
    previousStateVersion: number | null;
  }): Promise<void>;
  commitGuarded<T>(
    runId: string,
    operation: (current: {
      state: RunState;
      workflow: WorkflowPackage;
      trajectory: TrajectoryEvent[];
    }) => Promise<{ state: RunState; event: TrajectoryEvent; value: T }>,
  ): Promise<T>;
  recover(runId: string): Promise<boolean>;
  readTelemetryCursor(runId: string): Promise<TelemetryDeliveryCursor>;
  writeTelemetryCursor(cursor: TelemetryDeliveryCursor): Promise<void>;
  inspect(runId: string): Promise<RunStoreInspection>;
  evidenceRetentionState(): Promise<{ deferred: boolean; acceptedBundleIds: string[] }>;
}
