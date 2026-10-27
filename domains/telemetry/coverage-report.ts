import { OBSERVATION_PHASES, type ObservationPhase } from './observation-contract.js';

export interface CoverageObservationRecord {
  eventId: string;
  timestamp: string;
  type: string;
  runId: string;
  data: Readonly<Record<string, unknown>>;
}

export const OBSERVATION_COVERAGE_REQUIREMENTS = [
  'run-boundary',
  'phase-open',
  'phase-design',
  'phase-build',
  'phase-verify',
  'phase-archive',
  'work-lifecycle',
  'task-lifecycle',
  'skill-chain',
  'decision-boundary',
  'wait-boundary',
  'tool-observation',
  'validator-boundary',
  'evidence-boundary-and-gate',
  'continuation',
  'rework',
  'recovery',
  'telemetry-pipeline-health',
] as const;

export type ObservationCoverageRequirement =
  (typeof OBSERVATION_COVERAGE_REQUIREMENTS)[number];

export interface ObservationCoverageReport {
  schemaVersion: 1;
  status: 'complete' | 'incomplete';
  eventCount: number;
  runIds: readonly string[];
  covered: readonly ObservationCoverageRequirement[];
  missing: readonly ObservationCoverageRequirement[];
  projection: {
    phasesSeen: readonly ObservationPhase[];
    currentPhase: ObservationPhase | null;
    currentStatus: string | null;
    currentWork: { id: string; kind: string; attempt: number | null } | null;
    currentTask: { id: string; revision: string | null; status: string } | null;
    currentSkills: readonly {
      name: string;
      role: 'action' | 'augmentation' | 'unknown';
      status: 'resolved' | 'delivered' | 'consumed';
    }[];
    decisionCount: number;
    evidenceAttemptCount: number;
    evidenceGateCount: number;
    reworkCount: number;
    recoveryCount: number;
    telemetryHealthFactCount: number;
  };
}

const PHASE_INDEX = new Map(OBSERVATION_PHASES.map((phase, index) => [phase, index]));
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function executionContext(data: Readonly<Record<string, unknown>>): {
  phase: ObservationPhase | null;
  workId: string | null;
  workKind: string | null;
  attempt: number | null;
  taskId: string | null;
  taskRevision: string | null;
} {
  const context = object(data.executionContext);
  const work = object(context?.work);
  const task = object(context?.task);
  const rawPhase = context?.phase ?? data.phase;
  return {
    phase:
      typeof rawPhase === 'string' && PHASE_INDEX.has(rawPhase as ObservationPhase)
        ? (rawPhase as ObservationPhase)
        : null,
    workId: text(work?.id) ?? text(data.workId),
    workKind: text(work?.kind) ?? text(data.workKind),
    attempt: integer(context?.attempt) ?? integer(data.attempt),
    taskId: text(task?.id) ?? text(object(data.task)?.id) ?? text(data.taskId),
    taskRevision:
      text(task?.revision) ?? text(object(data.task)?.revision) ?? text(data.taskRevision),
  };
}

function lifecycleTransition(data: Readonly<Record<string, unknown>>): {
  fromPhase: ObservationPhase | null;
  toPhase: ObservationPhase | null;
  toStatus: string | null;
  workId: string | null;
  workKind: string | null;
} | null {
  const transition = object(data.changeLifecycleTransition);
  if (!transition) return null;
  const from = object(transition.from);
  const to = object(transition.to);
  const work = object(transition.work);
  const phase = (value: unknown): ObservationPhase | null =>
    typeof value === 'string' && PHASE_INDEX.has(value as ObservationPhase)
      ? (value as ObservationPhase)
      : null;
  return {
    fromPhase: phase(from?.phase),
    toPhase: phase(to?.phase),
    toStatus: text(to?.status),
    workId: text(work?.workId) ?? text(transition.workId),
    workKind: text(work?.kind),
  };
}

function observationOrder(
  left: CoverageObservationRecord,
  right: CoverageObservationRecord,
): number {
  const time = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  return time === 0 ? left.eventId.localeCompare(right.eventId) : time;
}

export function createObservationCoverageReport(
  input: readonly CoverageObservationRecord[],
): ObservationCoverageReport {
  const unique = new Map<string, CoverageObservationRecord>();
  for (const event of input) {
    if (
      !SAFE_ID.test(event.eventId) ||
      !SAFE_ID.test(event.runId) ||
      !Number.isFinite(Date.parse(event.timestamp))
    ) {
      throw new Error('Observation coverage input contains an invalid record identity');
    }
    unique.set(event.eventId, event);
  }
  const events = [...unique.values()].sort(observationOrder);
  const types = new Set(events.map((event) => event.type));
  const phases = new Set<ObservationPhase>();
  const activeWorks = new Map<
    string,
    { id: string; kind: string; attempt: number | null; observedAt: string }
  >();
  const tasks = new Map<
    string,
    { id: string; revision: string | null; status: string; observedAt: string }
  >();
  const skills = new Map<
    string,
    {
      workId: string;
      name: string;
      role: 'action' | 'augmentation' | 'unknown';
      status: 'resolved' | 'delivered' | 'consumed';
      observedAt: string;
    }
  >();
  let currentPhase: ObservationPhase | null = null;
  let currentStatus: string | null = null;
  let decisionCount = 0;
  let evidenceAttemptCount = 0;
  let evidenceGateCount = 0;
  let reworkCount = 0;
  let recoveryCount = 0;
  let telemetryHealthFactCount = 0;

  for (const event of events) {
    const context = executionContext(event.data);
    if (context.phase) phases.add(context.phase);
    const transition = lifecycleTransition(event.data);
    if (transition) {
      if (transition.fromPhase) phases.add(transition.fromPhase);
      if (transition.toPhase) {
        phases.add(transition.toPhase);
        currentPhase = transition.toPhase;
      }
      currentStatus = transition.toStatus;
      if (
        transition.fromPhase &&
        transition.toPhase &&
        PHASE_INDEX.get(transition.toPhase)! < PHASE_INDEX.get(transition.fromPhase)!
      ) {
        reworkCount += 1;
      }
      if (transition.workId && transition.workKind) {
        activeWorks.set(transition.workId, {
          id: transition.workId,
          kind: transition.workKind,
          attempt: null,
          observedAt: event.timestamp,
        });
      }
    }

    if (event.type === 'work.created' || event.type === 'work.claimed') {
      if (context.workId && context.workKind) {
        activeWorks.set(context.workId, {
          id: context.workId,
          kind: context.workKind,
          attempt: context.attempt,
          observedAt: event.timestamp,
        });
      }
    }
    if (
      event.type === 'validator.completed' &&
      event.data.result === 'accepted' &&
      context.workId
    ) {
      activeWorks.delete(context.workId);
    }

    if (event.type.startsWith('task.')) {
      const taskId = context.taskId;
      if (taskId) {
        const status = event.type.slice('task.'.length);
        tasks.set(taskId, {
          id: taskId,
          revision: context.taskRevision,
          status,
          observedAt: event.timestamp,
        });
        if (status === 'reopened') reworkCount += 1;
      }
    }

    if (event.type.startsWith('skill.')) {
      const name = text(event.data.skillName);
      const role = event.data.skillRole;
      const status = event.type.slice('skill.'.length);
      if (
        context.workId &&
        name &&
        (status === 'resolved' || status === 'delivered' || status === 'consumed')
      ) {
        const boundedRole = role === 'action' || role === 'augmentation' ? role : 'unknown';
        skills.set(`${context.workId}\0${name}\0${boundedRole}`, {
          workId: context.workId,
          name,
          role: boundedRole,
          status,
          observedAt: event.timestamp,
        });
      }
    }

    if (event.type === 'decision.resolved') decisionCount += 1;
    if (event.type === 'evidence.attempt.completed' || event.type === 'evidence.completed') {
      evidenceAttemptCount += 1;
    }
    if (event.type === 'evidence.gate.evaluated' || event.type === 'evidence.gate-evaluated') {
      evidenceGateCount += 1;
    }
    if (
      event.type === 'recovery.reconciled' ||
      event.type === 'reconcile.completed' ||
      event.type === 'run.resumed'
    ) {
      recoveryCount += 1;
    }
    if (event.type.startsWith('telemetry.')) telemetryHealthFactCount += 1;
  }

  const hasEvery = (...required: string[]): boolean => required.every((type) => types.has(type));
  const checks = new Map<ObservationCoverageRequirement, boolean>([
    ['run-boundary', types.has('run.started')],
    ...OBSERVATION_PHASES.map(
      (phase) => [`phase-${phase}`, phases.has(phase)] as const,
    ),
    [
      'work-lifecycle',
      hasEvery(
        'work.created',
        'work.claimed',
        'work.context-delivered',
        'work.host-started',
        'work.host-completed',
        'work.completed',
      ),
    ],
    [
      'task-lifecycle',
      hasEvery('task.started', 'task.completed', 'task.reopened') && tasks.size > 0,
    ],
    ['skill-chain', hasEvery('skill.resolved', 'skill.delivered', 'skill.consumed')],
    ['decision-boundary', hasEvery('decision.requested', 'decision.resolved')],
    ['wait-boundary', hasEvery('wait.started', 'wait.ended')],
    [
      'tool-observation',
      types.has('tool.observation-reported') &&
        (types.has('tool.usage-reported') ||
          events.some(
            (event) =>
              event.type === 'tool.observation-reported' &&
              event.data.observationStatus === 'unknown',
          )),
    ],
    ['validator-boundary', hasEvery('validator.started', 'validator.completed')],
    [
      'evidence-boundary-and-gate',
      (hasEvery('evidence.attempt.started', 'evidence.attempt.completed') ||
        hasEvery('evidence.started', 'evidence.completed')) &&
        (types.has('evidence.gate.evaluated') || types.has('evidence.gate-evaluated')),
    ],
    ['continuation', types.has('continuation.selected')],
    ['rework', reworkCount > 0],
    ['recovery', recoveryCount > 0],
    [
      'telemetry-pipeline-health',
      hasEvery(
        'telemetry.delivery-started',
        'telemetry.delivery-completed',
        'telemetry.receiver-evaluated',
        'telemetry.gap-recorded',
      ),
    ],
  ]);

  const covered = OBSERVATION_COVERAGE_REQUIREMENTS.filter(
    (requirement) => checks.get(requirement) === true,
  );
  const missing = OBSERVATION_COVERAGE_REQUIREMENTS.filter(
    (requirement) => checks.get(requirement) !== true,
  );
  const currentWork = [...activeWorks.values()].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt),
  ).at(-1);
  const currentTask = [...tasks.values()]
    .filter((task) => task.status === 'started')
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .at(-1);
  const currentSkills = currentWork
    ? [...skills.values()]
        .filter((skill) => skill.workId === currentWork.id)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(({ name, role, status }) => ({ name, role, status }))
    : [];

  return {
    schemaVersion: 1,
    status: missing.length === 0 ? 'complete' : 'incomplete',
    eventCount: events.length,
    runIds: [...new Set(events.map((event) => event.runId))].sort(),
    covered,
    missing,
    projection: {
      phasesSeen: OBSERVATION_PHASES.filter((phase) => phases.has(phase)),
      currentPhase,
      currentStatus,
      currentWork: currentWork
        ? { id: currentWork.id, kind: currentWork.kind, attempt: currentWork.attempt }
        : null,
      currentTask: currentTask
        ? {
            id: currentTask.id,
            revision: currentTask.revision,
            status: currentTask.status,
          }
        : null,
      currentSkills,
      decisionCount,
      evidenceAttemptCount,
      evidenceGateCount,
      reworkCount,
      recoveryCount,
      telemetryHealthFactCount,
    },
  };
}

export function assertCompleteObservationCoverage(report: ObservationCoverageReport): void {
  if (report.status !== 'complete') {
    throw new Error(`Observation coverage is incomplete: ${report.missing.join(', ')}`);
  }
}
