import type { ActionReceipt } from '../action/types.js';
import type { SpecificationTaskSet } from '../specification/types.js';
import type { RunState } from '../engine/types.js';

export type BuildTaskValidationStatus =
  | 'validated'
  | 'already-completed'
  | 'failed'
  | 'input-drift'
  | 'task-revision-changed';

interface BuildValidationBase {
  status: BuildTaskValidationStatus;
  runId: string;
  workId: string;
  receiptId: string;
  diagnostic: string;
}

export interface BuildTaskValidation extends BuildValidationBase {
  workKind: 'task.implement';
  taskId: string;
  taskRevision: `sha256:${string}`;
}

export interface BuildRepairValidation extends BuildValidationBase {
  workKind: 'implementation.repair';
  taskId: null;
  taskRevision: null;
}

export type BuildWorkValidation = BuildTaskValidation | BuildRepairValidation;

export function validateBuildRepairOutcome(input: {
  state: RunState;
  receipt: ActionReceipt;
}): BuildRepairValidation {
  const work = input.state.changeLifecycle?.currentWork;
  if (
    input.state.status !== 'running' ||
    input.state.changeLifecycle?.phase !== 'build' ||
    work?.kind !== 'implementation.repair' ||
    work.taskId !== undefined ||
    work.taskRevision !== undefined
  ) {
    throw new Error(`Run has no active Build Repair Work: ${input.state.runId}`);
  }
  const base = {
    workKind: 'implementation.repair' as const,
    runId: input.state.runId,
    workId: work.workId,
    taskId: null,
    taskRevision: null,
    receiptId: input.receipt.receiptId,
  };
  if (
    input.receipt.runId !== input.state.runId ||
    input.receipt.workId !== work.workId ||
    input.receipt.inputDigest !== work.inputDigest
  ) {
    return {
      ...base,
      status: 'input-drift',
      diagnostic: 'Action Receipt does not match the active Build Repair Work input',
    };
  }
  return input.receipt.outcome === 'succeeded'
    ? {
        ...base,
        status: 'validated',
        diagnostic: 'Build Repair validator accepted the Outcome',
      }
    : {
        ...base,
        status: 'failed',
        diagnostic: `Build Repair attempt failed: ${input.receipt.summary}`,
      };
}

export function validateBuildTaskOutcome(input: {
  state: RunState;
  receipt: ActionReceipt;
  tasks: SpecificationTaskSet;
}): BuildTaskValidation {
  const work = input.state.changeLifecycle?.currentWork;
  if (
    input.state.status !== 'running' ||
    input.state.changeLifecycle?.phase !== 'build' ||
    !work?.taskId ||
    !work.taskRevision
  ) {
    throw new Error(`Run has no active Build Task Work: ${input.state.runId}`);
  }
  const base = {
    workKind: 'task.implement' as const,
    runId: input.state.runId,
    workId: work.workId,
    taskId: work.taskId,
    taskRevision: work.taskRevision,
    receiptId: input.receipt.receiptId,
  };
  if (
    input.receipt.runId !== input.state.runId ||
    input.receipt.workId !== work.workId ||
    input.receipt.inputDigest !== work.inputDigest
  ) {
    return {
      ...base,
      status: 'input-drift',
      diagnostic: 'Action Receipt does not match the active Build Work input',
    };
  }
  const task = input.tasks.tasks.find((candidate) => candidate.taskId === work.taskId);
  if (!task || task.taskRevision !== work.taskRevision) {
    return {
      ...base,
      status: 'task-revision-changed',
      diagnostic: `Specification Task revision changed: ${work.taskId}`,
    };
  }
  if (input.receipt.outcome !== 'succeeded') {
    return {
      ...base,
      status: 'failed',
      diagnostic: `Build Work attempt failed: ${input.receipt.summary}`,
    };
  }
  return task.status === 'completed'
    ? {
        ...base,
        status: 'already-completed',
        diagnostic: 'Specification Task completion is already projected',
      }
    : { ...base, status: 'validated', diagnostic: 'Build Task validator accepted the Outcome' };
}
