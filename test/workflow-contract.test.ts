import { describe, expect, it } from 'vitest';

import { hashWorkflowDefinition } from '../domains/workflow-contract/hash.js';
import { createWorkflowPackage } from '../domains/workflow-contract/package.js';
import { validateWorkflowDefinition } from '../domains/workflow-contract/validation.js';
import { workflowFixture } from './helpers/fixtures.js';

describe('workflow contract', () => {
  it('produces the same digest for semantically equal key orderings', () => {
    const definition = workflowFixture().definition;
    const reordered = JSON.parse(JSON.stringify(definition)) as typeof definition;
    reordered.metadata = {
      description: definition.metadata.description,
      version: definition.metadata.version,
      name: definition.metadata.name,
    };
    expect(hashWorkflowDefinition(reordered)).toBe(hashWorkflowDefinition(definition));
  });

  it('rejects duplicate, unreachable and unknown graph edges', () => {
    const definition = structuredClone(workflowFixture().definition);
    definition.steps.push(structuredClone(definition.steps[0]!));
    definition.steps.push({
      id: 'orphan',
      action: { type: 'checkpoint', summary: 'orphan' },
      onSuccess: 'missing',
    });
    const result = validateWorkflowDefinition(definition);
    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['duplicate-step', 'unreachable-step', 'unknown-edge']),
    );
    expect(() => createWorkflowPackage(definition)).toThrow('Duplicate step');
  });

  it('rejects unknown actions, missing versions and loops without an exit', () => {
    const definition = structuredClone(workflowFixture().definition);
    definition.metadata.version = '';
    definition.steps[0]!.action.type = 'unknown-action' as 'checkpoint';
    definition.steps[1]!.onSuccess = 'inspect';
    const result = validateWorkflowDefinition(definition);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['invalid-metadata', 'unknown-action', 'missing-exit']),
    );
  });
});
