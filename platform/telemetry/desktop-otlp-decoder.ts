import {
  validateObservationRecord,
  type ObservationRecord,
  type ProjectionChangeStatus,
  type ProjectionRunStatus,
  type ProjectionTaskStatus,
} from '../../domains/telemetry/change-projection.js';
import type { DesktopOtlpBatch } from './desktop-otlp-receiver.js';

type OtlpAttributes = Readonly<Record<string, string | number | boolean>>;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function anyValue(value: unknown): string | number | boolean | undefined {
  const candidate = object(value);
  if (!candidate) return undefined;
  if (typeof candidate.stringValue === 'string') return candidate.stringValue;
  if (typeof candidate.boolValue === 'boolean') return candidate.boolValue;
  if (typeof candidate.intValue === 'string' && /^-?\d+$/u.test(candidate.intValue)) {
    const parsed = Number(candidate.intValue);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  if (typeof candidate.intValue === 'number' && Number.isSafeInteger(candidate.intValue)) {
    return candidate.intValue;
  }
  if (typeof candidate.doubleValue === 'number' && Number.isFinite(candidate.doubleValue)) {
    return candidate.doubleValue;
  }
  return undefined;
}

function attributes(value: unknown): OtlpAttributes {
  const result: Record<string, string | number | boolean> = {};
  for (const entryValue of array(value)) {
    const entry = object(entryValue);
    if (!entry || typeof entry.key !== 'string') continue;
    const decoded = anyValue(entry.value);
    if (decoded !== undefined) result[entry.key] = decoded;
  }
  return result;
}

function stringAttribute(values: OtlpAttributes, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function requiredString(values: OtlpAttributes, key: string): string {
  const value = stringAttribute(values, key);
  if (value === undefined) throw new Error(`Missing Repoctopus OTLP attribute: ${key}`);
  return value;
}

function status<T extends string>(
  value: string | undefined,
  allowed: ReadonlySet<T>,
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.has(value as T)) throw new Error(`Invalid Repoctopus OTLP ${label}`);
  return value as T;
}

const CHANGE_STATUSES = new Set<ProjectionChangeStatus>(['active', 'completed', 'failed']);
const RUN_STATUSES = new Set<ProjectionRunStatus>(['active', 'completed', 'failed']);
const TASK_STATUSES = new Set<ProjectionTaskStatus>(['pending', 'blocked', 'completed', 'failed']);

function recordFromAttributes(values: OtlpAttributes): ObservationRecord | null {
  const schemaVersion = values['repoctopus.telemetry.schema.version'];
  if (schemaVersion === undefined) return null;
  if (schemaVersion !== 1) throw new Error('Unsupported Repoctopus OTLP schema version');
  // Workflow telemetry without a trusted Change binding is valid for remote
  // observability but does not describe a Desktop change projection.
  if (stringAttribute(values, 'repoctopus.change.id') === undefined) return null;
  const sequence = values['repoctopus.event.sequence'];
  if (typeof sequence !== 'number') throw new Error('Missing Repoctopus OTLP event sequence');
  const changeStatus = status(
    stringAttribute(values, 'repoctopus.change.status'),
    CHANGE_STATUSES,
    'change status',
  );
  const runStatus = status(
    stringAttribute(values, 'repoctopus.run.status'),
    RUN_STATUSES,
    'run status',
  );
  const stageName = stringAttribute(values, 'repoctopus.stage.name');
  const workflowName = stringAttribute(values, 'repoctopus.workflow.name');
  const workflowVersion = stringAttribute(values, 'repoctopus.workflow.version');
  const executionId = stringAttribute(values, 'repoctopus.execution.id');
  const parentExecutionId = stringAttribute(values, 'repoctopus.execution.parent.id');
  const executionKind = stringAttribute(values, 'repoctopus.execution.kind');
  const subjectKind = stringAttribute(values, 'repoctopus.execution.subject.kind');
  const subjectId = stringAttribute(values, 'repoctopus.execution.subject.id');
  const subjectProvider = stringAttribute(values, 'repoctopus.execution.subject.provider');
  const taskId = stringAttribute(values, 'repoctopus.task.id');
  const taskRef = stringAttribute(values, 'repoctopus.task.ref');
  const taskType = stringAttribute(values, 'repoctopus.task.type');
  const taskStatus = status(
    stringAttribute(values, 'repoctopus.task.status'),
    TASK_STATUSES,
    'task status',
  );
  const record: ObservationRecord = {
    schemaVersion: 1,
    envelopeId: requiredString(values, 'repoctopus.envelope.id'),
    digest: requiredString(values, 'repoctopus.envelope.digest'),
    streamId: requiredString(values, 'repoctopus.stream.id'),
    eventId: requiredString(values, 'repoctopus.event.id'),
    eventType: requiredString(values, 'repoctopus.event.type'),
    sequence,
    observedAt: requiredString(values, 'repoctopus.observed_at'),
    workspaceId: requiredString(values, 'repoctopus.workspace.id'),
    changeId: requiredString(values, 'repoctopus.change.id'),
    runId: requiredString(values, 'repoctopus.run.id'),
    ...(changeStatus === undefined ? {} : { changeStatus }),
    ...(runStatus === undefined ? {} : { runStatus }),
    ...(stageName === undefined ? {} : { stageName }),
    ...(workflowName === undefined ? {} : { workflowName }),
    ...(workflowVersion === undefined ? {} : { workflowVersion }),
    ...(executionId === undefined ? {} : { executionId }),
    ...(parentExecutionId === undefined ? {} : { parentExecutionId }),
    ...(executionKind === undefined ? {} : { executionKind }),
    ...(subjectKind === undefined ? {} : { subjectKind }),
    ...(subjectId === undefined ? {} : { subjectId }),
    ...(subjectProvider === undefined ? {} : { subjectProvider }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(taskRef === undefined ? {} : { taskRef }),
    ...(taskType === undefined ? {} : { taskType }),
    ...(taskStatus === undefined ? {} : { taskStatus }),
  };
  validateObservationRecord(record);
  return record;
}

function mergeAttributes(resource: unknown, record: unknown): OtlpAttributes {
  return { ...attributes(object(resource)?.attributes), ...attributes(object(record)?.attributes) };
}

function logAttributeSets(payload: Readonly<Record<string, unknown>>): OtlpAttributes[] {
  const sets: OtlpAttributes[] = [];
  for (const resourceLogValue of array(payload.resourceLogs)) {
    const resourceLog = object(resourceLogValue);
    if (!resourceLog) continue;
    for (const scopeLogValue of array(resourceLog.scopeLogs)) {
      const scopeLog = object(scopeLogValue);
      if (!scopeLog) continue;
      for (const logRecord of array(scopeLog.logRecords)) {
        sets.push(mergeAttributes(resourceLog.resource, logRecord));
      }
    }
  }
  return sets;
}

function traceAttributeSets(payload: Readonly<Record<string, unknown>>): OtlpAttributes[] {
  const sets: OtlpAttributes[] = [];
  for (const resourceSpanValue of array(payload.resourceSpans)) {
    const resourceSpan = object(resourceSpanValue);
    if (!resourceSpan) continue;
    for (const scopeSpanValue of array(resourceSpan.scopeSpans)) {
      const scopeSpan = object(scopeSpanValue);
      if (!scopeSpan) continue;
      for (const span of array(scopeSpan.spans)) {
        sets.push(mergeAttributes(resourceSpan.resource, span));
      }
    }
  }
  return sets;
}

/** Decode only allowlisted Repoctopus metadata; OTLP bodies and events are never projected. */
export function decodeDesktopOtlpBatch(batch: DesktopOtlpBatch): ObservationRecord[] {
  const sets =
    batch.signal === 'logs'
      ? logAttributeSets(batch.payload)
      : batch.signal === 'traces'
        ? traceAttributeSets(batch.payload)
        : [];
  return sets
    .map(recordFromAttributes)
    .filter((record): record is ObservationRecord => record !== null);
}
