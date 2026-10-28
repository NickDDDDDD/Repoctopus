import type { ChangePhase, ObservationBuildAction, ObservationEnvelope } from './observation.js';

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
  latestSequence: number;
  latestObservedAt: string;
}

export interface ChangeProjectionSnapshot {
  schemaVersion: 1;
  version: number;
  changes: ProjectedChange[];
  freshness: { status: 'empty' | 'live' | 'gap'; missing: number[] };
  seenEnvelopeIds: string[];
  receivedSequences: Record<string, number[]>;
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

function projectChange(
  current: ProjectedChange | undefined,
  envelope: ObservationEnvelope,
): ProjectedChange | undefined {
  const { workspaceId, changeId } = envelope.correlation;
  if (!workspaceId || !changeId) return current;
  const newer = current === undefined || envelope.identity.sequence >= current.latestSequence;
  if (!newer) return current;
  const value = <T>(next: T | undefined, previous: T | null): T | null =>
    next === undefined ? previous : next;
  return {
    workspaceId,
    changeId,
    runId: envelope.identity.runId,
    phase: value(envelope.correlation.phase, current?.phase ?? null),
    buildAction: value(envelope.correlation.buildAction, current?.buildAction ?? null),
    status: value(
      typeof envelope.attributes.result === 'string' ? envelope.attributes.result : undefined,
      current?.status ?? null,
    ),
    workId: value(envelope.correlation.workId, current?.workId ?? null),
    taskId: value(envelope.correlation.taskId, current?.taskId ?? null),
    attempt: value(envelope.correlation.attempt, current?.attempt ?? null),
    hostId: value(envelope.correlation.hostId, current?.hostId ?? null),
    validatorId: value(envelope.correlation.validatorId, current?.validatorId ?? null),
    continuation: value(envelope.correlation.continuation, current?.continuation ?? null),
    latestSequence: envelope.identity.sequence,
    latestObservedAt: envelope.observedAt,
  };
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
  next.freshness = { status: missing.length === 0 ? 'live' : 'gap', missing };
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
