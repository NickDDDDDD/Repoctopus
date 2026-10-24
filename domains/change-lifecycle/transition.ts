import type { SkillUsageSnapshot } from '../skill/types.js';
import type { SpecificationArtifactKind } from '../specification/types.js';
import type { SpecificationTask } from '../specification/types.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { VerificationInput } from './verification-input.js';

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
  works: readonly ChangeLifecycleWorkDefinition[];
  transitions: readonly ChangeLifecycleTransitionDefinition[];
}

export interface LifecycleSkillReference {
  name: string;
}

export interface LifecycleWriteScopeDefinition {
  repositorySelector: 'workspace' | 'all-repositories';
  paths: readonly string[];
  operations: readonly ('create' | 'update' | 'delete')[];
}

export interface ChangeLifecycleWorkDefinition {
  kind: string;
  phase: ChangePhase;
  actionSkill?: LifecycleSkillReference;
  augmentationSkills: readonly LifecycleSkillReference[];
  methodProfile: MethodProfileSnapshot;
  capabilities: readonly string[];
  sideEffectClass: WorkSideEffectClass;
  writeScopes: readonly LifecycleWriteScopeDefinition[];
  outputContract: WorkOutputContract;
  validatorProfile: ValidatorProfileSnapshot;
  checkpoint: string;
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
  tasks?: readonly SpecificationTask[];
  planningDigest?: `sha256:${string}`;
  verificationInput?: VerificationInput;
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
  invalidation?: {
    kind: 'planning-semantic-drift';
    supersededPlanningDigest: `sha256:${string}`;
    observedPlanningDigest: `sha256:${string}`;
    supersededWorkId: string | null;
    supersededTaskRevisions: readonly `sha256:${string}`[];
    evidenceIds: readonly string[];
  };
}

export type ChangeLifecycleObservation =
  | { kind: 'open-intake-ready' }
  | {
      kind: 'planning-semantic-drift';
      reason: string;
      evidenceIds: readonly string[];
      inputDigest: `sha256:${string}`;
    }
  | {
      kind: 'design-gate';
      result: 'blocked' | 'waiting' | 'approved';
      reason: string;
      evidenceIds: readonly string[];
      inputDigest: `sha256:${string}`;
      requestId?: string;
      proposalDigest?: `sha256:${string}`;
      tasks?: readonly SpecificationTask[];
      work?: WorkDescriptor;
    }
  | {
      kind: 'build-task-completed';
      workId: string;
      taskId: string;
      taskRevision: `sha256:${string}`;
      inputDigest: `sha256:${string}`;
      receiptId: string;
      tasks: readonly SpecificationTask[];
    }
  | {
      kind: 'build-task-ready';
      work: WorkDescriptor;
      tasks: readonly SpecificationTask[];
    }
  | {
      kind: 'build-verification-ready';
      verificationInput: VerificationInput;
      work: WorkDescriptor;
    }
  | {
      kind: 'build-verification-blocked';
      reason: string;
      evidenceIds: readonly string[];
    }
  | {
      kind: 'verify-gate-satisfied';
      workId: string;
      inputDigest: `sha256:${string}`;
      attemptId: string;
      bundleId: string;
      evidenceInputFingerprint: string;
      workflowStateVersion: number;
    };

export interface ChangeLifecycleReduction {
  snapshot: ChangeLifecycleSnapshot;
  fact: ChangeLifecycleTransitionFact | null;
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
  if (snapshot.currentWork?.taskId) {
    const task = snapshot.tasks?.find(
      (candidate) => candidate.taskId === snapshot.currentWork?.taskId,
    );
    if (!task || task.taskRevision !== snapshot.currentWork.taskRevision) {
      throw new Error('Current Work does not match the persisted Task revision');
    }
  }
  if (
    snapshot.phase === 'verify' &&
    ((snapshot.verificationInput && !snapshot.currentWork) ||
      (!snapshot.verificationInput && snapshot.currentWork) ||
      (snapshot.verificationInput &&
        snapshot.currentWork &&
        snapshot.currentWork.inputDigest !== snapshot.verificationInput.digest))
  ) {
    throw new Error('Verify phase requires a Work bound to the immutable verification input');
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
    tasks?: readonly SpecificationTask[];
    planningDigest?: `sha256:${string}` | null;
    verificationInput?: VerificationInput | null;
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
    ...(options.next.tasks ? { tasks: structuredClone(options.next.tasks) } : {}),
  };
  if (options.next.planningDigest === null) delete snapshot.planningDigest;
  else if (options.next.planningDigest) snapshot.planningDigest = options.next.planningDigest;
  if (options.next.verificationInput === null) delete snapshot.verificationInput;
  else if (options.next.verificationInput) {
    snapshot.verificationInput = structuredClone(options.next.verificationInput);
  }
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

export function evolveChangeLifecycle(options: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  observation: ChangeLifecycleObservation;
}): ChangeLifecycleReduction {
  const { current, observation } = options;
  if (observation.kind === 'open-intake-ready') {
    if (current.phase !== 'open' || current.status !== 'running') {
      throw new Error(`Open intake is not valid from ${current.phase}/${current.status}`);
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'open.intake-ready',
      next: { currentWork: null, waitCondition: null, blocker: null },
    });
  }
  if (observation.kind === 'planning-semantic-drift') {
    if (current.phase !== 'build' && current.phase !== 'verify') {
      throw new Error(
        `Planning semantic drift is not valid from ${current.phase}/${current.status}`,
      );
    }
    if (!current.planningDigest) {
      throw new Error('Active Build or Verify Work has no approved planning digest');
    }
    const supersededPlanningDigest = current.planningDigest;
    const supersededWorkId = current.currentWork?.workId ?? null;
    const supersededTaskRevisions = (current.tasks ?? [])
      .map((task) => task.taskRevision)
      .sort();
    const reduced = applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId:
        current.phase === 'build'
          ? 'build.semantic-plan-drift'
          : 'verify.semantic-plan-drift',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
        tasks: [],
        planningDigest: null,
        verificationInput: null,
      },
    });
    reduced.fact.invalidation = {
      kind: 'planning-semantic-drift',
      supersededPlanningDigest,
      observedPlanningDigest: observation.inputDigest,
      supersededWorkId,
      supersededTaskRevisions,
      evidenceIds: [...observation.evidenceIds],
    };
    return reduced;
  }
  if (observation.kind === 'build-task-completed') {
    if (current.phase !== 'build' || current.status !== 'running') {
      throw new Error(`Build Task completion is not valid from ${current.phase}/${current.status}`);
    }
    const existing = current.tasks?.find((task) => task.taskId === observation.taskId);
    if (
      existing?.status === 'completed' &&
      existing.taskRevision === observation.taskRevision &&
      current.currentWork === null
    ) {
      return { snapshot: structuredClone(current), fact: null };
    }
    const work = current.currentWork;
    if (
      !work ||
      work.workId !== observation.workId ||
      work.taskId !== observation.taskId ||
      work.taskRevision !== observation.taskRevision ||
      work.inputDigest !== observation.inputDigest
    ) {
      throw new Error('Build Task completion does not match the active Work');
    }
    const currentTasks = current.tasks ?? [];
    if (
      currentTasks.length !== observation.tasks.length ||
      currentTasks.some((task, index) => {
        const observed = observation.tasks[index];
        return (
          !observed ||
          observed.taskId !== task.taskId ||
          observed.taskRevision !== task.taskRevision ||
          (task.taskId !== observation.taskId && observed.status !== task.status)
        );
      })
    ) {
      throw new Error('Build Task completion changed the approved Task set');
    }
    const completed = observation.tasks.find((task) => task.taskId === observation.taskId);
    if (completed?.status !== 'completed') {
      throw new Error('Build Task completion projection did not mark the Task complete');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.task-completed',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
        tasks: observation.tasks,
      },
    });
  }
  if (observation.kind === 'build-task-ready') {
    if (
      current.phase !== 'build' ||
      current.status !== 'running' ||
      current.currentWork !== null
    ) {
      throw new Error(`Build Task dispatch is not valid from ${current.phase}/${current.status}`);
    }
    const currentTasks = current.tasks ?? [];
    if (
      currentTasks.length !== observation.tasks.length ||
      currentTasks.some((task, index) => {
        const observed = observation.tasks[index];
        return (
          !observed ||
          observed.taskId !== task.taskId ||
          observed.taskRevision !== task.taskRevision ||
          observed.status !== task.status
        );
      })
    ) {
      throw new Error('Next Build Work changed the approved Task projection');
    }
    const task = observation.tasks.find((candidate) => candidate.taskId === observation.work.taskId);
    if (
      observation.work.phase !== 'build' ||
      observation.work.kind !== 'task.implement' ||
      task?.status !== 'pending' ||
      task.taskRevision !== observation.work.taskRevision
    ) {
      throw new Error('Next Build Work does not bind a pending Task revision');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.task-ready',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        tasks: observation.tasks,
      },
    });
  }
  if (observation.kind === 'build-verification-blocked') {
    if (current.phase !== 'build' || !['running', 'blocked'].includes(current.status)) {
      throw new Error(
        `Build verification blocking is not valid from ${current.phase}/${current.status}`,
      );
    }
    if ((current.tasks ?? []).some((task) => task.status !== 'completed')) {
      throw new Error('Build verification input may not be prepared before all Tasks complete');
    }
    const blocker: ChangeRunBlocker = {
      code: 'build.verification-input-incomplete',
      message: observation.reason,
      evidenceIds: [...observation.evidenceIds],
      sinceRevision: current.revision + 1,
    };
    if (
      current.status === 'blocked' &&
      current.blocker?.code === blocker.code &&
      current.blocker.message === blocker.message
    ) {
      return { snapshot: structuredClone(current), fact: null };
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.verification-blocked',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker,
        verificationInput: null,
      },
    });
  }
  if (observation.kind === 'build-verification-ready') {
    if (current.phase !== 'build' || !['running', 'blocked'].includes(current.status)) {
      throw new Error(
        `Build verification input is not valid from ${current.phase}/${current.status}`,
      );
    }
    if (
      current.currentWork !== null ||
      (current.tasks ?? []).length === 0 ||
      (current.tasks ?? []).some((task) => task.status !== 'completed')
    ) {
      throw new Error('Build verification input requires all Tasks complete and no active Work');
    }
    if (
      observation.work.phase !== 'verify' ||
      observation.work.kind !== 'evidence.verify' ||
      observation.work.inputDigest !== observation.verificationInput.digest
    ) {
      throw new Error('Verify Work does not bind the immutable verification input');
    }
    const taskRevisions = (current.tasks ?? [])
      .map(({ taskId, taskRevision }) => ({ taskId, taskRevision }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId));
    if (canonicalJson(taskRevisions) !== canonicalJson(observation.verificationInput.taskRevisions)) {
      throw new Error('Verification input Task revisions do not match the completed Task set');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'build.validated',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        verificationInput: observation.verificationInput,
      },
    });
  }
  if (observation.kind === 'verify-gate-satisfied') {
    if (current.phase !== 'verify' || current.status !== 'running') {
      throw new Error(`Verify Gate is not valid from ${current.phase}/${current.status}`);
    }
    const work = current.currentWork;
    const verification = current.verificationInput;
    if (
      !work ||
      work.kind !== 'evidence.verify' ||
      work.workId !== observation.workId ||
      work.inputDigest !== observation.inputDigest ||
      !verification ||
      verification.digest !== observation.inputDigest ||
      verification.evidenceProfile.fingerprintDigest !== observation.evidenceInputFingerprint
    ) {
      throw new Error('Satisfied Verify Gate does not match the active verification input');
    }
    if (!observation.attemptId.trim() || !observation.bundleId.trim()) {
      throw new Error('Satisfied Verify Gate requires Evidence attempt and Bundle identities');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'verify.satisfied',
      next: {
        currentWork: null,
        waitCondition: null,
        blocker: null,
      },
    });
  }
  if (current.phase !== 'design') {
    throw new Error(`Design gate is not valid from ${current.phase}/${current.status}`);
  }
  if (observation.result === 'approved') {
    if (!observation.work || !observation.tasks || observation.tasks.length === 0) {
      throw new Error('Approved Design gate requires the first fixed Build Work');
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'design.approved',
      next: {
        currentWork: observation.work,
        waitCondition: null,
        blocker: null,
        tasks: observation.tasks,
        planningDigest: observation.inputDigest,
      },
    });
  }
  if (observation.result === 'waiting') {
    if (!observation.requestId?.trim() || !observation.proposalDigest) {
      throw new Error('Waiting Design gate requires a Human Decision request identity');
    }
    const waitCondition: HumanDecisionWaitCondition = {
      schemaVersion: 1,
      waitId: `design-approval:${observation.requestId}`,
      kind: 'human-decision',
      reason: observation.reason,
      inputDigest: observation.inputDigest,
      requestId: observation.requestId,
      proposalDigest: observation.proposalDigest,
    };
    if (
      current.status === 'waiting' &&
      current.waitCondition?.kind === 'human-decision' &&
      current.waitCondition.waitId === waitCondition.waitId &&
      current.waitCondition.inputDigest === waitCondition.inputDigest
    ) {
      return { snapshot: structuredClone(current), fact: null };
    }
    return applyChangeLifecycleTransition({
      definition: options.definition,
      current,
      transitionId: 'design.await-approval',
      next: { currentWork: null, waitCondition, blocker: null, planningDigest: null },
    });
  }
  const blocker: ChangeRunBlocker = {
    code: 'design.planning-invalid',
    message: observation.reason,
    evidenceIds: [...observation.evidenceIds],
    sinceRevision: current.revision + 1,
  };
  if (
    current.status === 'blocked' &&
    current.blocker?.code === blocker.code &&
    current.blocker.message === blocker.message &&
    current.blocker.evidenceIds.join('\u0000') === blocker.evidenceIds.join('\u0000')
  ) {
    return { snapshot: structuredClone(current), fact: null };
  }
  return applyChangeLifecycleTransition({
    definition: options.definition,
    current,
    transitionId: 'design.invalid',
    next: {
      currentWork: null,
      waitCondition: null,
      blocker,
      planningDigest: null,
    },
  });
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
