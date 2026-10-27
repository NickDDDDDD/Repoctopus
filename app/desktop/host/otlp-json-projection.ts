import type { ChangeProjectionObservation } from '../../../domains/telemetry/change-projection.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function anyValue(value: unknown): string | number | boolean | null {
  const candidate = object(value);
  if (!candidate) return null;
  if (typeof candidate.stringValue === 'string') return candidate.stringValue;
  if (typeof candidate.intValue === 'string' || typeof candidate.intValue === 'number') {
    const parsed = Number(candidate.intValue);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (typeof candidate.doubleValue === 'number' && Number.isFinite(candidate.doubleValue)) {
    return candidate.doubleValue;
  }
  return typeof candidate.boolValue === 'boolean' ? candidate.boolValue : null;
}

function attributes(value: unknown): Readonly<Record<string, string | number | boolean>> {
  const result: Record<string, string | number | boolean> = {};
  for (const entry of array(value)) {
    const candidate = object(entry);
    if (!candidate || typeof candidate.key !== 'string') continue;
    const parsed = anyValue(candidate.value);
    if (parsed !== null) result[candidate.key] = parsed;
  }
  return result;
}

function text(
  source: Readonly<Record<string, string | number | boolean>>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function integer(
  source: Readonly<Record<string, string | number | boolean>>,
  key: string,
): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function observedAt(record: JsonObject): string | null {
  if (typeof record.timeUnixNano !== 'string' || !/^\d+$/u.test(record.timeUnixNano)) return null;
  const milliseconds = Number(BigInt(record.timeUnixNano) / 1_000_000n);
  if (!Number.isSafeInteger(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

function bodyName(record: JsonObject): string | null {
  const value = anyValue(record.body);
  return typeof value === 'string' ? value : null;
}

export function decodeOtlpJsonProjectionObservations(
  body: Uint8Array,
): readonly ChangeProjectionObservation[] {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    return [];
  }
  const root = object(payload);
  const observations: ChangeProjectionObservation[] = [];
  for (const resourceLogValue of array(root?.resourceLogs)) {
    const resourceLog = object(resourceLogValue);
    const resource = object(resourceLog?.resource);
    const resourceAttributes = attributes(resource?.attributes);
    const workspaceId =
      text(resourceAttributes, 'repoctopus.workspace.id') ??
      text(resourceAttributes, 'repoctopus.project.id');
    for (const scopeLogValue of array(resourceLog?.scopeLogs)) {
      const scopeLog = object(scopeLogValue);
      for (const logRecordValue of array(scopeLog?.logRecords)) {
        const logRecord = object(logRecordValue);
        if (!logRecord) continue;
        const recordAttributes = attributes(logRecord.attributes);
        const eventName = bodyName(logRecord);
        const eventId = text(recordAttributes, 'repoctopus.event.id');
        const sequence = integer(recordAttributes, 'repoctopus.event.sequence');
        const changeId = text(recordAttributes, 'repoctopus.change.id');
        const runId = text(recordAttributes, 'repoctopus.run.id');
        const timestamp = observedAt(logRecord);
        if (
          !workspaceId ||
          !eventName ||
          !eventId ||
          !sequence ||
          !changeId ||
          !runId ||
          !timestamp
        ) {
          continue;
        }
        const phase = text(recordAttributes, 'repoctopus.execution.phase');
        const workId = text(recordAttributes, 'repoctopus.execution.work.id');
        const workKind = text(recordAttributes, 'repoctopus.execution.work.kind');
        const attempt = integer(recordAttributes, 'repoctopus.execution.attempt');
        const skillName = text(recordAttributes, 'repoctopus.execution.skillName');
        const skillRole = text(recordAttributes, 'repoctopus.execution.skillRole');
        observations.push({
          schemaVersion: 1,
          sequence,
          eventId,
          eventName,
          observedAt: timestamp,
          workspaceId,
          changeId,
          runId,
          workflowName: text(recordAttributes, 'repoctopus.workflow.name'),
          phase:
            phase === 'open' ||
            phase === 'design' ||
            phase === 'build' ||
            phase === 'verify' ||
            phase === 'archive'
              ? phase
              : null,
          work: workId && workKind && attempt ? { id: workId, kind: workKind, attempt } : null,
          skill:
            skillName && (skillRole === 'action' || skillRole === 'augmentation')
              ? { name: skillName, role: skillRole }
              : null,
          result: text(recordAttributes, 'repoctopus.execution.result'),
        });
      }
    }
  }
  return observations;
}
