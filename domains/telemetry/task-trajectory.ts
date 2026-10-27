import type { ChangePhase, WorkDescriptor } from '../change-lifecycle/transition.js';
import type { TrajectoryEvent } from '../trajectory/types.js';
import type { ExecutionContext } from './execution-context.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export interface TaskTrajectoryIdentity {
  id: string;
  revision: `sha256:${string}`;
}

export interface TaskReworkCorrelation {
  kind: 'fallback';
  sourcePhase: 'verify' | 'archive';
  evidence: {
    attemptId?: string;
    bundleId?: string;
    inputFingerprint?: string;
    ids?: readonly string[];
  };
  continuation: {
    work: { id: string; kind: WorkDescriptor['kind'] };
    task?: TaskTrajectoryIdentity;
    checkEpoch: number;
  };
}

interface TaskTrajectoryBase extends Record<string, unknown> {
  schemaVersion: 1;
  task: TaskTrajectoryIdentity;
  executionContext?: ExecutionContext;
}

export type TaskTrajectoryData =
  | (TaskTrajectoryBase & { result: 'started' })
  | (TaskTrajectoryBase & {
      result: 'completed';
      completion: { receiptId: string };
    })
  | (TaskTrajectoryBase & {
      result: 'failed';
      failure: { reason: string };
    })
  | (TaskTrajectoryBase & {
      result: 'reopened';
      recovery: TaskReworkCorrelation;
    });

export type TaskTrajectoryStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'reopened';

export interface TaskTrajectoryProjection {
  schemaVersion: 1;
  tasks: Array<
    TaskTrajectoryIdentity & {
      status: TaskTrajectoryStatus;
      lastEventId: string | null;
      workId: string | null;
    }
  >;
  progress: { total: number; completed: number; active: number; pending: number };
  reworkChains: Array<{
    task: TaskTrajectoryIdentity;
    sourcePhase: 'verify' | 'archive';
    attemptId: string | null;
    bundleId: string | null;
    inputFingerprint: string | null;
    evidenceIds: readonly string[];
    nextWorkId: string;
    nextWorkKind: WorkDescriptor['kind'];
    nextTask: TaskTrajectoryIdentity | null;
    nextCheckEpoch: number;
    eventId: string;
  }>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}

function identity(value: unknown): TaskTrajectoryIdentity {
  if (!value || typeof value !== 'object') throw new Error('Task event identity is missing');
  const candidate = value as Record<string, unknown>;
  const id = nonEmpty(candidate.id, 'Task id');
  if (typeof candidate.revision !== 'string' || !DIGEST.test(candidate.revision)) {
    throw new Error('Task revision must be a sha256 digest');
  }
  return { id, revision: candidate.revision as `sha256:${string}` };
}

function taskKey(task: TaskTrajectoryIdentity): string {
  return `${task.id}\0${task.revision}`;
}

function parseTaskData(event: TrajectoryEvent): TaskTrajectoryData {
  const expected = event.type.startsWith('task.') ? event.type.slice(5) : null;
  if (!expected || !['started', 'completed', 'failed', 'reopened'].includes(expected)) {
    throw new Error(`Event ${event.eventId} is not a Task lifecycle event`);
  }
  if (event.data.schemaVersion !== 1 || event.data.result !== expected) {
    throw new Error(`Task event ${event.eventId} has an invalid schema or result`);
  }
  identity(event.data.task);
  return event.data as TaskTrajectoryData;
}

export function projectTaskTrajectory(options: {
  tasks: readonly TaskTrajectoryIdentity[];
  events: readonly TrajectoryEvent[];
}): TaskTrajectoryProjection {
  const projected = new Map<string, TaskTrajectoryProjection['tasks'][number]>();
  for (const task of options.tasks) {
    const parsed = identity(task);
    const key = taskKey(parsed);
    if (projected.has(key)) throw new Error(`Duplicate Task identity ${parsed.id}`);
    projected.set(key, { ...parsed, status: 'pending', lastEventId: null, workId: null });
  }

  const reworkChains: TaskTrajectoryProjection['reworkChains'] = [];
  let previousSequence = 0;
  for (const event of options.events) {
    if (!event.type.startsWith('task.')) continue;
    if (event.sequence <= previousSequence) {
      throw new Error('Task trajectory events must be in strictly increasing sequence order');
    }
    previousSequence = event.sequence;
    const data = parseTaskData(event);
    const task = identity(data.task);
    const current = projected.get(taskKey(task));
    if (!current) throw new Error(`Task event ${event.eventId} references an unapproved revision`);
    const workId = data.executionContext?.work.id ?? current.workId;
    if (data.result === 'started') current.status = 'in-progress';
    else if (data.result === 'completed') {
      nonEmpty(data.completion.receiptId, 'Task completion receipt id');
      current.status = 'completed';
    } else if (data.result === 'failed') {
      nonEmpty(data.failure.reason, 'Task failure reason');
      current.status = 'failed';
    } else {
      const recovery = data.recovery;
      const nextWorkId = nonEmpty(recovery.continuation.work.id, 'Repair Work id');
      if (
        !Number.isSafeInteger(recovery.continuation.checkEpoch) ||
        recovery.continuation.checkEpoch < 0
      ) {
        throw new Error('Repair Work checkEpoch must be a non-negative integer');
      }
      current.status = 'reopened';
      reworkChains.push({
        task,
        sourcePhase: recovery.sourcePhase,
        attemptId: recovery.evidence.attemptId ?? null,
        bundleId: recovery.evidence.bundleId ?? null,
        inputFingerprint: recovery.evidence.inputFingerprint ?? null,
        evidenceIds: [...(recovery.evidence.ids ?? [])],
        nextWorkId,
        nextWorkKind: recovery.continuation.work.kind,
        nextTask: recovery.continuation.task ?? null,
        nextCheckEpoch: recovery.continuation.checkEpoch,
        eventId: event.eventId,
      });
    }
    current.lastEventId = event.eventId;
    current.workId = workId;
  }

  const tasks = [...projected.values()];
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const active = tasks.filter((task) => task.status === 'in-progress').length;
  return {
    schemaVersion: 1,
    tasks,
    progress: {
      total: tasks.length,
      completed,
      active,
      pending: tasks.length - completed - active,
    },
    reworkChains,
  };
}

export function taskTrajectoryPhase(data: TaskTrajectoryData): ChangePhase {
  return data.result === 'reopened'
    ? data.recovery.sourcePhase
    : (data.executionContext?.phase ?? 'build');
}
