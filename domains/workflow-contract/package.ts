import { parse } from 'yaml';

import { hashWorkflowDefinition } from './hash.js';
import type { WorkflowDefinition, WorkflowPackage } from './types.js';
import { validateWorkflowDefinition } from './validation.js';

export function createWorkflowPackage(value: unknown): WorkflowPackage {
  const definition = structuredClone(value) as WorkflowDefinition;
  const validation = validateWorkflowDefinition(definition);
  if (!validation.valid) {
    throw new Error(validation.findings.map((finding) => finding.message).join('\n'));
  }
  return {
    definition,
    digest: hashWorkflowDefinition(definition),
  };
}

export function parseWorkflowPackage(source: string): WorkflowPackage {
  return createWorkflowPackage(parse(source));
}
