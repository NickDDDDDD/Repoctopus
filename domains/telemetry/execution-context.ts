import type { ChangePhase, WorkDescriptor } from '../change-lifecycle/transition.js';

export interface ExecutionContext {
  schemaVersion: 1;
  phase: ChangePhase;
  work: Readonly<{
    id: string;
    kind: string;
  }>;
  attempt: number;
  checkEpoch: number;
  task?: Readonly<{
    id: string;
    revision?: `sha256:${string}`;
  }>;
}

export interface ExecutionContextClaim {
  workId: string;
  attempt: number;
  checkEpoch: number;
}

export function createExecutionContext(input: {
  work: WorkDescriptor;
  claim: ExecutionContextClaim;
}): Readonly<ExecutionContext> {
  if (input.claim.workId !== input.work.workId) {
    throw new Error('Execution Context claim does not identify the authoritative Work');
  }
  if (input.claim.checkEpoch !== input.work.checkEpoch) {
    throw new Error('Execution Context claim does not match the authoritative Work checkEpoch');
  }
  if (!Number.isSafeInteger(input.claim.attempt) || input.claim.attempt < 1) {
    throw new Error('Execution Context attempt must be a positive safe integer');
  }
  if (input.work.taskRevision && !input.work.taskId) {
    throw new Error('Execution Context Task revision requires a Task id');
  }

  const task = input.work.taskId
    ? Object.freeze({
        id: input.work.taskId,
        ...(input.work.taskRevision ? { revision: input.work.taskRevision } : {}),
      })
    : undefined;
  return Object.freeze({
    schemaVersion: 1 as const,
    phase: input.work.phase,
    work: Object.freeze({ id: input.work.workId, kind: input.work.kind }),
    attempt: input.claim.attempt,
    checkEpoch: input.claim.checkEpoch,
    ...(task ? { task } : {}),
  });
}
