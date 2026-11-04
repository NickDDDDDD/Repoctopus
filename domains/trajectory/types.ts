import type { RunState } from '../engine/types.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationUsageSnapshot } from '../specification/types.js';
import type {
  ChangeLifecycleState,
  ChangeLifecycleTransitionFact,
} from '../change-lifecycle/transition.js';
import type { WorkExecutionCheckpoint } from '../work-execution/types.js';

export type TrajectoryEventType =
  | 'run.started'
  | 'action.proposed'
  | 'action.completed'
  | 'composition.changed'
  | 'skill.bound'
  | 'skill-composition.compiled'
  | 'skill-composition.rejected'
  | 'skill-composition.drifted'
  | 'skill-binding.resolved'
  | 'specification.bound'
  | 'specification.closure-planned'
  | 'change.lifecycle.transitioned'
  | 'run.resumed'
  | 'recovery.reconciled'
  | 'work.created'
  | 'work.packet-stored'
  | 'work.packet-recovered'
  | 'work.claim-rejected'
  | 'work.claimed'
  | 'work.context-delivered'
  | 'work.host-started'
  | 'work.host-completed'
  | 'work.outcome-submitted'
  | 'work.outcome-corrected'
  | 'work.outcome-rejected'
  | 'work.outcome-accepted'
  | 'work.outcome-processing-error'
  | 'delegation.completed'
  | 'work.completed'
  | 'skill.resolved'
  | 'skill.delivered'
  | 'skill.consumed'
  | 'skill.consumption-rejected'
  | 'skill.outcome-recorded'
  | 'tool.started'
  | 'tool.completed'
  | 'validator.completed'
  | 'wait.started'
  | 'wait.ended'
  | 'reconcile.started'
  | 'reconcile.completed'
  | 'desktop.activation'
  | 'specification.artifacts-observed'
  | 'specification.validation-observed'
  | 'continuation.selected';

export interface DesktopActivationFact {
  result: 'started' | 'activated' | 'unavailable' | 'unsupported';
  targetKind: 'override' | 'source' | 'installed-protocol' | 'none';
  reason:
    | 'new-instance'
    | 'existing-instance'
    | 'target-unavailable'
    | 'development-artifact-missing'
    | 'protocol-handler-unavailable'
    | 'launch-rejected'
    | 'launch-timeout'
    | 'platform-unsupported';
}

export interface TrajectoryEvent {
  schemaVersion: 1;
  sequence: number;
  eventId: string;
  timestamp: string;
  type: TrajectoryEventType;
  runId: string;
  stateVersion: number;
  compositionDigest: string;
  data: Record<string, unknown> & {
    changeLifecycleTransition?: ChangeLifecycleTransitionFact;
  };
}

export interface Checkpoint {
  schemaVersion: 1;
  runId: string;
  stateVersion: number;
  workflowDigest: string;
  compositionDigest: string;
  trajectoryOffset: number;
  projectSnapshotDigest: string;
  artifactManifestDigest: string;
  acceptedEvidenceBundleIds: string[];
  runStatus?: RunState['status'];
  changeLifecycle?: ChangeLifecycleState;
  skillUsageSnapshots?: SkillUsageSnapshot[];
  specificationUsageSnapshot?: SpecificationUsageSnapshot;
  workExecution?: WorkExecutionCheckpoint;
  createdAt: string;
}

export interface TransitionJournal {
  schemaVersion: 1;
  operationId: string;
  runId: string;
  previousStateVersion: number | null;
  nextState: RunState;
  event: TrajectoryEvent;
  checkpoint: Checkpoint;
}

export interface TelemetryDeliveryCursor {
  schemaVersion: 1;
  runId: string;
  trajectoryOffset: number;
  updatedAt: string;
}
