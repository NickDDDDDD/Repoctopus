import { createHash, randomBytes } from 'node:crypto';

import type { WorkflowPackage, WorkflowStep } from '../workflow-contract/types.js';
import type { CompositionIdentitySnapshot } from '../composition/types.js';
import { checkAction } from './guardrails.js';
import {
  resolveDeterministicNext,
  resolveDeterministicStep,
  staticDeterministicResolver,
  type DeterministicResolver,
} from './resolver.js';
import type { ActionOutcome, EngineAction, EngineDecision, RunState } from './types.js';

function actionId(runId: string, iteration: number, stepId: string): string {
  return createHash('sha256').update(`${runId}:${iteration}:${stepId}`).digest('hex').slice(0, 24);
}

function stepFor(workflow: WorkflowPackage, id: string | null): WorkflowStep | undefined {
  return workflow.definition.steps.find((step) => step.id === id);
}

export function startRun(options: {
  workflow: WorkflowPackage;
  runId: string;
  projectSnapshotDigest: string;
  composition: CompositionIdentitySnapshot;
  timestamp: string;
  workflowSource?: string;
  traceId?: string;
}): RunState {
  return {
    schemaVersion: 1,
    runId: options.runId,
    workflowName: options.workflow.definition.metadata.name,
    workflowVersion: options.workflow.definition.metadata.version,
    workflowDigest: options.workflow.digest,
    workflowSource: options.workflowSource ?? null,
    composition: structuredClone(options.composition),
    projectSnapshotDigest: options.projectSnapshotDigest,
    traceId: options.traceId ?? randomBytes(16).toString('hex'),
    currentStep: options.workflow.definition.entry,
    iteration: 0,
    pendingActionId: null,
    reconciliationRequired: false,
    stateVersion: 0,
    status: 'running',
    retries: {},
    acceptedEvidenceBundleIds: [],
    skillUsageSnapshots: [],
    createdAt: options.timestamp,
    updatedAt: options.timestamp,
  };
}

export function decide(
  workflow: WorkflowPackage,
  state: RunState,
  timestamp: string,
  confirmations: ReadonlySet<string> = new Set(),
): EngineDecision {
  return decideWithResolver(
    workflow,
    state,
    confirmations,
    timestamp,
    staticDeterministicResolver,
    undefined,
  );
}

export function decideWithResolver<TContext>(
  workflow: WorkflowPackage,
  state: RunState,
  confirmations: ReadonlySet<string>,
  timestamp: string,
  resolver: DeterministicResolver<TContext>,
  context: TContext,
): EngineDecision {
  if (state.status !== 'running') return { state, action: null, reason: `Run is ${state.status}` };
  if (state.reconciliationRequired) {
    return {
      state,
      action: null,
      reason: 'Project reconciliation is required before another action can be proposed',
    };
  }
  if (state.pendingActionId) {
    return { state, action: null, reason: `Action already pending: ${state.pendingActionId}` };
  }
  const step = resolveDeterministicStep(resolver, workflow, state, context);
  if (!step && state.currentStep === null) {
    return { state: { ...state, status: 'completed' }, action: null };
  }
  if (!step) {
    return {
      state: { ...state, status: 'failed' },
      action: null,
      reason: `Unknown current step: ${state.currentStep}`,
    };
  }
  const action: EngineAction = {
    ...step.action,
    id: actionId(state.runId, state.iteration, step.id),
    stepId: step.id,
  };
  const guardrail = checkAction(action, state, workflow.definition.guardrails, confirmations);
  if (!guardrail.allowed) return { state, action: null, reason: guardrail.reason };
  return {
    state: {
      ...state,
      pendingActionId: action.id,
      stateVersion: state.stateVersion + 1,
      status: 'waiting',
      updatedAt: timestamp,
    },
    action,
  };
}

export function recordOutcome(
  workflow: WorkflowPackage,
  state: RunState,
  outcome: ActionOutcome,
  timestamp: string,
): RunState {
  return recordOutcomeWithResolver(
    workflow,
    state,
    outcome,
    timestamp,
    staticDeterministicResolver,
    undefined,
  );
}

export function recordOutcomeWithResolver<TContext>(
  workflow: WorkflowPackage,
  state: RunState,
  outcome: ActionOutcome,
  timestamp: string,
  resolver: DeterministicResolver<TContext>,
  context: TContext,
): RunState {
  if (!state.pendingActionId || state.pendingActionId !== outcome.actionId) {
    throw new Error(`Outcome does not match pending action: ${outcome.actionId}`);
  }
  const step = resolveDeterministicStep(resolver, workflow, state, context);
  if (!step) throw new Error(`Unknown current step: ${state.currentStep ?? '(missing)'}`);

  if (outcome.status === 'failed') {
    return {
      ...state,
      pendingActionId: null,
      status: 'running',
      stateVersion: state.stateVersion + 1,
      retries: {
        ...state.retries,
        [outcome.actionId]: (state.retries[outcome.actionId] ?? 0) + 1,
      },
      updatedAt: timestamp,
    };
  }

  const next = resolveDeterministicNext(resolver, workflow, state, step, outcome, context);
  if (next !== null && !stepFor(workflow, next)) {
    throw new Error(`Resolver returned unknown next step: ${next}`);
  }
  return {
    ...state,
    currentStep: next,
    iteration: state.iteration + 1,
    pendingActionId: null,
    stateVersion: state.stateVersion + 1,
    status: next === null ? 'completed' : 'running',
    updatedAt: timestamp,
  };
}
