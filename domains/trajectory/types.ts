import type { RunState } from '../engine/types.js';
import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationUsageSnapshot } from '../specification/types.js';
import type {
  ChangeLifecycleState,
  ChangeLifecycleTransitionFact,
} from '../change-lifecycle/transition.js';

export type TrajectoryEventType =
  | 'run.started'
  | 'action.proposed'
  | 'action.completed'
  | 'composition.changed'
  | 'skill.bound'
  | 'specification.bound'
  | 'specification.closure-planned'
  | 'change.lifecycle.transitioned'
  | 'run.resumed'
  | 'recovery.reconciled';

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
