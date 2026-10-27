import type { RunState } from '../engine/types.js';
import type { TrajectoryEvent } from '../trajectory/types.js';

export const WORKFLOW_DURATION_KINDS = [
  'run',
  'phase-residency',
  'active-execution',
  'human-wait',
  'external-wait',
  'retry-wait',
  'validator',
  'reconcile',
] as const;

export const WORKFLOW_HEALTH_EVENT_KINDS = [
  'rework',
  'retry',
  'unknown',
  'reconcile',
  'recovery',
] as const;

const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
const RESULTS = [
  'succeeded',
  'failed',
  'accepted',
  'rejected',
  'unknown',
  'reopened',
  'not-executed',
] as const;
const VALIDATOR_FINDINGS = ['none', 'contract-rejected', 'validator-error', 'unknown'] as const;

type WorkflowPhase = (typeof PHASES)[number] | 'unknown';
type WorkflowResult = (typeof RESULTS)[number];
type WorkflowDurationKind = (typeof WORKFLOW_DURATION_KINDS)[number];
type WorkflowHealthEventKind = (typeof WORKFLOW_HEALTH_EVENT_KINDS)[number];

export type WorkflowHealthMetricSample =
  | {
      instrument: 'duration';
      kind: WorkflowDurationKind;
      phase: WorkflowPhase;
      result: WorkflowResult;
      durationMs: number;
      validatorFinding?: (typeof VALIDATOR_FINDINGS)[number];
    }
  | {
      instrument: 'event';
      kind: WorkflowHealthEventKind;
      phase: WorkflowPhase;
      result: WorkflowResult;
    };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function phaseOf(event: TrajectoryEvent): WorkflowPhase {
  const context = object(event.data.executionContext);
  const phase = context?.phase ?? event.data.phase;
  if (typeof phase === 'string' && (PHASES as readonly string[]).includes(phase)) {
    return phase as WorkflowPhase;
  }
  const recovery = object(event.data.recovery);
  const sourcePhase = recovery?.sourcePhase;
  return typeof sourcePhase === 'string' && (PHASES as readonly string[]).includes(sourcePhase)
    ? (sourcePhase as WorkflowPhase)
    : 'unknown';
}

function resultOf(event: TrajectoryEvent, fallback: WorkflowResult = 'unknown'): WorkflowResult {
  const result = event.data.result;
  return typeof result === 'string' && (RESULTS as readonly string[]).includes(result)
    ? (result as WorkflowResult)
    : fallback;
}

function elapsed(start: TrajectoryEvent | undefined, end: TrajectoryEvent): number | null {
  if (!start) return null;
  const duration = Date.parse(end.timestamp) - Date.parse(start.timestamp);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function executionIdentity(event: TrajectoryEvent): string | null {
  const context = object(event.data.executionContext);
  const work = object(context?.work);
  if (
    typeof work?.id !== 'string' ||
    typeof context?.attempt !== 'number' ||
    typeof context?.checkEpoch !== 'number'
  ) {
    return null;
  }
  return `${work.id}\0${context.attempt}\0${context.checkEpoch}`;
}

function operationIdentity(event: TrajectoryEvent, key: string): string | null {
  const value = event.data[key];
  if (typeof value === 'string') return value;
  return executionIdentity(event);
}

function priorBoundary(
  trajectory: readonly TrajectoryEvent[],
  end: TrajectoryEvent,
  type: TrajectoryEvent['type'],
  key: string,
): TrajectoryEvent | undefined {
  const identity = operationIdentity(end, key);
  if (!identity) return undefined;
  return [...trajectory]
    .filter(
      (candidate) =>
        candidate.sequence < end.sequence &&
        candidate.type === type &&
        operationIdentity(candidate, key) === identity,
    )
    .sort((left, right) => right.sequence - left.sequence)[0];
}

function durationSample(
  kind: WorkflowDurationKind,
  event: TrajectoryEvent,
  durationMs: number | null,
  phase = phaseOf(event),
): WorkflowHealthMetricSample[] {
  const validatorFinding = event.data.validatorFindingKind;
  return durationMs === null
    ? []
    : [
        {
          instrument: 'duration',
          kind,
          phase,
          result: resultOf(event, 'succeeded'),
          durationMs,
          ...(kind === 'validator' &&
          typeof validatorFinding === 'string' &&
          (VALIDATOR_FINDINGS as readonly string[]).includes(validatorFinding)
            ? { validatorFinding: validatorFinding as (typeof VALIDATOR_FINDINGS)[number] }
            : {}),
        },
      ];
}

function phaseResidency(
  trajectory: readonly TrajectoryEvent[],
  event: TrajectoryEvent,
): WorkflowHealthMetricSample[] {
  if (event.type !== 'change.lifecycle.transitioned') return [];
  const transition = object(event.data.changeLifecycleTransition);
  const from = object(transition?.from);
  const to = object(transition?.to);
  const fromPhase = from?.phase;
  if (
    typeof fromPhase !== 'string' ||
    !(PHASES as readonly string[]).includes(fromPhase) ||
    (fromPhase === to?.phase && to?.status !== 'completed')
  ) {
    return [];
  }
  const entered = [...trajectory]
    .filter((candidate) => {
      if (candidate.sequence >= event.sequence || candidate.type !== 'change.lifecycle.transitioned') {
        return false;
      }
      const candidateTransition = object(candidate.data.changeLifecycleTransition);
      return object(candidateTransition?.to)?.phase === fromPhase;
    })
    .sort((left, right) => right.sequence - left.sequence)[0];
  const started =
    entered ??
    trajectory.find((candidate) => candidate.type === 'run.started' && candidate.sequence < event.sequence);
  return durationSample('phase-residency', event, elapsed(started, event), fromPhase as WorkflowPhase);
}

function runDuration(input: {
  run: RunState;
  trajectory: readonly TrajectoryEvent[];
  event: TrajectoryEvent;
}): WorkflowHealthMetricSample[] {
  if (input.run.status !== 'completed' || input.event !== input.trajectory.at(-1)) return [];
  const started = input.trajectory.find((candidate) => candidate.type === 'run.started');
  return durationSample('run', input.event, elapsed(started, input.event), phaseOf(input.event));
}

/**
 * Projects only bounded, identity-free workflow health samples. Stable identities stay in
 * correlated Logs/Spans; this projection is deliberately safe for team-wide aggregation.
 */
export function projectWorkflowHealthMetrics(input: {
  run: RunState;
  trajectory: readonly TrajectoryEvent[];
  event: TrajectoryEvent;
}): WorkflowHealthMetricSample[] {
  const { trajectory, event } = input;
  const samples: WorkflowHealthMetricSample[] = [
    ...runDuration(input),
    ...phaseResidency(trajectory, event),
  ];

  if (event.type === 'work.completed') {
    samples.push(
      ...durationSample(
        'active-execution',
        event,
        elapsed(priorBoundary(trajectory, event, 'work.claimed', 'workId'), event),
      ),
    );
  }
  if (event.type === 'validator.completed') {
    samples.push(
      ...durationSample(
        'validator',
        event,
        elapsed(priorBoundary(trajectory, event, 'validator.started', 'operationId'), event),
      ),
    );
  }
  if (event.type === 'wait.ended') {
    const waitKind = event.data.waitKind;
    const kind =
      waitKind === 'human'
        ? 'human-wait'
        : waitKind === 'external-fact'
          ? 'external-wait'
          : waitKind === 'retry'
            ? 'retry-wait'
            : null;
    if (kind) {
      samples.push(
        ...durationSample(
          kind,
          event,
          elapsed(priorBoundary(trajectory, event, 'wait.started', 'waitId'), event),
        ),
      );
    }
  }
  if (event.type === 'reconcile.completed') {
    samples.push(
      ...durationSample(
        'reconcile',
        event,
        elapsed(priorBoundary(trajectory, event, 'reconcile.started', 'reconcileId'), event),
      ),
      { instrument: 'event', kind: 'reconcile', phase: phaseOf(event), result: resultOf(event) },
    );
  }
  if (event.type === 'work.claimed') {
    const attempt = object(event.data.executionContext)?.attempt;
    if (typeof attempt === 'number' && attempt > 1) {
      samples.push({ instrument: 'event', kind: 'retry', phase: phaseOf(event), result: 'unknown' });
    }
  } else if (event.type === 'task.reopened') {
    samples.push({ instrument: 'event', kind: 'rework', phase: phaseOf(event), result: 'reopened' });
  } else if (event.type === 'reconcile.started') {
    samples.push({ instrument: 'event', kind: 'unknown', phase: phaseOf(event), result: 'unknown' });
  } else if (event.type === 'recovery.reconciled') {
    samples.push({
      instrument: 'event',
      kind: 'recovery',
      phase: phaseOf(event),
      result: resultOf(event, 'succeeded'),
    });
  }
  return samples;
}
