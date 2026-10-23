import { canonicalJson } from '../workflow-contract/canonical.js';

export type ProjectionChangeStatus = 'active' | 'completed' | 'failed';
export type ProjectionRunStatus = 'active' | 'completed' | 'failed';

export interface ObservationRecord {
  schemaVersion: 1;
  envelopeId: string;
  digest: string;
  streamId: string;
  eventId: string;
  eventType: string;
  sequence: number;
  observedAt: string;
  workspaceId: string;
  changeId: string;
  runId: string;
  changeStatus?: ProjectionChangeStatus;
  runStatus?: ProjectionRunStatus;
  stageName?: string;
}

export interface ProjectionGapRange {
  from: number;
  to: number;
}

export interface ChangeProjectionContext {
  workspaceId: string;
  change: { id: string; status: ProjectionChangeStatus | 'unknown' };
  run: { id: string; status: ProjectionRunStatus | 'unknown' };
  stage: { name: string; sequence: number } | null;
  latestSequence: number;
  lastObservedAt: string;
  freshness: 'live' | 'stale';
  gap: { detected: boolean; ranges: ProjectionGapRange[] };
}

export interface ChangeProjectionSnapshot {
  schemaVersion: 1;
  version: number;
  contexts: ChangeProjectionContext[];
  workspaceId: string | null;
  change: { id: string; status: ProjectionChangeStatus | 'unknown' } | null;
  activeChangeId: string | null;
  run: { id: string; status: ProjectionRunStatus | 'unknown' } | null;
  stage: { name: string; sequence: number } | null;
  latestSequence: number | null;
  lastObservedAt: string | null;
  freshness: 'empty' | 'live' | 'stale';
  gap: { detected: boolean; ranges: ProjectionGapRange[] };
}

export interface ChangeProjectionSnapshotOptions {
  now: string;
  staleAfterMs: number;
}

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/u;
const SAFE_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const CHANGE_STATUSES = new Set<ProjectionChangeStatus>(['active', 'completed', 'failed']);
const RUN_STATUSES = new Set<ProjectionRunStatus>(['active', 'completed', 'failed']);

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`Invalid ${label}`);
}

function assertTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Invalid ${label}`);
  }
  return timestamp;
}

export function validateObservationRecord(value: unknown): asserts value is ObservationRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid observation record');
  const record = value as ObservationRecord;
  if (
    record.schemaVersion !== 1 ||
    !DIGEST.test(record.envelopeId) ||
    !DIGEST.test(record.digest) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1
  ) {
    throw new Error('Invalid observation record');
  }
  assertId(record.streamId, 'observation stream id');
  assertId(record.eventId, 'observation event id');
  assertId(record.workspaceId, 'observation workspace id');
  assertId(record.changeId, 'observation change id');
  assertId(record.runId, 'observation run id');
  if (typeof record.eventType !== 'string' || !SAFE_NAME.test(record.eventType)) {
    throw new Error('Invalid observation event type');
  }
  assertTimestamp(record.observedAt, 'observation time');
  if (record.changeStatus !== undefined && !CHANGE_STATUSES.has(record.changeStatus)) {
    throw new Error('Invalid observation change status');
  }
  if (record.runStatus !== undefined && !RUN_STATUSES.has(record.runStatus)) {
    throw new Error('Invalid observation run status');
  }
  if (
    record.stageName !== undefined &&
    (typeof record.stageName !== 'string' || !SAFE_NAME.test(record.stageName))
  ) {
    throw new Error('Invalid observation stage name');
  }
}

function compareRecords(left: ObservationRecord, right: ObservationRecord): number {
  return (
    left.observedAt.localeCompare(right.observedAt) ||
    left.sequence - right.sequence ||
    left.eventId.localeCompare(right.eventId)
  );
}

function latestWith<T>(
  records: readonly ObservationRecord[],
  select: (record: ObservationRecord) => T | undefined,
): { record: ObservationRecord; value: T } | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (!record) continue;
    const value = select(record);
    if (value !== undefined) return { record, value };
  }
  return undefined;
}

function gapRanges(records: readonly ObservationRecord[]): ProjectionGapRange[] {
  const sequences = [...new Set(records.map((record) => record.sequence))].sort(
    (left, right) => left - right,
  );
  const ranges: ProjectionGapRange[] = [];
  let expected = 1;
  for (const sequence of sequences) {
    if (sequence > expected) ranges.push({ from: expected, to: sequence - 1 });
    expected = sequence + 1;
  }
  return ranges;
}

function projectContext(
  records: readonly ObservationRecord[],
  now: number,
  staleAfterMs: number,
): ChangeProjectionContext {
  const latest = records.at(-1);
  if (!latest) throw new Error('Cannot project an empty change context');
  const runRecords = records.filter((record) => record.runId === latest.runId);
  const streamRecords = runRecords.filter((record) => record.streamId === latest.streamId);
  const changeStatus = latestWith(records, (record) => record.changeStatus)?.value;
  const runStatus = latestWith(runRecords, (record) => record.runStatus)?.value;
  const stage = latestWith(runRecords, (record) => record.stageName);
  const ranges = gapRanges(streamRecords);
  return {
    workspaceId: latest.workspaceId,
    change: { id: latest.changeId, status: changeStatus ?? 'unknown' },
    run: { id: latest.runId, status: runStatus ?? 'unknown' },
    stage: stage ? { name: stage.value, sequence: stage.record.sequence } : null,
    latestSequence: Math.max(...streamRecords.map((record) => record.sequence)),
    lastObservedAt: latest.observedAt,
    freshness:
      now - assertTimestamp(latest.observedAt, 'latest observation time') > staleAfterMs
        ? 'stale'
        : 'live',
    gap: { detected: ranges.length > 0, ranges },
  };
}

/** Incremental, order-independent projection over trusted ObservationRecord metadata. */
export class ChangeProjectionReducer {
  private readonly records = new Map<string, ObservationRecord>();
  private readonly sequenceOwners = new Map<string, string>();

  accept(record: ObservationRecord): 'accepted' | 'duplicate' {
    validateObservationRecord(record);
    const current = this.records.get(record.eventId);
    if (current) {
      if (canonicalJson(current) !== canonicalJson(record)) {
        throw new Error(`Conflicting observation event: ${record.eventId}`);
      }
      return 'duplicate';
    }
    const sequenceKey = `${record.streamId}:${record.sequence}`;
    const owner = this.sequenceOwners.get(sequenceKey);
    if (owner !== undefined && owner !== record.eventId) {
      throw new Error(`Conflicting observation sequence: ${sequenceKey}`);
    }
    this.records.set(record.eventId, structuredClone(record));
    this.sequenceOwners.set(sequenceKey, record.eventId);
    return 'accepted';
  }

  snapshot(options: ChangeProjectionSnapshotOptions): ChangeProjectionSnapshot {
    const now = assertTimestamp(options.now, 'projection evaluation time');
    if (!Number.isSafeInteger(options.staleAfterMs) || options.staleAfterMs < 0) {
      throw new Error('Projection stale threshold must be a non-negative safe integer');
    }
    const allRecords = [...this.records.values()].sort(compareRecords);
    const latest = allRecords.at(-1);
    if (!latest) {
      return {
        schemaVersion: 1,
        version: 0,
        contexts: [],
        workspaceId: null,
        change: null,
        activeChangeId: null,
        run: null,
        stage: null,
        latestSequence: null,
        lastObservedAt: null,
        freshness: 'empty',
        gap: { detected: false, ranges: [] },
      };
    }

    const grouped = new Map<string, ObservationRecord[]>();
    for (const record of allRecords) {
      const key = `${record.workspaceId}\u0000${record.changeId}`;
      const records = grouped.get(key);
      if (records === undefined) grouped.set(key, [record]);
      else records.push(record);
    }
    const contexts = [...grouped.values()]
      .map((records) => projectContext(records, now, options.staleAfterMs))
      .sort(
        (left, right) =>
          right.lastObservedAt.localeCompare(left.lastObservedAt) ||
          left.workspaceId.localeCompare(right.workspaceId) ||
          left.change.id.localeCompare(right.change.id),
      );
    const current = contexts[0];
    if (!current) throw new Error('Projection context disappeared');

    return {
      schemaVersion: 1,
      version: this.records.size,
      contexts,
      workspaceId: current.workspaceId,
      change: current.change,
      activeChangeId: current.change.status === 'active' ? current.change.id : null,
      run: current.run,
      stage: current.stage,
      latestSequence: current.latestSequence,
      lastObservedAt: current.lastObservedAt,
      freshness: current.freshness,
      gap: current.gap,
    };
  }
}
