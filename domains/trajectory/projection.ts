import { CHANGE_PHASES, type ChangePhase } from '../change-lifecycle/transition.js';
import type {
  ObservationBuildAction,
  ObservationEnvelope,
  ObservationScalar,
} from './observation.js';

export const PROJECTION_BUILD_ACTIONS = [
  'configure',
  'plan',
  'plan-evidence',
  'execute',
  'check',
] as const satisfies readonly ObservationBuildAction[];

export type ProjectedTimelineState =
  | 'not-reported'
  | 'pending'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'rework'
  | 'completed'
  | 'failed';

export type DashboardDisplayState =
  | 'sparse'
  | 'catching-up'
  | 'live'
  | 'stale'
  | 'gap'
  | 'error'
  | 'stalled'
  | 'waiting'
  | 'rework'
  | 'complete'
  | 'failed';

export interface ProjectedAttempt {
  attempt: number;
  state: ProjectedTimelineState;
  enteredAt: string;
  lastObservedAt: string;
  exitedAt: string | null;
}

export interface ProjectedPhase {
  phase: ChangePhase;
  state: ProjectedTimelineState;
  attempts: ProjectedAttempt[];
  latestObservedAt: string | null;
}

export interface ProjectedBuildAction {
  action: ObservationBuildAction;
  state: ProjectedTimelineState;
  attempts: ProjectedAttempt[];
  latestObservedAt: string | null;
}

export interface ProjectedWork {
  workId: string;
  workKind: string | null;
  packageId: string | null;
  taskId: string | null;
  attempt: number | null;
  hostId: string | null;
  validatorId: string | null;
  continuation: string | null;
  state: ProjectedTimelineState;
  startedAt: string;
  latestObservedAt: string;
  completedAt: string | null;
}

export interface ProjectedSkill {
  name: string;
  role: 'action' | 'augmentation';
  workId: string;
  state: 'not-reported' | 'resolved' | 'delivered' | 'consumed' | 'failed';
  resolvedAt: string | null;
  deliveredAt: string | null;
  consumedAt: string | null;
  failedAt: string | null;
}

export interface ProjectedDecision {
  decisionId: string;
  kind: string;
  state: 'waiting' | 'resolved';
  startedAt: string;
  endedAt: string | null;
}

export interface ProjectedArtifact {
  artifactId: string;
  artifactType: string | null;
  artifactSize: number | null;
  mediaType: string | null;
  redacted: boolean | null;
  observedAt: string;
}

export interface ProjectedEvidence {
  attemptId: string;
  gateId: string | null;
  gateStatus: string | null;
  status: string | null;
  artifacts: ProjectedArtifact[];
  latestObservedAt: string;
}

export interface ProjectedRecovery {
  eventId: string;
  kind: 'fallback' | 'recovery';
  fromPhase: ChangePhase | null;
  toPhase: ChangePhase | null;
  packageId: string | null;
  findingKind: string | null;
  observedAt: string;
}

export interface ProjectedDestinationHealth {
  destinationId: string;
  mode: string | null;
  backlog: number | null;
  oldestAgeMs: number | null;
  lastResult: string | null;
  warningCode: string | null;
  droppedEnvelopes: number | null;
  observedAt: string;
}

export interface ProjectedHealthReason {
  code: string;
  phase?: ChangePhase;
  workId?: string;
  evidenceAttemptId?: string;
  destinationId?: string;
  count?: number;
  durationMs?: number;
  category?: string;
}

export interface ProjectedHealthDimension {
  status: 'not-reported' | 'healthy' | 'attention' | 'critical';
  reasons: ProjectedHealthReason[];
}

export interface ProjectedHealth {
  transition: ProjectedHealthDimension;
  execution: ProjectedHealthDimension;
  quality: ProjectedHealthDimension;
  telemetry: ProjectedHealthDimension;
}

export interface ProjectedChange {
  workspaceId: string;
  changeId: string;
  runId: string;
  phase: ChangePhase | null;
  buildAction: ObservationBuildAction | null;
  status: string | null;
  workId: string | null;
  taskId: string | null;
  attempt: number | null;
  hostId: string | null;
  validatorId: string | null;
  continuation: string | null;
  phases: ProjectedPhase[];
  buildActions: ProjectedBuildAction[];
  works: ProjectedWork[];
  currentWork: ProjectedWork | null;
  skills: ProjectedSkill[];
  decisions: ProjectedDecision[];
  evidence: ProjectedEvidence[];
  recoveries: ProjectedRecovery[];
  destinations: ProjectedDestinationHealth[];
  health: ProjectedHealth;
  displayState: DashboardDisplayState;
  latestSequence: number;
  latestObservedAt: string;
}

export interface ChangeProjectionSnapshot {
  schemaVersion: 1;
  version: number;
  changes: ProjectedChange[];
  freshness: {
    status: 'empty' | 'catching-up' | 'live' | 'stale' | 'gap' | 'error';
    missing: number[];
  };
  seenEnvelopeIds: string[];
  receivedSequences: Record<string, number[]>;
}

/** Bounded transport snapshot; deduplication and gap bookkeeping remain Host-internal. */
export function changeProjectionView(snapshot: ChangeProjectionSnapshot): ChangeProjectionSnapshot {
  return {
    schemaVersion: 1,
    version: snapshot.version,
    changes: structuredClone(snapshot.changes),
    freshness: structuredClone(snapshot.freshness),
    seenEnvelopeIds: [],
    receivedSequences: {},
  };
}

export interface ChangeProjectionDelta {
  schemaVersion: 1;
  previousVersion: number;
  version: number;
  eventId: string;
  runId: string;
  changeKey: string | null;
  freshness: ChangeProjectionSnapshot['freshness'];
}

export interface ChangeProjectionReduction {
  snapshot: ChangeProjectionSnapshot;
  delta: ChangeProjectionDelta | null;
}

const STALLED_WORK_MS = 15 * 60 * 1_000;

function emptyHealth(): ProjectedHealth {
  const dimension = (): ProjectedHealthDimension => ({ status: 'not-reported', reasons: [] });
  return {
    transition: dimension(),
    execution: dimension(),
    quality: dimension(),
    telemetry: dimension(),
  };
}

function emptyPhases(): ProjectedPhase[] {
  return CHANGE_PHASES.map((phase) => ({
    phase,
    state: 'not-reported',
    attempts: [],
    latestObservedAt: null,
  }));
}

function emptyBuildActions(): ProjectedBuildAction[] {
  return PROJECTION_BUILD_ACTIONS.map((action) => ({
    action,
    state: 'not-reported',
    attempts: [],
    latestObservedAt: null,
  }));
}

export function createEmptyChangeProjection(): ChangeProjectionSnapshot {
  return {
    schemaVersion: 1,
    version: 0,
    changes: [],
    freshness: { status: 'empty', missing: [] },
    seenEnvelopeIds: [],
    receivedSequences: {},
  };
}

function gaps(sequencesByRun: Readonly<Record<string, readonly number[]>>): number[] {
  const missing = new Set<number>();
  for (const sequences of Object.values(sequencesByRun)) {
    if (sequences.length === 0) continue;
    const known = new Set(sequences);
    const maximum = Math.max(...sequences);
    for (let sequence = 1; sequence <= maximum; sequence += 1) {
      if (!known.has(sequence)) missing.add(sequence);
    }
  }
  return [...missing].sort((left, right) => left - right);
}

function projectionKey(envelope: ObservationEnvelope): string | null {
  const { workspaceId, changeId } = envelope.correlation;
  return workspaceId && changeId ? `${workspaceId}\0${changeId}\0${envelope.identity.runId}` : null;
}

function stringAttribute(
  attributes: Readonly<Record<string, ObservationScalar>>,
  key: string,
): string | null {
  const value = attributes[key];
  return typeof value === 'string' ? value : null;
}

function numberAttribute(
  attributes: Readonly<Record<string, ObservationScalar>>,
  key: string,
): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanAttribute(
  attributes: Readonly<Record<string, ObservationScalar>>,
  key: string,
): boolean | null {
  const value = attributes[key];
  return typeof value === 'boolean' ? value : null;
}

function changePhase(value: string | null): ChangePhase | null {
  return value !== null && CHANGE_PHASES.includes(value as ChangePhase)
    ? (value as ChangePhase)
    : null;
}

function resultState(value: string | null): ProjectedTimelineState | null {
  if (value === null) return null;
  if (['completed', 'complete', 'succeeded', 'accepted', 'approved', 'satisfied'].includes(value)) {
    return 'completed';
  }
  if (['failed', 'failure', 'rejected', 'error'].includes(value)) return 'failed';
  if (value === 'blocked') return 'blocked';
  if (value === 'waiting' || value === 'ask' || value === 'wait') return 'waiting';
  if (value === 'pending') return 'pending';
  if (value === 'running' || value === 'active' || value === 'execute') return 'running';
  return null;
}

function updateAttempt(
  attempts: ProjectedAttempt[],
  attempt: number,
  state: ProjectedTimelineState,
  observedAt: string,
): ProjectedAttempt {
  let current = attempts.find((candidate) => candidate.attempt === attempt);
  if (current === undefined) {
    current = {
      attempt,
      state,
      enteredAt: observedAt,
      lastObservedAt: observedAt,
      exitedAt: null,
    };
    attempts.push(current);
    attempts.sort((left, right) => left.attempt - right.attempt);
  } else {
    current.state = state;
    current.lastObservedAt = observedAt;
  }
  if (state === 'completed' || state === 'failed' || state === 'rework') {
    current.exitedAt = observedAt;
  }
  return current;
}

function nextAttempt(attempts: readonly ProjectedAttempt[]): number {
  return (attempts.at(-1)?.attempt ?? 0) + 1;
}

function phaseIndex(phase: ChangePhase): number {
  return CHANGE_PHASES.indexOf(phase);
}

function projectPhases(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const targetPhase = envelope.correlation.phase ?? null;
  if (targetPhase === null) return;
  const target = change.phases.find((candidate) => candidate.phase === targetPhase)!;
  const fromPhase = changePhase(stringAttribute(envelope.attributes, 'fromPhase'));
  const fallback =
    stringAttribute(envelope.attributes, 'observationKind')?.includes('fallback') === true ||
    (fromPhase !== null && phaseIndex(fromPhase) > phaseIndex(targetPhase));

  if (envelope.eventType === 'change.lifecycle.transitioned' && fromPhase !== null) {
    const from = change.phases.find((candidate) => candidate.phase === fromPhase)!;
    const fromAttempt = from.attempts.at(-1)?.attempt ?? 1;
    const leavingState: ProjectedTimelineState =
      fromPhase === targetPhase
        ? (resultState(stringAttribute(envelope.attributes, 'fromStatus')) ?? 'running')
        : fallback
          ? 'rework'
          : 'completed';
    updateAttempt(from.attempts, fromAttempt, leavingState, envelope.observedAt);
    from.state = leavingState;
    from.latestObservedAt = envelope.observedAt;
  }

  const explicit = resultState(
    stringAttribute(envelope.attributes, 'toStatus') ??
      stringAttribute(envelope.attributes, 'status') ??
      stringAttribute(envelope.attributes, 'result'),
  );
  const state: ProjectedTimelineState = fallback ? 'rework' : (explicit ?? 'running');
  const revisiting =
    fromPhase !== null && fromPhase !== targetPhase && target.attempts.length > 0 && fallback;
  const attempt = revisiting
    ? nextAttempt(target.attempts)
    : (target.attempts.at(-1)?.attempt ?? 1);
  updateAttempt(target.attempts, attempt, state, envelope.observedAt);
  target.state = state;
  target.latestObservedAt = envelope.observedAt;
}

function workState(envelope: ObservationEnvelope): ProjectedTimelineState {
  const explicit = resultState(
    stringAttribute(envelope.attributes, 'result') ??
      stringAttribute(envelope.attributes, 'status') ??
      stringAttribute(envelope.attributes, 'outcome'),
  );
  if (explicit !== null) return explicit;
  if (envelope.eventType === 'work.created') return 'pending';
  if (envelope.eventType === 'wait.started') return 'waiting';
  if (envelope.eventType === 'wait.ended') return 'running';
  if (envelope.eventType === 'work.completed' || envelope.eventType === 'validator.completed') {
    return 'completed';
  }
  return 'running';
}

function projectWork(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const workId = envelope.correlation.workId;
  if (workId === undefined) return;
  const attempt = envelope.correlation.attempt ?? null;
  let work = change.works.find(
    (candidate) =>
      candidate.workId === workId && (attempt === null || candidate.attempt === attempt),
  );
  const state = workState(envelope);
  if (work === undefined) {
    work = {
      workId,
      workKind: envelope.correlation.workKind ?? null,
      packageId: envelope.correlation.packageId ?? null,
      taskId: envelope.correlation.taskId ?? null,
      attempt,
      hostId: envelope.correlation.hostId ?? null,
      validatorId: envelope.correlation.validatorId ?? null,
      continuation: envelope.correlation.continuation ?? null,
      state,
      startedAt: envelope.observedAt,
      latestObservedAt: envelope.observedAt,
      completedAt: state === 'completed' || state === 'failed' ? envelope.observedAt : null,
    };
    change.works.push(work);
  } else {
    work.workKind = envelope.correlation.workKind ?? work.workKind;
    work.packageId = envelope.correlation.packageId ?? work.packageId;
    work.taskId = envelope.correlation.taskId ?? work.taskId;
    work.hostId = envelope.correlation.hostId ?? work.hostId;
    work.validatorId = envelope.correlation.validatorId ?? work.validatorId;
    work.continuation = envelope.correlation.continuation ?? work.continuation;
    work.state = state;
    work.latestObservedAt = envelope.observedAt;
    if (state === 'completed' || state === 'failed') work.completedAt = envelope.observedAt;
  }
  change.works.sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.workId.localeCompare(right.workId),
  );
  change.currentWork = work;
}

function projectBuildAction(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const fallback =
    stringAttribute(envelope.attributes, 'observationKind')?.includes('fallback') === true;
  const actionName =
    envelope.correlation.buildAction ??
    (envelope.correlation.workId !== undefined ? change.buildAction : null);
  if (actionName === null) return;
  const action = change.buildActions.find((candidate) => candidate.action === actionName)!;
  const attempt = envelope.correlation.attempt ?? action.attempts.at(-1)?.attempt ?? 1;
  const state = fallback
    ? 'rework'
    : envelope.eventType === 'wait.started'
      ? 'waiting'
      : workState(envelope);
  updateAttempt(action.attempts, attempt, state, envelope.observedAt);
  action.state = state;
  action.latestObservedAt = envelope.observedAt;
}

function projectSkill(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const { skillName, skillRole, workId } = envelope.correlation;
  if (skillName === undefined || skillRole === undefined || workId === undefined) return;
  let skill = change.skills.find(
    (candidate) =>
      candidate.name === skillName && candidate.role === skillRole && candidate.workId === workId,
  );
  if (skill === undefined) {
    skill = {
      name: skillName,
      role: skillRole,
      workId,
      state: 'not-reported',
      resolvedAt: null,
      deliveredAt: null,
      consumedAt: null,
      failedAt: null,
    };
    change.skills.push(skill);
  }
  const reported = stringAttribute(envelope.attributes, 'skillState');
  const failed = resultState(stringAttribute(envelope.attributes, 'result')) === 'failed';
  if (failed) {
    skill.state = 'failed';
    skill.failedAt = envelope.observedAt;
  } else if (reported === 'resolved') {
    skill.state = reported;
    skill.resolvedAt = envelope.observedAt;
  } else if (reported === 'delivered') {
    skill.state = reported;
    skill.deliveredAt = envelope.observedAt;
  } else if (reported === 'consumed') {
    skill.state = reported;
    skill.consumedAt = envelope.observedAt;
  }
  change.skills.sort(
    (left, right) =>
      left.workId.localeCompare(right.workId) ||
      left.role.localeCompare(right.role) ||
      left.name.localeCompare(right.name),
  );
}

function projectDecision(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const decisionId = envelope.correlation.decisionId;
  if (decisionId === undefined) return;
  let decision = change.decisions.find((candidate) => candidate.decisionId === decisionId);
  if (decision === undefined) {
    decision = {
      decisionId,
      kind: envelope.correlation.decisionKind ?? 'not-reported',
      state: envelope.eventType === 'wait.ended' ? 'resolved' : 'waiting',
      startedAt: envelope.observedAt,
      endedAt: envelope.eventType === 'wait.ended' ? envelope.observedAt : null,
    };
    change.decisions.push(decision);
  } else if (envelope.eventType === 'wait.ended') {
    decision.state = 'resolved';
    decision.endedAt = envelope.observedAt;
  }
}

function projectEvidence(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const attemptId = envelope.correlation.evidenceAttemptId;
  if (attemptId === undefined) return;
  let evidence = change.evidence.find((candidate) => candidate.attemptId === attemptId);
  if (evidence === undefined) {
    evidence = {
      attemptId,
      gateId: envelope.correlation.gateId ?? null,
      gateStatus: stringAttribute(envelope.attributes, 'gateStatus'),
      status:
        stringAttribute(envelope.attributes, 'status') ??
        stringAttribute(envelope.attributes, 'outcome'),
      artifacts: [],
      latestObservedAt: envelope.observedAt,
    };
    change.evidence.push(evidence);
  } else {
    evidence.gateId = envelope.correlation.gateId ?? evidence.gateId;
    evidence.gateStatus = stringAttribute(envelope.attributes, 'gateStatus') ?? evidence.gateStatus;
    evidence.status =
      stringAttribute(envelope.attributes, 'status') ??
      stringAttribute(envelope.attributes, 'outcome') ??
      evidence.status;
    evidence.latestObservedAt = envelope.observedAt;
  }
  const artifactId = envelope.correlation.artifactId;
  if (
    artifactId !== undefined &&
    !evidence.artifacts.some((item) => item.artifactId === artifactId)
  ) {
    evidence.artifacts.push({
      artifactId,
      artifactType: stringAttribute(envelope.attributes, 'artifactType'),
      artifactSize: numberAttribute(envelope.attributes, 'artifactSize'),
      mediaType: stringAttribute(envelope.attributes, 'mediaType'),
      redacted: booleanAttribute(envelope.attributes, 'redacted'),
      observedAt: envelope.observedAt,
    });
  }
}

function projectRecovery(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const observationKind = stringAttribute(envelope.attributes, 'observationKind');
  const fromPhase = changePhase(stringAttribute(envelope.attributes, 'fromPhase'));
  const fallback =
    observationKind?.includes('fallback') === true ||
    (fromPhase !== null &&
      envelope.correlation.phase !== undefined &&
      phaseIndex(fromPhase) > phaseIndex(envelope.correlation.phase));
  if (!fallback && envelope.correlation.recovery === undefined) return;
  if (change.recoveries.some((candidate) => candidate.eventId === envelope.identity.eventId))
    return;
  change.recoveries.push({
    eventId: envelope.identity.eventId,
    kind: fallback ? 'fallback' : 'recovery',
    fromPhase,
    toPhase: envelope.correlation.phase ?? null,
    packageId: envelope.correlation.packageId ?? null,
    findingKind: stringAttribute(envelope.attributes, 'findingKind'),
    observedAt: envelope.observedAt,
  });
}

function projectDestination(change: ProjectedChange, envelope: ObservationEnvelope): void {
  const destinationId =
    envelope.correlation.destinationId ??
    stringAttribute(envelope.attributes, 'destinationId') ??
    undefined;
  if (destinationId === undefined) return;
  const next: ProjectedDestinationHealth = {
    destinationId,
    mode: stringAttribute(envelope.attributes, 'destinationMode'),
    backlog: numberAttribute(envelope.attributes, 'backlog'),
    oldestAgeMs: numberAttribute(envelope.attributes, 'oldestAgeMs'),
    lastResult: stringAttribute(envelope.attributes, 'destinationResult'),
    warningCode: stringAttribute(envelope.attributes, 'warningCode'),
    droppedEnvelopes: numberAttribute(envelope.attributes, 'droppedEnvelopes'),
    observedAt: envelope.observedAt,
  };
  const index = change.destinations.findIndex(
    (candidate) => candidate.destinationId === destinationId,
  );
  if (index < 0) change.destinations.push(next);
  else change.destinations[index] = next;
  change.destinations.sort((left, right) => left.destinationId.localeCompare(right.destinationId));
}

function healthStatus(
  reasons: readonly ProjectedHealthReason[],
  criticalCodes: readonly string[],
): ProjectedHealthDimension {
  if (reasons.length === 0) return { status: 'healthy', reasons: [] };
  return {
    status: reasons.some((reason) => criticalCodes.includes(reason.code))
      ? 'critical'
      : 'attention',
    reasons: [...reasons],
  };
}

function elapsed(from: string, to: string): number {
  const duration = Date.parse(to) - Date.parse(from);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

function projectHealth(
  change: ProjectedChange,
  freshness: ChangeProjectionSnapshot['freshness'],
  observedAt: string,
): void {
  const currentPhase = change.phases.find((phase) => phase.phase === change.phase);
  const transitionReasons: ProjectedHealthReason[] = [];
  if (currentPhase?.state === 'failed') {
    transitionReasons.push({ code: 'phase-failed', phase: currentPhase.phase });
  } else if (currentPhase?.state === 'blocked') {
    transitionReasons.push({ code: 'phase-blocked', phase: currentPhase.phase });
  }
  if (change.decisions.some((decision) => decision.state === 'waiting')) {
    transitionReasons.push({ code: 'human-decision' });
  }
  if (change.recoveries.length > 0) {
    transitionReasons.push({ code: 'fallback', count: change.recoveries.length });
  }
  change.health.transition =
    change.phase === null
      ? { status: 'not-reported', reasons: [] }
      : healthStatus(transitionReasons, ['phase-failed']);

  const executionReasons: ProjectedHealthReason[] = [];
  const currentWork = change.currentWork;
  if (currentWork?.state === 'failed') {
    executionReasons.push({ code: 'work-failed', workId: currentWork.workId });
  } else if (
    currentWork !== null &&
    ['pending', 'running'].includes(currentWork.state) &&
    elapsed(currentWork.latestObservedAt, observedAt) >= STALLED_WORK_MS
  ) {
    executionReasons.push({
      code: 'work-stalled',
      workId: currentWork.workId,
      durationMs: elapsed(currentWork.latestObservedAt, observedAt),
    });
  } else if (currentWork?.state === 'waiting') {
    executionReasons.push({ code: 'work-waiting', workId: currentWork.workId });
  }
  change.health.execution =
    currentWork === null
      ? { status: 'not-reported', reasons: [] }
      : healthStatus(executionReasons, ['work-failed']);

  const qualityReasons: ProjectedHealthReason[] = [];
  for (const evidence of change.evidence) {
    if (evidence.gateStatus === 'failed' || evidence.status === 'failed') {
      qualityReasons.push({ code: 'gate-failed', evidenceAttemptId: evidence.attemptId });
    }
  }
  if (change.recoveries.some((recovery) => recovery.kind === 'fallback')) {
    qualityReasons.push({ code: 'verification-rework', count: change.recoveries.length });
  }
  change.health.quality =
    change.evidence.length === 0 && change.recoveries.length === 0
      ? { status: 'not-reported', reasons: [] }
      : healthStatus(qualityReasons, ['gate-failed']);

  const telemetryReasons: ProjectedHealthReason[] = [];
  if (freshness.status === 'gap') {
    telemetryReasons.push({ code: 'sequence-gap', count: freshness.missing.length });
  } else if (freshness.status === 'error') {
    telemetryReasons.push({ code: 'receiver-error' });
  } else if (freshness.status === 'stale') {
    telemetryReasons.push({ code: 'telemetry-stale' });
  } else if (freshness.status === 'catching-up') {
    telemetryReasons.push({ code: 'telemetry-catching-up' });
  }
  for (const destination of change.destinations) {
    if ((destination.backlog ?? 0) > 0) {
      telemetryReasons.push({
        code: 'destination-backlog',
        destinationId: destination.destinationId,
        count: destination.backlog ?? 0,
        ...(destination.oldestAgeMs === null ? {} : { durationMs: destination.oldestAgeMs }),
      });
    }
    if (destination.lastResult === 'failed') {
      telemetryReasons.push({
        code: 'destination-failed',
        destinationId: destination.destinationId,
        ...(destination.warningCode === null ? {} : { category: destination.warningCode }),
      });
    }
  }
  change.health.telemetry = healthStatus(telemetryReasons, ['sequence-gap', 'receiver-error']);
}

function displayState(
  change: ProjectedChange,
  freshness: ChangeProjectionSnapshot['freshness'],
): DashboardDisplayState {
  const currentPhase = change.phases.find((phase) => phase.phase === change.phase);
  if (change.status === 'failed' || currentPhase?.state === 'failed') return 'failed';
  if (
    change.status === 'completed' ||
    (currentPhase?.state === 'completed' && change.phase === 'archive')
  ) {
    return 'complete';
  }
  if (freshness.status === 'error') return 'error';
  if (freshness.status === 'gap') return 'gap';
  if (change.health.execution.reasons.some((reason) => reason.code === 'work-stalled')) {
    return 'stalled';
  }
  if (change.decisions.some((decision) => decision.state === 'waiting')) return 'waiting';
  if (change.recoveries.some((recovery) => recovery.kind === 'fallback')) return 'rework';
  if (freshness.status === 'stale') return 'stale';
  if (freshness.status === 'catching-up') return 'catching-up';
  if (
    change.workId === null &&
    change.decisions.length === 0 &&
    change.evidence.length === 0 &&
    change.recoveries.length === 0
  ) {
    return 'sparse';
  }
  return 'live';
}

function createProjectedChange(envelope: ObservationEnvelope): ProjectedChange | undefined {
  const { workspaceId, changeId } = envelope.correlation;
  if (!workspaceId || !changeId) return undefined;
  return {
    workspaceId,
    changeId,
    runId: envelope.identity.runId,
    phase: null,
    buildAction: null,
    status: null,
    workId: null,
    taskId: null,
    attempt: null,
    hostId: null,
    validatorId: null,
    continuation: null,
    phases: emptyPhases(),
    buildActions: emptyBuildActions(),
    works: [],
    currentWork: null,
    skills: [],
    decisions: [],
    evidence: [],
    recoveries: [],
    destinations: [],
    health: emptyHealth(),
    displayState: 'sparse',
    latestSequence: 0,
    latestObservedAt: envelope.observedAt,
  };
}

function projectChange(
  current: ProjectedChange | undefined,
  envelope: ObservationEnvelope,
): ProjectedChange | undefined {
  const change = current ?? createProjectedChange(envelope);
  if (change === undefined || envelope.identity.sequence < change.latestSequence) return change;
  const value = <T>(next: T | undefined, previous: T | null): T | null =>
    next === undefined ? previous : next;
  change.phase = value(envelope.correlation.phase, change.phase);
  change.buildAction = value(envelope.correlation.buildAction, change.buildAction);
  change.status =
    stringAttribute(envelope.attributes, 'toStatus') ??
    stringAttribute(envelope.attributes, 'result') ??
    stringAttribute(envelope.attributes, 'status') ??
    stringAttribute(envelope.attributes, 'outcome') ??
    change.status;
  change.workId = value(envelope.correlation.workId, change.workId);
  change.taskId = value(envelope.correlation.taskId, change.taskId);
  change.attempt = value(envelope.correlation.attempt, change.attempt);
  change.hostId = value(envelope.correlation.hostId, change.hostId);
  change.validatorId = value(envelope.correlation.validatorId, change.validatorId);
  change.continuation = value(envelope.correlation.continuation, change.continuation);
  change.latestSequence = envelope.identity.sequence;
  change.latestObservedAt = envelope.observedAt;
  projectPhases(change, envelope);
  projectWork(change, envelope);
  projectBuildAction(change, envelope);
  projectSkill(change, envelope);
  projectDecision(change, envelope);
  projectEvidence(change, envelope);
  projectRecovery(change, envelope);
  projectDestination(change, envelope);
  return change;
}

function explicitFreshness(
  envelope: ObservationEnvelope,
): ChangeProjectionSnapshot['freshness']['status'] | null {
  const reported = stringAttribute(envelope.attributes, 'freshness');
  if (
    reported === 'catching-up' ||
    reported === 'live' ||
    reported === 'stale' ||
    reported === 'gap'
  ) {
    return reported;
  }
  const status = stringAttribute(envelope.attributes, 'status');
  if (status === 'error' && /telemetry|receiver/iu.test(envelope.eventType)) return 'error';
  return null;
}

/** Pure reducer: duplicate observations are no-ops and arrival order does not rewrite newer facts. */
export function reduceChangeProjection(
  current: ChangeProjectionSnapshot,
  envelope: ObservationEnvelope,
): ChangeProjectionReduction {
  if (current.seenEnvelopeIds.includes(envelope.envelopeId)) {
    return { snapshot: current, delta: null };
  }
  const next = structuredClone(current);
  next.version += 1;
  next.seenEnvelopeIds.push(envelope.envelopeId);
  next.seenEnvelopeIds.sort();
  const sequences = new Set(next.receivedSequences[envelope.identity.runId] ?? []);
  sequences.add(envelope.identity.sequence);
  next.receivedSequences[envelope.identity.runId] = [...sequences].sort(
    (left, right) => left - right,
  );

  const key = projectionKey(envelope);
  if (key !== null) {
    const index = next.changes.findIndex(
      (change) => `${change.workspaceId}\0${change.changeId}\0${change.runId}` === key,
    );
    const projected = projectChange(index < 0 ? undefined : next.changes[index], envelope);
    if (projected !== undefined) {
      if (index < 0) next.changes.push(projected);
      else next.changes[index] = projected;
      next.changes.sort(
        (left, right) =>
          left.workspaceId.localeCompare(right.workspaceId) ||
          left.changeId.localeCompare(right.changeId) ||
          left.runId.localeCompare(right.runId),
      );
    }
  }
  const missing = gaps(next.receivedSequences);
  const reportedFreshness = explicitFreshness(envelope);
  next.freshness = {
    status: missing.length > 0 ? 'gap' : (reportedFreshness ?? 'live'),
    missing,
  };
  const latestObservedAt = next.changes.reduce(
    (latest, change) =>
      change.latestObservedAt.localeCompare(latest) > 0 ? change.latestObservedAt : latest,
    envelope.observedAt,
  );
  for (const change of next.changes) {
    projectHealth(change, next.freshness, latestObservedAt);
    change.displayState = displayState(change, next.freshness);
  }
  return {
    snapshot: next,
    delta: {
      schemaVersion: 1,
      previousVersion: current.version,
      version: next.version,
      eventId: envelope.identity.eventId,
      runId: envelope.identity.runId,
      changeKey: key,
      freshness: structuredClone(next.freshness),
    },
  };
}

export function isChangeProjectionSnapshot(value: unknown): value is ChangeProjectionSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    Number.isSafeInteger(candidate.version) &&
    Array.isArray(candidate.changes) &&
    candidate.changes.every(
      (change) =>
        typeof change === 'object' &&
        change !== null &&
        Array.isArray((change as Record<string, unknown>).phases) &&
        Array.isArray((change as Record<string, unknown>).buildActions),
    ) &&
    Array.isArray(candidate.seenEnvelopeIds) &&
    typeof candidate.freshness === 'object' &&
    candidate.freshness !== null
  );
}

export function isChangeProjectionDelta(value: unknown): value is ChangeProjectionDelta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    Number.isSafeInteger(candidate.previousVersion) &&
    Number.isSafeInteger(candidate.version) &&
    typeof candidate.eventId === 'string' &&
    typeof candidate.runId === 'string'
  );
}
