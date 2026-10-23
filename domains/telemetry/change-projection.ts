import { canonicalJson } from '../workflow-contract/canonical.js';

export type ProjectionChangeStatus = 'active' | 'completed' | 'failed';
export type ProjectionRunStatus = 'active' | 'completed' | 'failed';
export type ProjectionTaskStatus = 'pending' | 'blocked' | 'completed' | 'failed';
export type ProjectionVerificationStatus =
  | 'running'
  | 'completed'
  | 'superseded'
  | 'satisfied'
  | 'blocked';
export type ProjectionVerificationOutcome =
  | 'passed'
  | 'failed'
  | 'incomplete'
  | 'passed_with_warnings';
export type ProjectionGateStatus = 'satisfied' | 'blocked';

export interface ProjectionExecutionSubject {
  kind: string;
  id: string;
  provider: string | null;
}

export interface ProjectionTask {
  id: string;
  ref: string | null;
  type: string | null;
  status: ProjectionTaskStatus | 'unknown';
  stageName: string | null;
  executionId: string | null;
  parentExecutionId: string | null;
  subject: ProjectionExecutionSubject | null;
  lastObservedAt: string;
}

export interface ProjectionTaskState {
  total: number;
  completed: number;
  failed: number;
  unknown: number;
  active: ProjectionTask[];
}

export interface ProjectionVerification {
  id: string;
  attemptId: string | null;
  bundleId: string | null;
  status: ProjectionVerificationStatus | null;
  gateStatus: ProjectionGateStatus | null;
  outcome: ProjectionVerificationOutcome | null;
  lastObservedAt: string;
}

export interface ProjectionArtifact {
  digest: string;
  type: string | null;
  mediaType: string | null;
  size: number | null;
  redacted: boolean | null;
  verificationId: string | null;
  lastObservedAt: string;
}

export interface ProjectionBlocker {
  category: string;
  requestId: string;
  lastObservedAt: string;
}

export interface ProjectionNextAction {
  id: string;
  type: string | null;
  ref: string | null;
  stageName: string | null;
  lastObservedAt: string;
}

export interface ProjectionRecentEvent {
  eventId: string;
  eventType: string;
  streamId: string;
  sequence: number;
  observedAt: string;
  stageName: string | null;
  taskRef: string | null;
  taskStatus: ProjectionTaskStatus | null;
  verificationStatus: ProjectionVerificationStatus | null;
}

export interface ProjectionAssuranceState {
  verification: ProjectionVerification | null;
  artifacts: ProjectionArtifact[];
  blockers: ProjectionBlocker[];
  nextActions: ProjectionNextAction[];
}

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
  workflowName?: string;
  workflowVersion?: string;
  executionId?: string;
  parentExecutionId?: string;
  executionKind?: string;
  subjectKind?: string;
  subjectId?: string;
  subjectProvider?: string;
  taskId?: string;
  taskRef?: string;
  taskType?: string;
  taskStatus?: ProjectionTaskStatus;
  verificationId?: string;
  verificationStatus?: ProjectionVerificationStatus;
  verificationOutcome?: ProjectionVerificationOutcome;
  evidenceAttemptId?: string;
  evidenceBundleId?: string;
  evidenceGateStatus?: ProjectionGateStatus;
  artifactDigest?: string;
  artifactType?: string;
  artifactMediaType?: string;
  artifactSize?: number;
  artifactRedacted?: boolean;
  blockerCategory?: string;
  blockerRequestId?: string;
  nextActionId?: string;
  nextActionType?: string;
  nextActionRef?: string;
  nextActionStage?: string;
}

export interface ProjectionGapRange {
  from: number;
  to: number;
}

export interface ChangeProjectionContext {
  workspaceId: string;
  change: { id: string; status: ProjectionChangeStatus | 'unknown' };
  run: { id: string; status: ProjectionRunStatus | 'unknown' };
  workflow: { name: string; version: string | null } | null;
  stage: { name: string; sequence: number } | null;
  executionSubjects: ProjectionExecutionSubject[];
  tasks: ProjectionTaskState | null;
  assurance: ProjectionAssuranceState | null;
  recentEvents: ProjectionRecentEvent[];
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
const SAFE_REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const SAFE_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\\\\|\/)/iu;
const CHANGE_STATUSES = new Set<ProjectionChangeStatus>(['active', 'completed', 'failed']);
const RUN_STATUSES = new Set<ProjectionRunStatus>(['active', 'completed', 'failed']);
const TASK_STATUSES = new Set<ProjectionTaskStatus>(['pending', 'blocked', 'completed', 'failed']);
const VERIFICATION_STATUSES = new Set<ProjectionVerificationStatus>([
  'running',
  'completed',
  'superseded',
  'satisfied',
  'blocked',
]);
const VERIFICATION_OUTCOMES = new Set<ProjectionVerificationOutcome>([
  'passed',
  'failed',
  'incomplete',
  'passed_with_warnings',
]);
const GATE_STATUSES = new Set<ProjectionGateStatus>(['satisfied', 'blocked']);
const MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;\s*[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+:-]+)*$/iu;
const RECENT_EVENT_LIMIT = 20;

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`Invalid ${label}`);
}

function assertReference(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_REFERENCE.test(value) || ABSOLUTE_PATH.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertName(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_NAME.test(value)) throw new Error(`Invalid ${label}`);
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
  if (record.workflowName !== undefined)
    assertName(record.workflowName, 'observation workflow name');
  if (record.workflowVersion !== undefined) {
    assertReference(record.workflowVersion, 'observation workflow version');
  }
  if (record.executionId !== undefined) assertId(record.executionId, 'observation execution id');
  if (record.parentExecutionId !== undefined) {
    assertId(record.parentExecutionId, 'observation parent execution id');
  }
  if (record.executionKind !== undefined) {
    assertName(record.executionKind, 'observation execution kind');
  }
  const hasSubjectKind = record.subjectKind !== undefined;
  const hasSubjectId = record.subjectId !== undefined;
  if (hasSubjectKind !== hasSubjectId) throw new Error('Incomplete observation execution subject');
  if (record.subjectKind !== undefined) {
    assertName(record.subjectKind, 'observation execution subject kind');
  }
  if (record.subjectId !== undefined) {
    assertReference(record.subjectId, 'observation execution subject id');
  }
  if (record.subjectProvider !== undefined) {
    if (!hasSubjectId) throw new Error('Observation subject provider requires a subject');
    assertReference(record.subjectProvider, 'observation execution subject provider');
  }
  if (record.taskId !== undefined) assertId(record.taskId, 'observation task id');
  if (record.taskRef !== undefined) assertReference(record.taskRef, 'observation task ref');
  if (record.taskType !== undefined) assertName(record.taskType, 'observation task type');
  if (record.taskStatus !== undefined && !TASK_STATUSES.has(record.taskStatus)) {
    throw new Error('Invalid observation task status');
  }
  if (
    record.taskId === undefined &&
    (record.taskRef !== undefined ||
      record.taskType !== undefined ||
      record.taskStatus !== undefined)
  ) {
    throw new Error('Observation task metadata requires a task id');
  }
  if (record.verificationId !== undefined) {
    assertId(record.verificationId, 'observation verification id');
  }
  if (
    record.verificationStatus !== undefined &&
    !VERIFICATION_STATUSES.has(record.verificationStatus)
  ) {
    throw new Error('Invalid observation verification status');
  }
  if (
    record.verificationOutcome !== undefined &&
    !VERIFICATION_OUTCOMES.has(record.verificationOutcome)
  ) {
    throw new Error('Invalid observation verification outcome');
  }
  if (record.evidenceAttemptId !== undefined) {
    assertId(record.evidenceAttemptId, 'observation evidence attempt id');
  }
  if (record.evidenceBundleId !== undefined) {
    assertId(record.evidenceBundleId, 'observation evidence bundle id');
  }
  if (record.evidenceGateStatus !== undefined && !GATE_STATUSES.has(record.evidenceGateStatus)) {
    throw new Error('Invalid observation evidence gate status');
  }
  if (record.artifactDigest !== undefined && !DIGEST.test(record.artifactDigest)) {
    throw new Error('Invalid observation artifact digest');
  }
  if (record.artifactType !== undefined) {
    assertReference(record.artifactType, 'observation artifact type');
  }
  if (record.artifactMediaType !== undefined && !MEDIA_TYPE.test(record.artifactMediaType)) {
    throw new Error('Invalid observation artifact media type');
  }
  if (
    record.artifactSize !== undefined &&
    (!Number.isSafeInteger(record.artifactSize) || record.artifactSize < 0)
  ) {
    throw new Error('Invalid observation artifact size');
  }
  if (record.artifactRedacted !== undefined && typeof record.artifactRedacted !== 'boolean') {
    throw new Error('Invalid observation artifact redaction state');
  }
  if (
    record.artifactDigest === undefined &&
    (record.artifactType !== undefined ||
      record.artifactMediaType !== undefined ||
      record.artifactSize !== undefined ||
      record.artifactRedacted !== undefined)
  ) {
    throw new Error('Observation artifact metadata requires a digest');
  }
  if (record.blockerCategory !== undefined) {
    assertName(record.blockerCategory, 'observation blocker category');
  }
  if (record.blockerRequestId !== undefined) {
    assertId(record.blockerRequestId, 'observation blocker request id');
  }
  if ((record.blockerCategory === undefined) !== (record.blockerRequestId === undefined)) {
    throw new Error('Incomplete observation blocker metadata');
  }
  if (record.nextActionId !== undefined) {
    assertId(record.nextActionId, 'observation next action id');
  }
  if (record.nextActionType !== undefined) {
    assertName(record.nextActionType, 'observation next action type');
  }
  if (record.nextActionRef !== undefined) {
    assertReference(record.nextActionRef, 'observation next action ref');
  }
  if (record.nextActionStage !== undefined) {
    assertName(record.nextActionStage, 'observation next action stage');
  }
  if (
    record.nextActionId === undefined &&
    (record.nextActionType !== undefined ||
      record.nextActionRef !== undefined ||
      record.nextActionStage !== undefined)
  ) {
    throw new Error('Observation next action metadata requires an id');
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

function subjectFromRecord(record: ObservationRecord): ProjectionExecutionSubject | undefined {
  if (record.subjectKind === undefined || record.subjectId === undefined) return undefined;
  return {
    kind: record.subjectKind,
    id: record.subjectId,
    provider: record.subjectProvider ?? null,
  };
}

function projectTask(records: readonly ObservationRecord[]): ProjectionTask {
  const latest = records.at(-1);
  if (!latest?.taskId) throw new Error('Cannot project a task without identity');
  const status = latestWith(records, (record) => record.taskStatus)?.value ?? 'unknown';
  const subject = latestWith(records, subjectFromRecord)?.value ?? null;
  return {
    id: latest.taskId,
    ref: latestWith(records, (record) => record.taskRef)?.value ?? null,
    type: latestWith(records, (record) => record.taskType)?.value ?? null,
    status,
    stageName: latestWith(records, (record) => record.stageName)?.value ?? null,
    executionId: latestWith(records, (record) => record.executionId)?.value ?? null,
    parentExecutionId: latestWith(records, (record) => record.parentExecutionId)?.value ?? null,
    subject,
    lastObservedAt: latest.observedAt,
  };
}

function projectTasks(records: readonly ObservationRecord[]): ProjectionTaskState | null {
  const grouped = new Map<string, ObservationRecord[]>();
  for (const record of records) {
    if (record.taskId === undefined) continue;
    const taskRecords = grouped.get(record.taskId);
    if (taskRecords === undefined) grouped.set(record.taskId, [record]);
    else taskRecords.push(record);
  }
  if (grouped.size === 0) return null;
  const tasks = [...grouped.values()].map(projectTask);
  const active = tasks
    .filter((task) => task.status === 'pending' || task.status === 'blocked')
    .sort(
      (left, right) =>
        right.lastObservedAt.localeCompare(left.lastObservedAt) || left.id.localeCompare(right.id),
    );
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    unknown: tasks.filter((task) => task.status === 'unknown').length,
    active,
  };
}

function projectSubjects(records: readonly ObservationRecord[]): ProjectionExecutionSubject[] {
  const subjects = new Map<string, ProjectionExecutionSubject>();
  for (const record of records) {
    const subject = subjectFromRecord(record);
    if (subject === undefined) continue;
    subjects.set(`${subject.kind}\u0000${subject.id}\u0000${subject.provider ?? ''}`, subject);
  }
  return [...subjects.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      (left.provider ?? '').localeCompare(right.provider ?? ''),
  );
}

function projectAssurance(records: readonly ObservationRecord[]): ProjectionAssuranceState | null {
  const assuranceRecords = records.filter(
    (record) =>
      record.verificationId !== undefined ||
      record.evidenceAttemptId !== undefined ||
      record.evidenceBundleId !== undefined ||
      record.evidenceGateStatus !== undefined ||
      record.verificationOutcome !== undefined ||
      record.artifactDigest !== undefined ||
      record.blockerRequestId !== undefined ||
      record.nextActionId !== undefined,
  );
  if (assuranceRecords.length === 0) return null;

  const latestVerificationRecord = [...assuranceRecords]
    .reverse()
    .find((record) => record.verificationId !== undefined);
  let verification: ProjectionVerification | null = null;
  if (latestVerificationRecord?.verificationId !== undefined) {
    const verificationRecords = records.filter(
      (record) => record.verificationId === latestVerificationRecord.verificationId,
    );
    const latest = verificationRecords.at(-1)!;
    verification = {
      id: latestVerificationRecord.verificationId,
      attemptId:
        latestWith(verificationRecords, (record) => record.evidenceAttemptId)?.value ?? null,
      bundleId: latestWith(verificationRecords, (record) => record.evidenceBundleId)?.value ?? null,
      status: latestWith(verificationRecords, (record) => record.verificationStatus)?.value ?? null,
      gateStatus:
        latestWith(verificationRecords, (record) => record.evidenceGateStatus)?.value ?? null,
      outcome:
        latestWith(verificationRecords, (record) => record.verificationOutcome)?.value ?? null,
      lastObservedAt: latest.observedAt,
    };
  }

  const artifactRecords = records.filter(
    (record) =>
      record.artifactDigest !== undefined &&
      (verification === null ||
        record.verificationId === undefined ||
        record.verificationId === verification.id),
  );
  const artifactsByDigest = new Map<string, ObservationRecord[]>();
  for (const record of artifactRecords) {
    const digest = record.artifactDigest!;
    const existing = artifactsByDigest.get(digest);
    if (existing === undefined) artifactsByDigest.set(digest, [record]);
    else existing.push(record);
  }
  const artifacts = [...artifactsByDigest.entries()]
    .map(([digest, artifactFacts]): ProjectionArtifact => {
      const latest = artifactFacts.at(-1)!;
      return {
        digest,
        type: latestWith(artifactFacts, (record) => record.artifactType)?.value ?? null,
        mediaType: latestWith(artifactFacts, (record) => record.artifactMediaType)?.value ?? null,
        size: latestWith(artifactFacts, (record) => record.artifactSize)?.value ?? null,
        redacted: latestWith(artifactFacts, (record) => record.artifactRedacted)?.value ?? null,
        verificationId: latestWith(artifactFacts, (record) => record.verificationId)?.value ?? null,
        lastObservedAt: latest.observedAt,
      };
    })
    .sort(
      (left, right) =>
        right.lastObservedAt.localeCompare(left.lastObservedAt) ||
        left.digest.localeCompare(right.digest),
    );

  const latestTaskStatus = new Map<string, ProjectionTaskStatus>();
  for (const record of records) {
    if (record.taskId !== undefined && record.taskStatus !== undefined) {
      latestTaskStatus.set(record.taskId, record.taskStatus);
    }
  }
  const blockerRecords = new Map<string, ObservationRecord>();
  for (const record of records) {
    if (record.blockerCategory !== undefined && record.blockerRequestId !== undefined) {
      blockerRecords.set(`${record.blockerCategory}\u0000${record.blockerRequestId}`, record);
    }
  }
  const blockers = [...blockerRecords.values()]
    .filter((record) => {
      const taskStatus = latestTaskStatus.get(record.blockerRequestId!);
      if (taskStatus === 'completed' || taskStatus === 'failed') return false;
      if (record.blockerCategory !== 'evidence-gate') return true;
      return (
        verification?.gateStatus === 'blocked' && verification.bundleId === record.blockerRequestId
      );
    })
    .map(
      (record): ProjectionBlocker => ({
        category: record.blockerCategory!,
        requestId: record.blockerRequestId!,
        lastObservedAt: record.observedAt,
      }),
    )
    .sort(
      (left, right) =>
        right.lastObservedAt.localeCompare(left.lastObservedAt) ||
        left.requestId.localeCompare(right.requestId),
    );

  const nextActionRecords = new Map<string, ObservationRecord[]>();
  for (const record of records) {
    if (record.nextActionId === undefined) continue;
    const existing = nextActionRecords.get(record.nextActionId);
    if (existing === undefined) nextActionRecords.set(record.nextActionId, [record]);
    else existing.push(record);
  }
  const nextActions = [...nextActionRecords.entries()]
    .filter(([id]) => {
      const taskStatus = latestTaskStatus.get(id);
      return taskStatus !== 'completed' && taskStatus !== 'failed';
    })
    .map(([id, actionRecords]): ProjectionNextAction => {
      const latest = actionRecords.at(-1)!;
      return {
        id,
        type: latestWith(actionRecords, (record) => record.nextActionType)?.value ?? null,
        ref: latestWith(actionRecords, (record) => record.nextActionRef)?.value ?? null,
        stageName: latestWith(actionRecords, (record) => record.nextActionStage)?.value ?? null,
        lastObservedAt: latest.observedAt,
      };
    })
    .sort(
      (left, right) =>
        right.lastObservedAt.localeCompare(left.lastObservedAt) || left.id.localeCompare(right.id),
    );

  return { verification, artifacts, blockers, nextActions };
}

function projectRecentEvents(records: readonly ObservationRecord[]): ProjectionRecentEvent[] {
  return [...records]
    .sort((left, right) => compareRecords(right, left))
    .slice(0, RECENT_EVENT_LIMIT)
    .map((record) => ({
      eventId: record.eventId,
      eventType: record.eventType,
      streamId: record.streamId,
      sequence: record.sequence,
      observedAt: record.observedAt,
      stageName: record.stageName ?? null,
      taskRef: record.taskRef ?? null,
      taskStatus: record.taskStatus ?? null,
      verificationStatus: record.verificationStatus ?? null,
    }));
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
  const workflowName = latestWith(runRecords, (record) => record.workflowName)?.value;
  const workflowVersion = latestWith(runRecords, (record) => record.workflowVersion)?.value;
  const stage = latestWith(runRecords, (record) => record.stageName);
  const ranges = gapRanges(streamRecords);
  return {
    workspaceId: latest.workspaceId,
    change: { id: latest.changeId, status: changeStatus ?? 'unknown' },
    run: { id: latest.runId, status: runStatus ?? 'unknown' },
    workflow:
      workflowName === undefined ? null : { name: workflowName, version: workflowVersion ?? null },
    stage: stage ? { name: stage.value, sequence: stage.record.sequence } : null,
    executionSubjects: projectSubjects(runRecords),
    tasks: projectTasks(runRecords),
    assurance: projectAssurance(runRecords),
    recentEvents: projectRecentEvents(runRecords),
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
