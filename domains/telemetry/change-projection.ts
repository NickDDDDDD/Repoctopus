import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import {
  OBSERVATION_PHASES,
  observationEventSchema,
  type ObservationPhase,
} from './observation-contract.js';

export type ChangeProjectionPhaseStatus =
  | 'not-started'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'rework';
export type ChangeProjectionSkillRole = 'action' | 'augmentation';
export type ChangeProjectionSkillStatus = 'resolved' | 'delivered' | 'consumed';

export interface ChangeProjectionObservation {
  schemaVersion: 1;
  sequence: number;
  eventId: string;
  eventName: string;
  observedAt: string;
  workspaceId: string;
  changeId: string;
  runId: string;
  workflowName: string | null;
  phase: ObservationPhase | null;
  work: {
    id: string;
    kind: string;
    attempt: number;
  } | null;
  skill: {
    name: string;
    role: ChangeProjectionSkillRole;
  } | null;
  result: string | null;
}

export interface ChangeProjectionSkill {
  name: string;
  role: ChangeProjectionSkillRole;
  status: ChangeProjectionSkillStatus;
  lastSequence: number;
  lastEventId: string;
}

export interface ChangeProjectionWork {
  id: string;
  kind: string;
  attempt: number;
  status: 'active' | 'completed' | 'failed';
  statusSequence: number;
  lastSequence: number;
  lastEventId: string;
  skills: readonly ChangeProjectionSkill[];
}

export interface ChangeProjectionPhase {
  phase: ObservationPhase;
  status: ChangeProjectionPhaseStatus;
  lastSequence: number | null;
  lastEventId: string | null;
  enteredAt: string | null;
  completedAt: string | null;
}

export interface ChangeProjectionRun {
  runId: string;
  workflowName: string | null;
  status: 'active' | 'completed' | 'failed';
  currentPhase: ObservationPhase | null;
  currentPhaseSequence: number;
  latestSequence: number;
  latestObservedAt: string;
  phases: readonly ChangeProjectionPhase[];
  currentWork: ChangeProjectionWork | null;
  works: readonly ChangeProjectionWork[];
}

export interface ChangeProjectionChange {
  workspaceId: string;
  changeId: string;
  status: 'active' | 'completed' | 'failed';
  currentRunId: string;
  latestSequence: number;
  latestObservedAt: string;
  runs: readonly ChangeProjectionRun[];
}

export interface ChangeProjectionSnapshot {
  schemaVersion: 1;
  version: number;
  activeChange: { workspaceId: string; changeId: string } | null;
  freshness: {
    status: 'empty' | 'fresh' | 'gap';
    headSequence: number;
    missingSequences: readonly number[];
    latestObservedAt: string | null;
  };
  events: readonly {
    eventId: string;
    digest: string;
    sequence: number;
    observedAt: string;
  }[];
  changes: readonly ChangeProjectionChange[];
}

export interface ChangeProjectionDelta {
  schemaVersion: 1;
  version: number;
  eventId: string;
  workspaceId: string;
  changeId: string;
  freshness: ChangeProjectionSnapshot['freshness'];
}

export interface ChangeProjectionReduction {
  snapshot: ChangeProjectionSnapshot;
  delta: ChangeProjectionDelta | null;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const PHASE_EVENTS = new Set([
  'change.phase.entered',
  'change.phase.completed',
  'change.phase.reopened',
]);

function assertIdentity(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`${label} must be a stable bounded identity`);
}

function assertObservation(observation: ChangeProjectionObservation): void {
  if (observation.schemaVersion !== 1) throw new Error('Unsupported projection observation schema');
  if (!Number.isSafeInteger(observation.sequence) || observation.sequence < 1) {
    throw new Error('Projection observation sequence must be a positive safe integer');
  }
  assertIdentity(observation.eventId, 'Event id');
  assertIdentity(observation.workspaceId, 'Workspace id');
  assertIdentity(observation.changeId, 'Change id');
  assertIdentity(observation.runId, 'Run id');
  if (observation.workflowName !== null) assertIdentity(observation.workflowName, 'Workflow name');
  if (!Number.isFinite(Date.parse(observation.observedAt))) {
    throw new Error('Projection observation timestamp is invalid');
  }
  observationEventSchema(observation.eventName);
  if (observation.phase !== null && !OBSERVATION_PHASES.includes(observation.phase)) {
    throw new Error('Projection observation phase is invalid');
  }
  if (PHASE_EVENTS.has(observation.eventName) && observation.phase === null) {
    throw new Error('Phase observation requires a phase');
  }
  if (observation.eventName.startsWith('work.') && observation.work === null) {
    throw new Error('Work observation requires a Work identity');
  }
  if (observation.eventName.startsWith('skill.')) {
    if (observation.work === null || observation.skill === null) {
      throw new Error('Skill observation requires Work and Skill identities');
    }
  }
  if (observation.work) {
    assertIdentity(observation.work.id, 'Work id');
    assertIdentity(observation.work.kind, 'Work kind');
    if (!Number.isSafeInteger(observation.work.attempt) || observation.work.attempt < 1) {
      throw new Error('Work attempt must be a positive safe integer');
    }
  }
  if (observation.skill) assertIdentity(observation.skill.name, 'Skill name');
  if (observation.result !== null) assertIdentity(observation.result, 'Result');
}

function observationDigest(observation: ChangeProjectionObservation): string {
  return `sha256:${createHash('sha256').update(canonicalJson(observation)).digest('hex')}`;
}

function emptyPhases(): ChangeProjectionPhase[] {
  return OBSERVATION_PHASES.map((phase) => ({
    phase,
    status: 'not-started',
    lastSequence: null,
    lastEventId: null,
    enteredAt: null,
    completedAt: null,
  }));
}

export function createEmptyChangeProjection(): ChangeProjectionSnapshot {
  return {
    schemaVersion: 1,
    version: 0,
    activeChange: null,
    freshness: {
      status: 'empty',
      headSequence: 0,
      missingSequences: [],
      latestObservedAt: null,
    },
    events: [],
    changes: [],
  };
}

function cloneWork(work: ChangeProjectionWork): ChangeProjectionWork {
  return { ...work, skills: work.skills.map((skill) => ({ ...skill })) };
}

function cloneSnapshot(snapshot: ChangeProjectionSnapshot): ChangeProjectionSnapshot {
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported change projection schema');
  return {
    ...snapshot,
    activeChange: snapshot.activeChange ? { ...snapshot.activeChange } : null,
    freshness: {
      ...snapshot.freshness,
      missingSequences: [...snapshot.freshness.missingSequences],
    },
    events: snapshot.events.map((event) => ({ ...event })),
    changes: snapshot.changes.map((change) => ({
      ...change,
      runs: change.runs.map((run) => ({
        ...run,
        phases: run.phases.map((phase) => ({ ...phase })),
        currentWork: run.currentWork ? cloneWork(run.currentWork) : null,
        works: run.works.map(cloneWork),
      })),
    })),
  };
}

function eventIsLater(
  sequence: number,
  eventId: string,
  currentSequence: number | null,
  currentEventId: string | null,
): boolean {
  return (
    currentSequence === null ||
    sequence > currentSequence ||
    (sequence === currentSequence && eventId.localeCompare(currentEventId ?? '') > 0)
  );
}

function phaseStatus(observation: ChangeProjectionObservation): ChangeProjectionPhaseStatus {
  if (observation.eventName === 'change.phase.reopened') return 'rework';
  if (observation.eventName === 'change.phase.entered') return 'running';
  return ['succeeded', 'accepted', 'completed'].includes(observation.result ?? '')
    ? 'completed'
    : 'blocked';
}

function workStatus(observation: ChangeProjectionObservation): ChangeProjectionWork['status'] {
  if (observation.eventName !== 'work.completed') return 'active';
  return ['failed', 'rejected'].includes(observation.result ?? '') ? 'failed' : 'completed';
}

function recalculateFreshness(snapshot: ChangeProjectionSnapshot): void {
  const head = snapshot.events.at(-1);
  if (!head) {
    snapshot.freshness = createEmptyChangeProjection().freshness;
    return;
  }
  const seen = new Set(snapshot.events.map((event) => event.sequence));
  const missingSequences: number[] = [];
  for (let sequence = 1; sequence < head.sequence; sequence += 1) {
    if (!seen.has(sequence)) missingSequences.push(sequence);
  }
  snapshot.freshness = {
    status: missingSequences.length === 0 ? 'fresh' : 'gap',
    headSequence: head.sequence,
    missingSequences,
    latestObservedAt: head.observedAt,
  };
}

function recalculateDerivedState(snapshot: ChangeProjectionSnapshot): void {
  for (const change of snapshot.changes) {
    for (const run of change.runs) {
      const currentWork = run.works
        .filter((work) => work.status === 'active')
        .sort(
          (left, right) =>
            left.lastSequence - right.lastSequence ||
            left.lastEventId.localeCompare(right.lastEventId),
        )
        .at(-1);
      run.currentWork = currentWork ? cloneWork(currentWork) : null;
    }
    const currentRun = [...change.runs]
      .sort(
        (left, right) =>
          left.latestSequence - right.latestSequence || left.runId.localeCompare(right.runId),
      )
      .at(-1)!;
    change.currentRunId = currentRun.runId;
    change.status = currentRun.status;
  }
  const active = snapshot.changes
    .filter((change) => change.status === 'active')
    .sort(
      (left, right) =>
        left.latestSequence - right.latestSequence ||
        `${left.workspaceId}\0${left.changeId}`.localeCompare(
          `${right.workspaceId}\0${right.changeId}`,
        ),
    )
    .at(-1);
  snapshot.activeChange = active
    ? { workspaceId: active.workspaceId, changeId: active.changeId }
    : null;
}

export function reduceChangeProjection(
  previous: ChangeProjectionSnapshot,
  observation: ChangeProjectionObservation,
): ChangeProjectionReduction {
  assertObservation(observation);
  const digest = observationDigest(observation);
  const existing = previous.events.find((event) => event.eventId === observation.eventId);
  if (existing) {
    if (existing.digest !== digest) {
      throw new Error(`Projection event identity collision: ${observation.eventId}`);
    }
    return { snapshot: previous, delta: null };
  }
  const sequenceOwner = previous.events.find((event) => event.sequence === observation.sequence);
  if (sequenceOwner) {
    throw new Error(
      `Projection sequence collision between ${sequenceOwner.eventId} and ${observation.eventId}`,
    );
  }

  const snapshot = cloneSnapshot(previous);
  snapshot.events = [
    ...snapshot.events,
    {
      eventId: observation.eventId,
      digest,
      sequence: observation.sequence,
      observedAt: new Date(observation.observedAt).toISOString(),
    },
  ].sort(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
  snapshot.version = snapshot.events.length;

  const changeKey = `${observation.workspaceId}\0${observation.changeId}`;
  let change = snapshot.changes.find(
    (candidate) => `${candidate.workspaceId}\0${candidate.changeId}` === changeKey,
  );
  if (!change) {
    change = {
      workspaceId: observation.workspaceId,
      changeId: observation.changeId,
      status: 'active',
      currentRunId: observation.runId,
      latestSequence: observation.sequence,
      latestObservedAt: observation.observedAt,
      runs: [],
    };
    snapshot.changes = [...snapshot.changes, change];
  }

  let run = change.runs.find((candidate) => candidate.runId === observation.runId);
  if (!run) {
    run = {
      runId: observation.runId,
      workflowName: observation.workflowName,
      status: 'active',
      currentPhase: null,
      currentPhaseSequence: 0,
      latestSequence: observation.sequence,
      latestObservedAt: observation.observedAt,
      phases: emptyPhases(),
      currentWork: null,
      works: [],
    };
    change.runs = [...change.runs, run];
  }

  if (eventIsLater(observation.sequence, observation.eventId, run.latestSequence, null)) {
    run.latestSequence = observation.sequence;
    run.latestObservedAt = observation.observedAt;
    run.workflowName = observation.workflowName ?? run.workflowName;
  }
  if (observation.phase && observation.sequence >= run.currentPhaseSequence) {
    run.currentPhase = observation.phase;
    run.currentPhaseSequence = observation.sequence;
  }

  if (PHASE_EVENTS.has(observation.eventName) && observation.phase) {
    const phase = run.phases.find((candidate) => candidate.phase === observation.phase)!;
    if (
      eventIsLater(observation.sequence, observation.eventId, phase.lastSequence, phase.lastEventId)
    ) {
      phase.status = phaseStatus(observation);
      phase.lastSequence = observation.sequence;
      phase.lastEventId = observation.eventId;
      if (observation.eventName === 'change.phase.entered')
        phase.enteredAt = observation.observedAt;
      if (observation.eventName === 'change.phase.completed') {
        phase.completedAt = observation.observedAt;
      }
      if (observation.phase === 'archive' && observation.eventName === 'change.phase.completed') {
        run.status = phase.status === 'completed' ? 'completed' : 'failed';
      }
    }
  }

  if (observation.work) {
    let work = run.works.find((candidate) => candidate.id === observation.work!.id);
    if (!work) {
      work = {
        ...observation.work,
        status: workStatus(observation),
        statusSequence: observation.eventName.startsWith('work.') ? observation.sequence : 0,
        lastSequence: observation.sequence,
        lastEventId: observation.eventId,
        skills: [],
      };
      run.works = [...run.works, work];
    } else {
      if (
        eventIsLater(observation.sequence, observation.eventId, work.lastSequence, work.lastEventId)
      ) {
        work.kind = observation.work.kind;
        work.attempt = observation.work.attempt;
        work.lastSequence = observation.sequence;
        work.lastEventId = observation.eventId;
      }
      if (
        observation.eventName.startsWith('work.') &&
        observation.sequence >= work.statusSequence
      ) {
        work.status = workStatus(observation);
        work.statusSequence = observation.sequence;
      }
    }

    if (observation.eventName.startsWith('skill.') && observation.skill) {
      const status = observation.eventName.slice('skill.'.length) as ChangeProjectionSkillStatus;
      const skillKey = `${observation.skill.role}\0${observation.skill.name}`;
      const existingSkill = work.skills.find(
        (candidate) => `${candidate.role}\0${candidate.name}` === skillKey,
      );
      if (!existingSkill) {
        work.skills = [
          ...work.skills,
          {
            ...observation.skill,
            status,
            lastSequence: observation.sequence,
            lastEventId: observation.eventId,
          },
        ];
      } else if (
        eventIsLater(
          observation.sequence,
          observation.eventId,
          existingSkill.lastSequence,
          existingSkill.lastEventId,
        )
      ) {
        existingSkill.status = status;
        existingSkill.lastSequence = observation.sequence;
        existingSkill.lastEventId = observation.eventId;
      }
      work.skills = [...work.skills].sort(
        (left, right) => left.role.localeCompare(right.role) || left.name.localeCompare(right.name),
      );
    }
    run.works = [...run.works].sort((left, right) => left.id.localeCompare(right.id));
  }

  if (observation.sequence >= change.latestSequence) {
    change.latestSequence = observation.sequence;
    change.latestObservedAt = observation.observedAt;
  }
  change.runs = [...change.runs].sort((left, right) => left.runId.localeCompare(right.runId));
  snapshot.changes = [...snapshot.changes].sort(
    (left, right) =>
      left.workspaceId.localeCompare(right.workspaceId) ||
      left.changeId.localeCompare(right.changeId),
  );
  recalculateFreshness(snapshot);
  recalculateDerivedState(snapshot);

  return {
    snapshot,
    delta: {
      schemaVersion: 1,
      version: snapshot.version,
      eventId: observation.eventId,
      workspaceId: observation.workspaceId,
      changeId: observation.changeId,
      freshness: snapshot.freshness,
    },
  };
}
