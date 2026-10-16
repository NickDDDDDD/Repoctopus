import type { EngineAction, RunState } from '../engine/types.js';
import type { ProjectReconciliation, ProjectSnapshot } from '../project/types.js';
import type { Checkpoint, TrajectoryEvent } from '../trajectory/types.js';
import type { WorkflowPackage } from '../workflow-contract/types.js';

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
