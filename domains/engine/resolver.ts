import type { WorkflowPackage, WorkflowStep } from '../workflow-contract/types.js';
import type { ActionOutcome, RunState } from './types.js';

export interface DeterministicResolver<TContext> {
  resolveStep(input: {
    workflow: Readonly<WorkflowPackage>;
    state: Readonly<RunState>;
    context: Readonly<TContext>;
  }): WorkflowStep | undefined;
  resolveNext(input: {
    workflow: Readonly<WorkflowPackage>;
    state: Readonly<RunState>;
    step: Readonly<WorkflowStep>;
    outcome: Readonly<ActionOutcome>;
    context: Readonly<TContext>;
  }): string | null;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value);
}

function readonlyCopy<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

export function resolveDeterministicStep<TContext>(
  resolver: DeterministicResolver<TContext>,
  workflow: WorkflowPackage,
  state: RunState,
  context: TContext,
): WorkflowStep | undefined {
  return resolver.resolveStep({
    workflow: readonlyCopy(workflow),
    state: readonlyCopy(state),
    context: readonlyCopy(context),
  });
}

export function resolveDeterministicNext<TContext>(
  resolver: DeterministicResolver<TContext>,
  workflow: WorkflowPackage,
  state: RunState,
  step: WorkflowStep,
  outcome: ActionOutcome,
  context: TContext,
): string | null {
  return resolver.resolveNext({
    workflow: readonlyCopy(workflow),
    state: readonlyCopy(state),
    step: readonlyCopy(step),
    outcome: readonlyCopy(outcome),
    context: readonlyCopy(context),
  });
}

export const staticDeterministicResolver: DeterministicResolver<undefined> = {
  resolveStep({ workflow, state }) {
    return workflow.definition.steps.find((step) => step.id === state.currentStep);
  },
  resolveNext({ step, outcome }) {
    return outcome.status === 'succeeded' ? step.onSuccess : (step.onFailure ?? step.id);
  },
};
