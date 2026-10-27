export const OBSERVATION_PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;

export type ObservationPhase = (typeof OBSERVATION_PHASES)[number];
export type ObservationCategory =
  | 'phase'
  | 'work'
  | 'task'
  | 'skill'
  | 'decision'
  | 'tool-host'
  | 'validator-evidence'
  | 'recovery'
  | 'telemetry-pipeline';

type ObservationSpanStrategy = 'point' | 'boundary-start' | 'boundary-end' | 'none';
type ObservationMetricInstrument = 'counter' | 'histogram' | 'gauge' | 'none';
type ObservationAttributeValue = string | number | boolean;

export interface ObservationEventSchema {
  schemaVersion: 1;
  name: string;
  category: ObservationCategory;
  log: { emit: true; correlation: 'trace-and-span' };
  span:
    | { strategy: 'point' | 'none' }
    | {
        strategy: 'boundary-start' | 'boundary-end';
        operation: string;
        correlation: 'operation-id';
      };
  metric: {
    instrument: ObservationMetricInstrument;
    dimensions: Readonly<Record<string, readonly ObservationAttributeValue[]>>;
  };
}

const PHASES = OBSERVATION_PHASES;
const RESULTS = ['succeeded', 'failed', 'unknown', 'accepted', 'rejected'] as const;
const WORK_KINDS = [
  'change.intake',
  'specification.plan',
  'task.implement',
  'evidence.verify',
  'specification.close',
  'delivery.publish',
  'custom',
] as const;
const TASK_RESULTS = ['started', 'completed', 'failed', 'reopened'] as const;
const SKILL_ROLES = ['action', 'augmentation'] as const;
const DECISION_KINDS = [
  'open-approval',
  'design-approval',
  'adopt-existing',
  'design-revision',
  'external-fact',
  'retry',
] as const;
const WAIT_KINDS = ['human', 'external-fact', 'retry', 'manual-handoff'] as const;
const TOOL_KINDS = ['runtime-operation', 'host-tool', 'model', 'unknown'] as const;
const EVIDENCE_RESULTS = ['passed', 'failed', 'blocked', 'unavailable', 'unknown'] as const;
const RECOVERY_KINDS = ['resume', 'reconcile', 'fallback', 'retry', 'unknown'] as const;
const DESTINATION_KINDS = ['remote', 'desktop'] as const;
const PIPELINE_RESULTS = ['accepted', 'rejected', 'delivered', 'failed', 'dropped', 'gap'] as const;

function dimensions(
  entries: Readonly<Record<string, readonly ObservationAttributeValue[]>>,
): Readonly<Record<string, readonly ObservationAttributeValue[]>> {
  return Object.freeze(entries);
}

function schema(
  name: string,
  category: ObservationCategory,
  span: ObservationEventSchema['span'],
  instrument: ObservationMetricInstrument,
  metricDimensions: Readonly<Record<string, readonly ObservationAttributeValue[]>> = {},
): ObservationEventSchema {
  return Object.freeze({
    schemaVersion: 1,
    name,
    category,
    log: Object.freeze({ emit: true, correlation: 'trace-and-span' as const }),
    span: Object.freeze(span),
    metric: Object.freeze({ instrument, dimensions: dimensions(metricDimensions) }),
  });
}

function point(
  name: string,
  category: ObservationCategory,
  metricDimensions: Readonly<Record<string, readonly ObservationAttributeValue[]>>,
): ObservationEventSchema {
  return schema(name, category, { strategy: 'point' }, 'counter', metricDimensions);
}

function boundary(
  name: string,
  category: ObservationCategory,
  strategy: Extract<ObservationSpanStrategy, 'boundary-start' | 'boundary-end'>,
  operation: string,
  metricDimensions: Readonly<Record<string, readonly ObservationAttributeValue[]>>,
): ObservationEventSchema {
  return schema(
    name,
    category,
    { strategy, operation, correlation: 'operation-id' },
    strategy === 'boundary-end' ? 'histogram' : 'counter',
    metricDimensions,
  );
}

const EVENT_SCHEMAS = [
  point('change.phase.entered', 'phase', { phase: PHASES }),
  point('change.phase.completed', 'phase', { phase: PHASES, result: RESULTS }),
  point('change.phase.reopened', 'phase', { phase: PHASES, 'recovery.kind': RECOVERY_KINDS }),

  point('work.created', 'work', { phase: PHASES, 'work.kind': WORK_KINDS }),
  point('work.claimed', 'work', { phase: PHASES, 'work.kind': WORK_KINDS }),
  point('work.context-delivered', 'work', { phase: PHASES, 'work.kind': WORK_KINDS }),
  boundary('work.host-started', 'work', 'boundary-start', 'host', {
    phase: PHASES,
    'work.kind': WORK_KINDS,
  }),
  boundary('work.host-completed', 'work', 'boundary-end', 'host', {
    phase: PHASES,
    'work.kind': WORK_KINDS,
    result: RESULTS,
  }),
  point('work.completed', 'work', {
    phase: PHASES,
    'work.kind': WORK_KINDS,
    result: RESULTS,
  }),
  point('continuation.selected', 'work', {
    phase: PHASES,
    continuation: ['execute', 'ask', 'wait', 'reconcile', 'done'],
  }),

  point('task.started', 'task', { phase: ['build'], 'task.result': TASK_RESULTS }),
  point('task.completed', 'task', { phase: ['build'], 'task.result': TASK_RESULTS }),
  point('task.failed', 'task', { phase: ['build'], 'task.result': TASK_RESULTS }),
  point('task.reopened', 'task', {
    phase: PHASES,
    'task.result': TASK_RESULTS,
    'recovery.kind': RECOVERY_KINDS,
  }),

  point('skill.resolved', 'skill', { phase: PHASES, 'skill.role': SKILL_ROLES }),
  point('skill.delivered', 'skill', { phase: PHASES, 'skill.role': SKILL_ROLES }),
  point('skill.consumed', 'skill', {
    phase: PHASES,
    'skill.role': SKILL_ROLES,
    result: RESULTS,
  }),

  boundary('decision.requested', 'decision', 'boundary-start', 'decision', {
    phase: PHASES,
    'decision.kind': DECISION_KINDS,
  }),
  boundary('decision.resolved', 'decision', 'boundary-end', 'decision', {
    phase: PHASES,
    'decision.kind': DECISION_KINDS,
    result: RESULTS,
  }),
  boundary('wait.started', 'decision', 'boundary-start', 'wait', {
    phase: PHASES,
    'wait.kind': WAIT_KINDS,
  }),
  boundary('wait.ended', 'decision', 'boundary-end', 'wait', {
    phase: PHASES,
    'wait.kind': WAIT_KINDS,
    result: RESULTS,
  }),

  boundary('tool.started', 'tool-host', 'boundary-start', 'tool', {
    phase: PHASES,
    'tool.kind': TOOL_KINDS,
  }),
  boundary('tool.completed', 'tool-host', 'boundary-end', 'tool', {
    phase: PHASES,
    'tool.kind': TOOL_KINDS,
    result: RESULTS,
  }),
  boundary('host.started', 'tool-host', 'boundary-start', 'host', {
    phase: PHASES,
    'work.kind': WORK_KINDS,
  }),
  boundary('host.completed', 'tool-host', 'boundary-end', 'host', {
    phase: PHASES,
    'work.kind': WORK_KINDS,
    result: RESULTS,
  }),

  boundary('validator.started', 'validator-evidence', 'boundary-start', 'validator', {
    phase: PHASES,
  }),
  boundary('validator.completed', 'validator-evidence', 'boundary-end', 'validator', {
    phase: PHASES,
    result: RESULTS,
  }),
  boundary('evidence.started', 'validator-evidence', 'boundary-start', 'evidence', {
    phase: ['verify'],
  }),
  boundary('evidence.completed', 'validator-evidence', 'boundary-end', 'evidence', {
    phase: ['verify'],
    'evidence.result': EVIDENCE_RESULTS,
  }),
  point('evidence.gate-evaluated', 'validator-evidence', {
    phase: ['verify'],
    'evidence.result': EVIDENCE_RESULTS,
  }),

  boundary('reconcile.started', 'recovery', 'boundary-start', 'reconcile', {
    phase: PHASES,
    'recovery.kind': RECOVERY_KINDS,
  }),
  boundary('reconcile.completed', 'recovery', 'boundary-end', 'reconcile', {
    phase: PHASES,
    'recovery.kind': RECOVERY_KINDS,
    result: RESULTS,
  }),
  point('recovery.reconciled', 'recovery', {
    phase: PHASES,
    'recovery.kind': RECOVERY_KINDS,
    result: RESULTS,
  }),

  point('telemetry.envelope-stored', 'telemetry-pipeline', { result: ['accepted', 'rejected'] }),
  boundary('telemetry.delivery-started', 'telemetry-pipeline', 'boundary-start', 'delivery', {
    'destination.kind': DESTINATION_KINDS,
  }),
  boundary('telemetry.delivery-completed', 'telemetry-pipeline', 'boundary-end', 'delivery', {
    'destination.kind': DESTINATION_KINDS,
    result: PIPELINE_RESULTS,
  }),
  point('telemetry.receiver-evaluated', 'telemetry-pipeline', {
    'destination.kind': ['desktop'],
    result: ['accepted', 'rejected'],
  }),
  point('telemetry.gap-recorded', 'telemetry-pipeline', {
    'destination.kind': DESTINATION_KINDS,
    result: ['dropped', 'gap'],
  }),
] as const;

const schemaByName = new Map(EVENT_SCHEMAS.map((entry) => [entry.name, entry]));

function categoryEvents(category: ObservationCategory): readonly string[] {
  return Object.freeze(
    EVENT_SCHEMAS.filter((entry) => entry.category === category).map((entry) => entry.name),
  );
}

export const OBSERVATION_COVERAGE_MATRIX = Object.freeze({
  phase: Object.freeze({ category: 'phase' as const, events: categoryEvents('phase') }),
  work: Object.freeze({ category: 'work' as const, events: categoryEvents('work') }),
  task: Object.freeze({ category: 'task' as const, events: categoryEvents('task') }),
  skill: Object.freeze({ category: 'skill' as const, events: categoryEvents('skill') }),
  decision: Object.freeze({ category: 'decision' as const, events: categoryEvents('decision') }),
  'tool-host': Object.freeze({
    category: 'tool-host' as const,
    events: categoryEvents('tool-host'),
  }),
  'validator-evidence': Object.freeze({
    category: 'validator-evidence' as const,
    events: categoryEvents('validator-evidence'),
  }),
  recovery: Object.freeze({ category: 'recovery' as const, events: categoryEvents('recovery') }),
  'telemetry-pipeline': Object.freeze({
    category: 'telemetry-pipeline' as const,
    events: categoryEvents('telemetry-pipeline'),
  }),
});

const FORBIDDEN_ATTRIBUTE_KEY =
  /(?:^|[._-])(authorization|body|command|cookie|credential|environment|output|password|path|prompt|reply|secret|token)(?:$|[._-])/iu;
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/-]+=*|gh[opusr]_[a-z0-9]{20,}|api[-_]?key|password|secret|token|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;
const ATTRIBUTE_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

export function observationEventSchema(eventName: string): ObservationEventSchema {
  const event = schemaByName.get(eventName);
  if (!event) throw new Error(`Unknown observation event schema: ${eventName}`);
  return event;
}

export function validateObservationMetricAttributes(
  eventName: string,
  candidate: Readonly<Record<string, unknown>>,
): Record<string, ObservationAttributeValue> {
  const event = observationEventSchema(eventName);
  const result: Record<string, ObservationAttributeValue> = {};
  for (const key of Object.keys(candidate).sort()) {
    const allowed = event.metric.dimensions[key];
    const value = candidate[key];
    if (!allowed || !allowed.some((entry) => entry === value)) {
      throw new Error(`Unsafe Metric dimension ${key} for ${eventName}`);
    }
    result[key] = value as ObservationAttributeValue;
  }
  return result;
}

export function validateObservationAttributes(
  candidate: Readonly<Record<string, unknown>>,
): Record<string, ObservationAttributeValue> {
  const result: Record<string, ObservationAttributeValue> = {};
  for (const key of Object.keys(candidate).sort()) {
    const value = candidate[key];
    if (
      key.length > 128 ||
      !ATTRIBUTE_NAME.test(key) ||
      FORBIDDEN_ATTRIBUTE_KEY.test(key) ||
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (typeof value === 'string' &&
        (value.length > 256 ||
          value.includes('\n') ||
          value.includes('\r') ||
          ABSOLUTE_PATH.test(value) ||
          SENSITIVE_VALUE.test(value)))
    ) {
      throw new Error(`Unsafe observation attribute: ${key}`);
    }
    result[key] = value;
  }
  return result;
}
