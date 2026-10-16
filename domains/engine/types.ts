import type { WorkflowAction } from '../workflow-contract/types.js';

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface RunState {
  schemaVersion: 1;
  runId: string;
  workflowName: string;
  workflowVersion: string;
  workflowDigest: string;
  workflowSource: string | null;
  projectSnapshotDigest: string;
  traceId: string;
  currentStep: string | null;
  iteration: number;
  pendingActionId: string | null;
  reconciliationRequired: boolean;
  stateVersion: number;
  status: RunStatus;
  retries: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface EngineAction extends WorkflowAction {
  id: string;
  stepId: string;
}

export interface ActionOutcome {
  eventId: string;
  actionId: string;
  status: 'succeeded' | 'failed';
  summary: string;
}

export interface EngineDecision {
  state: RunState;
  action: EngineAction | null;
  reason?: string;
}

export interface EvalDefinition {
  id: string;
  field: keyof RunState;
  equals: string;
}

export interface EvalResult {
  evalId: string;
  passed: boolean;
  evidence: string;
}
