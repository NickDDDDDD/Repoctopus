import type { WorkflowGuardrails } from '../workflow-contract/types.js';
import type { EngineAction, RunState } from './types.js';

export type GuardrailResult = { allowed: true } | { allowed: false; reason: string };

export function checkAction(
  action: EngineAction,
  state: RunState,
  guardrails: WorkflowGuardrails,
  confirmations: ReadonlySet<string>,
): GuardrailResult {
  if (state.iteration >= guardrails.maxIterations) {
    return { allowed: false, reason: `Iteration budget exhausted: ${guardrails.maxIterations}` };
  }
  if (!guardrails.allowedActionTypes.includes(action.type)) {
    return { allowed: false, reason: `Action type is not allowed: ${action.type}` };
  }
  if (
    action.ref &&
    guardrails.allowedRefs.length > 0 &&
    !guardrails.allowedRefs.includes(action.ref)
  ) {
    return { allowed: false, reason: `Action reference is not allowed: ${action.ref}` };
  }
  if (
    action.ref &&
    guardrails.confirmationRequiredFor.includes(action.ref) &&
    !confirmations.has(action.ref)
  ) {
    return { allowed: false, reason: `User confirmation required for: ${action.ref}` };
  }
  const retries = state.retries[action.id] ?? 0;
  if (retries >= guardrails.maxRetriesPerAction + 1) {
    return { allowed: false, reason: `Retry budget exhausted for action: ${action.id}` };
  }
  return { allowed: true };
}
