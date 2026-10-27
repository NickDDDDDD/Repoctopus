import type { ChangeProjectionObservation } from '../../../domains/telemetry/change-projection.js';
import { observationEventSchema } from '../../../domains/telemetry/observation-contract.js';

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

function executionStatus(
  eventName: string,
  prefix: 'work.host-' | 'host.' | 'validator.',
  result: string | null,
): 'running' | 'completed' | 'failed' | null {
  if (eventName === `${prefix}started`) return 'running';
  if (eventName !== `${prefix}completed`) return null;
  return result === 'failed' || result === 'rejected' ? 'failed' : 'completed';
}

function phase(value: string | null) {
  return value === 'open' ||
    value === 'design' ||
    value === 'build' ||
    value === 'verify' ||
    value === 'archive'
    ? value
    : null;
}

function continuation(value: string | null) {
  return value === 'execute' ||
    value === 'ask' ||
    value === 'wait' ||
    value === 'reconcile' ||
    value === 'done'
    ? value
    : null;
}

function lifecycleStatus(value: string | null) {
  return value === 'running' ||
    value === 'waiting' ||
    value === 'blocked' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'migration_required'
    ? value
    : null;
}

const PHASE_ORDER = ['open', 'design', 'build', 'verify', 'archive'] as const;

function lifecyclePhaseEvent(
  previous: ReturnType<typeof phase>,
  next: ReturnType<typeof phase>,
  status: ReturnType<typeof lifecycleStatus>,
): string | null {
  if (!next || !status) return null;
  if (previous && PHASE_ORDER.indexOf(next) < PHASE_ORDER.indexOf(previous)) {
    return 'change.phase.reopened';
  }
  return status === 'completed' ? 'change.phase.completed' : 'change.phase.entered';
}

function supportedObservationEvent(value: string): boolean {
  try {
    observationEventSchema(value);
    return true;
  } catch {
    return false;
  }
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
        const bodyEventName = bodyName(logRecord);
        const eventId = text(recordAttributes, 'repoctopus.event.id');
        const sequence = integer(recordAttributes, 'repoctopus.event.sequence');
        const changeId = text(recordAttributes, 'repoctopus.change.id');
        const runId = text(recordAttributes, 'repoctopus.run.id');
        const timestamp = observedAt(logRecord);
        if (
          !workspaceId ||
          !bodyEventName ||
          !eventId ||
          !sequence ||
          !changeId ||
          !runId ||
          !timestamp
        ) {
          continue;
        }
        const previousPhase = phase(text(recordAttributes, 'repoctopus.change.phase.before'));
        const lifecyclePhase = phase(text(recordAttributes, 'repoctopus.change.phase'));
        const lifecycleRunStatus = lifecycleStatus(
          text(recordAttributes, 'repoctopus.change.status'),
        );
        const normalizedLifecycleEvent =
          bodyEventName === 'Repoctopus Change lifecycle phase event'
            ? lifecyclePhaseEvent(previousPhase, lifecyclePhase, lifecycleRunStatus)
            : null;
        const eventName = normalizedLifecycleEvent ?? bodyEventName;
        if (!normalizedLifecycleEvent && !supportedObservationEvent(eventName)) continue;
        const observationPhase =
          lifecyclePhase ?? phase(text(recordAttributes, 'repoctopus.execution.phase'));
        const workId = text(recordAttributes, 'repoctopus.execution.work.id');
        const workKind = text(recordAttributes, 'repoctopus.execution.work.kind');
        const attempt = integer(recordAttributes, 'repoctopus.execution.attempt');
        const skillName = text(recordAttributes, 'repoctopus.skill.name');
        const skillRole = text(recordAttributes, 'repoctopus.skill.role');
        const result = text(recordAttributes, 'repoctopus.execution.result');
        const taskId =
          text(recordAttributes, 'repoctopus.task.id') ??
          text(recordAttributes, 'repoctopus.execution.task.id');
        const taskRevision =
          text(recordAttributes, 'repoctopus.task.revision') ??
          text(recordAttributes, 'repoctopus.execution.task.revision');
        const executorId = text(recordAttributes, 'repoctopus.executor.id');
        const validatorId = text(recordAttributes, 'repoctopus.validator.id');
        const hostStatus =
          executionStatus(eventName, 'work.host-', result) ??
          executionStatus(eventName, 'host.', result);
        const validatorStatus = executionStatus(eventName, 'validator.', result);
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
          phase: observationPhase,
          work: workId && workKind && attempt ? { id: workId, kind: workKind, attempt } : null,
          skill:
            skillName && (skillRole === 'action' || skillRole === 'augmentation')
              ? { name: skillName, role: skillRole }
              : null,
          task: taskId ? { id: taskId, revision: taskRevision } : null,
          host: executorId && hostStatus ? { id: executorId, status: hostStatus } : null,
          validator:
            validatorId && validatorStatus ? { id: validatorId, status: validatorStatus } : null,
          continuation: continuation(text(recordAttributes, 'repoctopus.next_action.kind')),
          recoverySourcePhase:
            phase(text(recordAttributes, 'repoctopus.recovery.source_phase')) ??
            (normalizedLifecycleEvent === 'change.phase.reopened' ? previousPhase : null),
          previousPhase,
          lifecycleStatus: lifecycleRunStatus,
          result,
        });
      }
    }
  }
  return observations;
}
