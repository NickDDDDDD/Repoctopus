import type { WorkflowAction } from '../workflow-contract/types.js';
import type { CompositionIdentitySnapshot } from '../composition/types.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationUsageSnapshot } from '../specification/types.js';
import type {
  ChangeLifecycleState,
  RunStatus as ChangeLifecycleRunStatus,
} from '../change-lifecycle/transition.js';
import type { LifecycleContributorSnapshot } from '../change-lifecycle/contributors.js';

export type RunStatus = ChangeLifecycleRunStatus;

export interface RunTriggerSnapshot {
  schemaVersion: 1;
  kind: string;
  identityDigest: `sha256:${string}`;
  facts: Record<string, unknown>;
}

export interface RunState {
  schemaVersion: 1;
  runId: string;
  workflowName: string;
  workflowVersion: string;
  workflowDigest: string;
  workflowSource: string | null;
  composition: CompositionIdentitySnapshot;
  lifecycleContributorSnapshot?: LifecycleContributorSnapshot;
  projectSnapshotDigest: string;
  trigger?: RunTriggerSnapshot;
  traceId: string;
  currentStep: string | null;
  iteration: number;
  pendingActionId: string | null;
  reconciliationRequired: boolean;
  stateVersion: number;
  status: RunStatus;
  retries: Record<string, number>;
  acceptedEvidenceBundleIds: string[];
  changeLifecycle?: ChangeLifecycleState;
  skillUsageSnapshots?: SkillUsageSnapshot[];
  specificationUsageSnapshot?: SpecificationUsageSnapshot;
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
