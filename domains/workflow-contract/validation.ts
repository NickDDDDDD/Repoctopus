import type {
  ActionType,
  WorkflowDefinition,
  WorkflowValidationFinding,
  WorkflowValidationResult,
} from './types.js';

const ACTION_TYPES = new Set<ActionType>(['invoke_skill', 'call_tool', 'ask_user', 'checkpoint']);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowValidationResult {
  const findings: WorkflowValidationFinding[] = [];
  const byId = new Map<string, WorkflowDefinition['steps'][number]>();

  if (definition.apiVersion !== 'repoctopus/v1alpha1') {
    findings.push({ code: 'unsupported-api-version', message: 'Unsupported workflow apiVersion' });
  }
  if (definition.kind !== 'Workflow') {
    findings.push({ code: 'unsupported-kind', message: 'Workflow kind must be Workflow' });
  }
  if (!nonEmpty(definition.metadata?.name) || !nonEmpty(definition.metadata?.version)) {
    findings.push({ code: 'invalid-metadata', message: 'Workflow name and version are required' });
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    findings.push({ code: 'missing-steps', message: 'Workflow must define at least one step' });
    return { valid: false, findings };
  }

  for (const step of definition.steps) {
    if (!nonEmpty(step.id)) {
      findings.push({ code: 'invalid-step-id', message: 'Step id must be non-empty' });
      continue;
    }
    if (byId.has(step.id)) {
      findings.push({
        code: 'duplicate-step',
        stepId: step.id,
        message: `Duplicate step: ${step.id}`,
      });
    } else {
      byId.set(step.id, step);
    }
    if (!ACTION_TYPES.has(step.action?.type)) {
      findings.push({
        code: 'unknown-action',
        stepId: step.id,
        message: `Unknown action type for ${step.id}`,
      });
    }
    if (!nonEmpty(step.action?.summary)) {
      findings.push({
        code: 'missing-action-summary',
        stepId: step.id,
        message: `Action summary is required for ${step.id}`,
      });
    }
    if (step.action?.evidenceProfile !== undefined && !nonEmpty(step.action.evidenceProfile)) {
      findings.push({
        code: 'invalid-evidence-profile',
        stepId: step.id,
        message: `Evidence profile must be non-empty for ${step.id}`,
      });
    }
  }

  if (!byId.has(definition.entry)) {
    findings.push({ code: 'unknown-entry', message: `Unknown entry step: ${definition.entry}` });
  }

  for (const step of byId.values()) {
    for (const target of [step.onSuccess, step.onFailure]) {
      if (target !== null && target !== undefined && !byId.has(target)) {
        findings.push({
          code: 'unknown-edge',
          stepId: step.id,
          message: `${step.id} points to unknown step: ${target}`,
        });
      }
    }
  }

  const reachable = new Set<string>();
  const queue = byId.has(definition.entry) ? [definition.entry] : [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    const step = byId.get(id);
    if (!step) continue;
    for (const target of [step.onSuccess, step.onFailure]) {
      if (target && !reachable.has(target)) queue.push(target);
    }
  }
  for (const id of byId.keys()) {
    if (!reachable.has(id)) {
      findings.push({ code: 'unreachable-step', stepId: id, message: `Unreachable step: ${id}` });
    }
  }

  const exits = [...reachable].filter((id) => byId.get(id)?.onSuccess === null);
  if (exits.length === 0) {
    findings.push({ code: 'missing-exit', message: 'Workflow has no reachable success exit' });
  }

  const guardrails = definition.guardrails;
  if (
    !guardrails ||
    !Number.isSafeInteger(guardrails.maxIterations) ||
    guardrails.maxIterations < 1 ||
    !Number.isSafeInteger(guardrails.maxRetriesPerAction) ||
    guardrails.maxRetriesPerAction < 0
  ) {
    findings.push({ code: 'invalid-guardrails', message: 'Guardrail budgets are invalid' });
  }

  return { valid: findings.length === 0, findings };
}
