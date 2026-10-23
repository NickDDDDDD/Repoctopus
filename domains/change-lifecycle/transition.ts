import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationArtifactKind } from '../specification/types.js';

export const CHANGE_PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
export type ChangePhase = (typeof CHANGE_PHASES)[number];

export const CHANGE_RUN_STATUSES = [
  'running',
  'waiting',
  'blocked',
  'completed',
  'failed',
  'migration_required',
] as const;
export type RunStatus = (typeof CHANGE_RUN_STATUSES)[number];

export interface ChangeLifecyclePhaseDefinition {
  phase: ChangePhase;
  workKinds: readonly string[];
  requiredValidatorProfiles: readonly string[];
  extensionCheckpoints: readonly string[];
}

export type ChangeLifecycleTransitionKind = 'advance' | 'self' | 'fallback' | 'complete';

export interface ChangeLifecycleTransitionDefinition {
  id: string;
  kind: ChangeLifecycleTransitionKind;
  from: {
    phase: ChangePhase;
    statuses: readonly RunStatus[];
  };
  to: {
    phase: ChangePhase;
    status: RunStatus;
  };
  trigger: string;
  requiredValidatorProfile?: string;
}

export interface ChangeLifecycleDefinition {
  schemaVersion: 1;
  id: string;
  version: string;
  phases: readonly ChangeLifecyclePhaseDefinition[];
  transitions: readonly ChangeLifecycleTransitionDefinition[];
}

export interface ChangeRunIdentity {
  workspaceId: string;
  changeId: string;
  generation: number;
  runId: string;
}

export interface ChangeLifecycleDefinitionSnapshot {
  id: string;
  version: string;
  digest: `sha256:${string}`;
}

export interface MethodProfileSnapshot {
  id: string;
  version: string;
  digest: `sha256:${string}`;
  sourceDigests: readonly `sha256:${string}`[];
  ruleIds: readonly string[];
}

export type WorkSideEffectClass =
  | 'none'
  | 'specification-write'
  | 'repository-write'
  | 'process'
  | 'git-publish'
  | 'platform-mutation';

export interface WorkWriteScope {
  repositoryId: string;
  paths: readonly string[];
  operations: readonly ('create' | 'update' | 'delete')[];
}

export interface WorkOutputContract {
  providerId?: string;
  artifactKinds: readonly SpecificationArtifactKind[];
  trackerPublish: boolean;
}

export interface ValidatorProfileSnapshot {
  id: string;
  version: string;
  digest: `sha256:${string}`;
}

export interface WorkDescriptor {
  schemaVersion: 1;
  workId: string;
  phase: ChangePhase;
  kind: string;
  taskId?: string;
  taskRevision?: `sha256:${string}`;
  actionSkill?: SkillUsageSnapshot;
  augmentationSkills: readonly SkillUsageSnapshot[];
  methodProfile: MethodProfileSnapshot;
  capabilities: readonly string[];
  sideEffectClass: WorkSideEffectClass;
  writeScopes: readonly WorkWriteScope[];
  inputDigest: `sha256:${string}`;
  outputContract: WorkOutputContract;
  validatorProfile: ValidatorProfileSnapshot;
  authorizationSource: {
    kind: 'lifecycle-definition';
    definitionId: string;
    definitionVersion: string;
  };
  checkpoint: string;
}

interface WaitConditionBase {
  schemaVersion: 1;
  waitId: string;
  reason: string;
  inputDigest: `sha256:${string}`;
}

export interface HumanDecisionWaitCondition extends WaitConditionBase {
  kind: 'human-decision';
  requestId: string;
  proposalDigest: `sha256:${string}`;
}

export interface PlatformEventWaitCondition extends WaitConditionBase {
  kind: 'platform-event';
  eventType: string;
  subjectDigest: `sha256:${string}`;
}

export interface RetryWaitCondition extends WaitConditionBase {
  kind: 'retry';
  notBefore: string;
  attempt: number;
}

export interface ExternalFactWaitCondition extends WaitConditionBase {
  kind: 'external-fact';
  providerId: string;
  factIdentityDigest: `sha256:${string}`;
}

export type WaitCondition =
  | HumanDecisionWaitCondition
  | PlatformEventWaitCondition
  | RetryWaitCondition
  | ExternalFactWaitCondition;

export interface ChangeRunBlocker {
  code: string;
  message: string;
  evidenceIds: readonly string[];
  sinceRevision: number;
}

export interface ChangeLifecycleState {
  schemaVersion: 1;
  identity: ChangeRunIdentity;
  definition: ChangeLifecycleDefinitionSnapshot;
  revision: number;
  phase: ChangePhase;
  currentWork: WorkDescriptor | null;
  waitCondition: WaitCondition | null;
  blocker: ChangeRunBlocker | null;
}

export interface ChangeLifecycleSnapshot extends ChangeLifecycleState {
  status: RunStatus;
}

export interface ChangeTaskProgress {
  total: number;
  completed: number;
  currentTaskId: string | null;
}

export interface ChangeEvidenceSummary {
  gateStatus: 'not-evaluated' | 'pending' | 'satisfied' | 'failed';
  acceptedBundleIds: readonly string[];
  latestAttemptId: string | null;
}

export interface ChangeNextAction {
  id: string;
  kind: 'work' | 'decision' | 'wait' | 'repair' | 'none';
  label: string;
}

export interface ChangeRunFreshness {
  stateVersion: number;
  trajectoryOffset: number;
  observedAt: string;
}

export interface ChangeRunProjection extends ChangeLifecycleSnapshot {
  taskProgress: ChangeTaskProgress;
  evidence: ChangeEvidenceSummary;
  nextActions: readonly ChangeNextAction[];
  freshness: ChangeRunFreshness;
}

export interface ChangeLifecycleTransitionFact {
  schemaVersion: 1;
  transitionId: string;
  definition: ChangeLifecycleDefinitionSnapshot;
  revision: number;
  from: { phase: ChangePhase; status: RunStatus };
  to: { phase: ChangePhase; status: RunStatus };
  workId: string | null;
  waitId: string | null;
}

const phaseSet = new Set<string>(CHANGE_PHASES);
const statusSet = new Set<string>(CHANGE_RUN_STATUSES);
const blockerStatuses = new Set<RunStatus>(['blocked', 'failed', 'migration_required']);

export function assertChangeLifecycleSnapshot(
  snapshot: ChangeLifecycleSnapshot,
): asserts snapshot is ChangeLifecycleSnapshot {
  if (!phaseSet.has(snapshot.phase)) throw new Error(`Unknown Change phase: ${snapshot.phase}`);
  if (!statusSet.has(snapshot.status))
    throw new Error(`Unknown Change Run status: ${snapshot.status}`);
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new Error('Change lifecycle revision must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(snapshot.identity.generation) || snapshot.identity.generation < 1) {
    throw new Error('Change lifecycle generation must be a positive safe integer');
  }
  if (snapshot.currentWork && snapshot.currentWork.phase !== snapshot.phase) {
    throw new Error('Current Work phase does not match the Change phase');
  }
  if (snapshot.status === 'waiting' && snapshot.waitCondition === null) {
    throw new Error('Waiting Change Run requires a durable WaitCondition');
  }
  if (snapshot.status !== 'waiting' && snapshot.waitCondition !== null) {
    throw new Error('Only a waiting Change Run may carry a WaitCondition');
  }
  if (blockerStatuses.has(snapshot.status) && snapshot.blocker === null) {
    throw new Error(`${snapshot.status} Change Run requires a blocker`);
  }
  if (!blockerStatuses.has(snapshot.status) && snapshot.blocker !== null) {
    throw new Error(`${snapshot.status} Change Run may not carry a blocker`);
  }
  if (
    snapshot.status === 'completed' &&
    (snapshot.phase !== 'archive' || snapshot.currentWork !== null)
  ) {
    throw new Error('A completed Change Run must finish in Archive with no current Work');
  }
}

export function applyChangeLifecycleTransition(options: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  transitionId: string;
  next: {
    currentWork: WorkDescriptor | null;
    waitCondition: WaitCondition | null;
    blocker: ChangeRunBlocker | null;
  };
}): { snapshot: ChangeLifecycleSnapshot; fact: ChangeLifecycleTransitionFact } {
  assertChangeLifecycleSnapshot(options.current);
  if (
    options.current.definition.id !== options.definition.id ||
    options.current.definition.version !== options.definition.version
  ) {
    throw new Error('Change lifecycle definition identity does not match the Run snapshot');
  }
  const matches = options.definition.transitions.filter(
    (candidate) => candidate.id === options.transitionId,
  );
  if (matches.length !== 1) {
    throw new Error(`Lifecycle transition must resolve exactly once: ${options.transitionId}`);
  }
  const transition = matches[0]!;
  if (
    transition.from.phase !== options.current.phase ||
    !transition.from.statuses.includes(options.current.status)
  ) {
    throw new Error(
      `Lifecycle transition ${transition.id} is not valid from ${options.current.phase}/${options.current.status}`,
    );
  }
  if (!options.definition.phases.some((entry) => entry.phase === transition.to.phase)) {
    throw new Error(`Lifecycle transition ${transition.id} targets an undeclared phase`);
  }
  const snapshot: ChangeLifecycleSnapshot = {
    ...structuredClone(options.current),
    revision: options.current.revision + 1,
    phase: transition.to.phase,
    status: transition.to.status,
    currentWork: structuredClone(options.next.currentWork),
    waitCondition: structuredClone(options.next.waitCondition),
    blocker: structuredClone(options.next.blocker),
  };
  assertChangeLifecycleSnapshot(snapshot);
  return {
    snapshot,
    fact: {
      schemaVersion: 1,
      transitionId: transition.id,
      definition: structuredClone(snapshot.definition),
      revision: snapshot.revision,
      from: { phase: options.current.phase, status: options.current.status },
      to: { phase: snapshot.phase, status: snapshot.status },
      workId: snapshot.currentWork?.workId ?? null,
      waitId: snapshot.waitCondition?.waitId ?? null,
    },
  };
}

export function projectChangeRun(
  snapshot: ChangeLifecycleSnapshot,
  details: {
    taskProgress: ChangeTaskProgress;
    evidence: ChangeEvidenceSummary;
    nextActions: readonly ChangeNextAction[];
    freshness: ChangeRunFreshness;
  },
): ChangeRunProjection {
  assertChangeLifecycleSnapshot(snapshot);
  if (
    details.taskProgress.total < 0 ||
    details.taskProgress.completed < 0 ||
    details.taskProgress.completed > details.taskProgress.total
  ) {
    throw new Error('Change task progress is outside its valid range');
  }
  return structuredClone({ ...snapshot, ...details });
}
