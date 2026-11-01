import type { OtlpSignal } from './otlp-http-receiver.js';
import {
  isObservationEnvelope,
  type ObservationEnvelope,
} from '../../../domains/trajectory/observation.js';
import {
  observationAttributeOtlpName,
  observationCorrelationOtlpName,
} from '../../../domains/telemetry/observation-contract.js';

const ENVELOPE_ATTRIBUTE = 'repoctopus.observation.envelope';

type OtlpScalar = string | number | boolean;

function otlpValue(value: OtlpScalar) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

function keyValues(values: Readonly<Record<string, OtlpScalar>>) {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
}

function isOtlpScalar(value: unknown): value is OtlpScalar {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function eventAttributes(envelope: ObservationEnvelope) {
  const values: Record<string, OtlpScalar> = {
    [ENVELOPE_ATTRIBUTE]: JSON.stringify(envelope),
    'repoctopus.observation.schema_version': envelope.schemaVersion,
    'repoctopus.observation.envelope_id': envelope.envelopeId,
    'repoctopus.observation.digest': envelope.digest,
    'repoctopus.event.id': envelope.identity.eventId,
    'repoctopus.event.sequence': envelope.identity.sequence,
    'repoctopus.event.type': envelope.eventType,
    'repoctopus.run.id': envelope.identity.runId,
  };
  for (const [key, value] of Object.entries(envelope.correlation)) {
    if (isOtlpScalar(value)) {
      values[observationCorrelationOtlpName(key)] = value;
    }
  }
  for (const [key, value] of Object.entries(envelope.attributes)) {
    values[observationAttributeOtlpName(key)] = value;
  }
  return keyValues(values);
}

function metricAttributes(envelope: ObservationEnvelope) {
  const values: Record<string, OtlpScalar> = {
    'repoctopus.event.type': envelope.eventType,
  };
  if (envelope.correlation.phase) {
    values['repoctopus.execution.phase'] = envelope.correlation.phase;
  }
  if (envelope.correlation.workKind) {
    values['repoctopus.execution.work.kind'] = envelope.correlation.workKind;
  }
  if (envelope.correlation.skillRole) {
    values['repoctopus.skill.role'] = envelope.correlation.skillRole;
  }
  for (const key of ['result', 'status', 'findingKind'] as const) {
    const value = envelope.attributes[key];
    if (value !== undefined) values[observationAttributeOtlpName(key)] = value;
  }
  return keyValues(values);
}

type MetricProjection = {
  name: string;
  value: number;
  kind: 'sum' | 'gauge';
  observedAt: string;
  attributes: ReturnType<typeof keyValues>;
};

function boundedCategory(value: unknown): 'builtin' | 'team' | 'custom' {
  return value === 'builtin' || value === 'team' ? value : 'custom';
}

function skillRole(value: unknown): 'action' | 'augmentation' {
  return value === 'action' ? 'action' : 'augmentation';
}

function skillResult(envelope: ObservationEnvelope): string | undefined {
  if (envelope.eventType === 'skill.consumed') return 'consumed';
  if (envelope.eventType !== 'skill.outcome-recorded') return undefined;
  const result = envelope.attributes.result;
  return result === 'completed' || result === 'error' || result === 'corrected'
    ? result
    : undefined;
}

const EXECUTION_EVENT_TYPES = new Set([
  'work.created',
  'work.packet-stored',
  'work.packet-recovered',
  'work.claimed',
  'work.context-delivered',
  'work.host-started',
  'work.host-completed',
  'work.outcome-submitted',
  'work.outcome-corrected',
  'work.outcome-rejected',
  'work.outcome-accepted',
  'work.outcome-processing-error',
  'delegation.completed',
  'work.completed',
  'skill.resolved',
  'skill.delivered',
  'skill.consumed',
  'skill.consumption-rejected',
  'skill.outcome-recorded',
  'skill-composition.compiled',
  'skill-composition.rejected',
  'skill-composition.drifted',
  'skill-binding.resolved',
  'tool.started',
  'tool.completed',
  'validator.completed',
  'wait.started',
  'wait.ended',
  'reconcile.started',
  'reconcile.completed',
  'continuation.selected',
  'specification.artifacts-observed',
  'specification.validation-observed',
  'recovery.reconciled',
]);

function metricValue(envelope: ObservationEnvelope, key: string, fallback: OtlpScalar): OtlpScalar {
  return envelope.attributes[key] ?? fallback;
}

function legacyMetricProjections(envelope: ObservationEnvelope): MetricProjection[] {
  const projections: MetricProjection[] = [];
  const workflowName = envelope.attributes.workflowName;
  if (typeof workflowName === 'string') {
    projections.push({
      name: 'repoctopus.workflow.events',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes: keyValues({
        'repoctopus.event.type': envelope.eventType,
        'repoctopus.workflow.name': workflowName,
      }),
    });
    const duration = envelope.attributes.durationMs;
    if (typeof duration === 'number' && duration >= 0) {
      projections.push({
        name: 'repoctopus.workflow.step.duration',
        value: duration,
        kind: 'gauge',
        observedAt: envelope.observedAt,
        attributes: keyValues({
          'repoctopus.workflow.name': workflowName,
          'repoctopus.event.result': metricValue(envelope, 'result', 'unknown'),
        }),
      });
    }
  }

  if (EXECUTION_EVENT_TYPES.has(envelope.eventType)) {
    const attributes = keyValues({
      'repoctopus.execution.event.type': envelope.eventType,
      'repoctopus.execution.phase': envelope.correlation.phase ?? 'unknown',
      'repoctopus.execution.work.kind': envelope.correlation.workKind ?? 'custom',
      'repoctopus.execution.result': metricValue(envelope, 'result', 'unknown'),
      'repoctopus.execution.continuation': envelope.correlation.continuation ?? 'unknown',
    });
    projections.push({
      name: 'repoctopus.work.execution.events',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes,
    });
    const duration = envelope.attributes.durationMs;
    if (typeof duration === 'number' && duration >= 0) {
      projections.push({
        name: 'repoctopus.work.execution.duration',
        value: duration,
        kind: 'gauge',
        observedAt: envelope.observedAt,
        attributes: keyValues({
          'repoctopus.execution.event.type': envelope.eventType,
          'repoctopus.execution.phase': envelope.correlation.phase ?? 'unknown',
          'repoctopus.execution.work.kind': envelope.correlation.workKind ?? 'custom',
          'repoctopus.execution.result': metricValue(envelope, 'result', 'unknown'),
        }),
      });
    }
  }

  if (envelope.eventType.startsWith('evidence.')) {
    projections.push({
      name: 'repoctopus.evidence.events',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes: keyValues({ 'repoctopus.evidence.event.type': envelope.eventType }),
    });
    const duration = envelope.attributes.durationMs;
    if (envelope.eventType === 'evidence.node.completed' && typeof duration === 'number') {
      projections.push({
        name: 'repoctopus.evidence.node.duration',
        value: Math.max(0, duration),
        kind: 'gauge',
        observedAt: envelope.observedAt,
        attributes: keyValues({
          'repoctopus.evidence.adapter': metricValue(envelope, 'adapter', 'unknown'),
          'repoctopus.evidence.status': metricValue(envelope, 'status', 'unknown'),
        }),
      });
    }
  }

  if (envelope.eventType.startsWith('application.')) {
    projections.push({
      name: 'repoctopus.lifecycle.events',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes: keyValues({
        'repoctopus.lifecycle.type': envelope.eventType,
        'repoctopus.lifecycle.phase': metricValue(envelope, 'lifecycle', 'unknown'),
        'repoctopus.lifecycle.result': metricValue(envelope, 'result', 'unknown'),
      }),
    });
  }

  if (envelope.eventType.startsWith('delivery.')) {
    projections.push({
      name: 'repoctopus.delivery.events',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes: keyValues({
        'repoctopus.delivery.event.type': envelope.eventType,
        'repoctopus.delivery.state': metricValue(envelope, 'deliveryState', 'unknown'),
      }),
    });
  }
  return projections;
}

function specializedMetricProjections(envelope: ObservationEnvelope): MetricProjection[] {
  const projections: MetricProjection[] = [];
  const result = skillResult(envelope);
  if (result) {
    const correctionKind = envelope.attributes.correctionKind;
    projections.push({
      name: 'repoctopus.skill.usage',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes: keyValues({
        'repoctopus.skill.role': skillRole(envelope.correlation.skillRole),
        'repoctopus.skill.category': boundedCategory(envelope.attributes.skillCategory),
        'repoctopus.skill.result': result,
        ...(result === 'corrected' && typeof correctionKind === 'string'
          ? { 'repoctopus.skill.correction.kind': correctionKind }
          : {}),
      }),
    });
  }

  if (
    envelope.eventType === 'validator.completed' &&
    envelope.correlation.ruleId &&
    envelope.correlation.evaluatorId &&
    typeof envelope.attributes.ruleApplicable === 'boolean' &&
    typeof envelope.attributes.ruleExpected === 'boolean' &&
    typeof envelope.attributes.ruleTriggered === 'boolean'
  ) {
    const ruleResults: string[] = [];
    if (envelope.attributes.ruleApplicable && envelope.attributes.ruleExpected) {
      ruleResults.push('expected');
    }
    if (envelope.attributes.ruleApplicable && envelope.attributes.ruleTriggered) {
      ruleResults.push('triggered');
    }
    const evaluated = envelope.attributes.ruleResult;
    if (evaluated === 'passed' || evaluated === 'violated' || evaluated === 'unknown') {
      ruleResults.push(evaluated);
    }
    for (const ruleResult of ruleResults) {
      projections.push({
        name: 'repoctopus.rule.evaluation',
        value: 1,
        kind: 'sum',
        observedAt: envelope.observedAt,
        attributes: keyValues({
          'repoctopus.rule.category': boundedCategory(envelope.attributes.ruleCategory),
          'repoctopus.rule.result': ruleResult,
        }),
      });
    }
  }

  const workflowResult = envelope.attributes.workflowRunResult;
  const workflowName = envelope.attributes.workflowName;
  const workflowVersion = envelope.attributes.workflowVersion;
  if (
    (workflowResult === 'started' ||
      workflowResult === 'completed' ||
      workflowResult === 'failed') &&
    typeof workflowName === 'string' &&
    typeof workflowVersion === 'string'
  ) {
    const attributes = keyValues({
      'repoctopus.workflow.name': workflowName,
      'repoctopus.workflow.version': workflowVersion,
      'repoctopus.workflow.run.result': workflowResult,
    });
    projections.push({
      name: 'repoctopus.workflow.run',
      value: 1,
      kind: 'sum',
      observedAt: envelope.observedAt,
      attributes,
    });
    const duration = envelope.attributes.workflowRunDurationMs;
    if (workflowResult !== 'started' && typeof duration === 'number' && duration >= 0) {
      projections.push({
        name: 'repoctopus.workflow.run.duration',
        value: duration,
        kind: 'gauge',
        observedAt: envelope.observedAt,
        attributes,
      });
    }
  }
  return projections;
}

function metricProjections(envelopes: readonly ObservationEnvelope[]): MetricProjection[] {
  return envelopes.flatMap((envelope) => [
    {
      name: 'repoctopus.observation',
      value: 1,
      kind: 'sum' as const,
      observedAt: envelope.observedAt,
      attributes: metricAttributes(envelope),
    },
    ...legacyMetricProjections(envelope),
    ...specializedMetricProjections(envelope),
  ]);
}

function encodeMetrics(envelopes: readonly ObservationEnvelope[]) {
  const groups = new Map<string, MetricProjection[]>();
  for (const projection of metricProjections(envelopes)) {
    const key = `${projection.kind}:${projection.name}`;
    groups.set(key, [...(groups.get(key) ?? []), projection]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    const dataPoints = items.map((item) => {
      const point = {
        timeUnixNano: String(BigInt(new Date(item.observedAt).getTime()) * 1_000_000n),
        attributes: item.attributes,
      };
      return item.kind === 'gauge'
        ? { ...point, asDouble: item.value }
        : { ...point, asInt: String(item.value) };
    });
    return first.kind === 'gauge'
      ? { name: first.name, gauge: { dataPoints } }
      : {
          name: first.name,
          sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints },
        };
  });
}

function resource(attributes: Readonly<Record<string, string | number | boolean>> | undefined) {
  return attributes ? { attributes: keyValues(attributes) } : undefined;
}

/** Minimal standard OTLP/HTTP JSON payload used by both local and remote destinations. */
export function encodeObservationOtlpJson(
  envelopes: readonly ObservationEnvelope[],
  signal: OtlpSignal,
  options: {
    resourceAttributes?: Readonly<Record<string, string | number | boolean>>;
  } = {},
): Uint8Array {
  if (signal === 'log') {
    return Buffer.from(
      JSON.stringify({
        resourceLogs: [
          {
            ...(resource(options.resourceAttributes)
              ? { resource: resource(options.resourceAttributes) }
              : {}),
            scopeLogs: [
              {
                scope: { name: 'repoctopus-runtime', version: '0.1.0' },
                logRecords: envelopes.map((envelope) => ({
                  timeUnixNano: String(
                    BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                  ),
                  eventName: `repoctopus.${envelope.eventType}`,
                  body: { stringValue: 'Repoctopus observation' },
                  attributes: eventAttributes(envelope),
                })),
              },
            ],
          },
        ],
      }),
    );
  }
  if (signal === 'trace') {
    return Buffer.from(
      JSON.stringify({
        resourceSpans: [
          {
            ...(resource(options.resourceAttributes)
              ? { resource: resource(options.resourceAttributes) }
              : {}),
            scopeSpans: [
              {
                scope: { name: 'repoctopus-runtime', version: '0.1.0' },
                spans: envelopes.map((envelope) => ({
                  traceId: envelope.digest.slice(-32),
                  spanId: envelope.envelopeId.slice(-16),
                  name: `repoctopus.${envelope.eventType}`,
                  startTimeUnixNano: String(
                    BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                  ),
                  endTimeUnixNano: String(
                    BigInt(new Date(envelope.observedAt).getTime()) * 1_000_000n,
                  ),
                  attributes: eventAttributes(envelope),
                })),
              },
            ],
          },
        ],
      }),
    );
  }
  return Buffer.from(
    JSON.stringify({
      resourceMetrics: [
        {
          ...(resource(options.resourceAttributes)
            ? { resource: resource(options.resourceAttributes) }
            : {}),
          scopeMetrics: [
            {
              scope: { name: 'repoctopus-runtime', version: '0.1.0' },
              metrics: encodeMetrics(envelopes),
            },
          ],
        },
      ],
    }),
  );
}

function collect(value: unknown, result: ObservationEnvelope[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, result);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.attributes)) {
    for (const candidate of record.attributes) {
      if (typeof candidate !== 'object' || candidate === null) continue;
      const entry = candidate as Record<string, unknown>;
      if (
        entry.key !== ENVELOPE_ATTRIBUTE ||
        typeof entry.value !== 'object' ||
        entry.value === null
      ) {
        continue;
      }
      const encoded = (entry.value as Record<string, unknown>).stringValue;
      if (typeof encoded !== 'string') continue;
      try {
        const envelope: unknown = JSON.parse(encoded);
        if (isObservationEnvelope(envelope)) result.push(envelope);
      } catch {
        // The enclosing OTLP request is valid but this unrelated attribute is not an envelope.
      }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'attributes') collect(child, result);
  }
}

export function decodeObservationOtlpJson(body: Uint8Array): readonly ObservationEnvelope[] {
  const payload: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
  const observations: ObservationEnvelope[] = [];
  collect(payload, observations);
  const unique = new Map(observations.map((item) => [item.envelopeId, item]));
  return [...unique.values()];
}
