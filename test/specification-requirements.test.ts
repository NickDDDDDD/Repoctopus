import { describe, expect, it } from 'vitest';

import {
  analyzeSpecificationClosure,
  parseRequirementIdentities,
  resolveTaskRequirementIdentities,
} from '../domains/specification/requirements.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

describe('Specification Requirement authority and closure preflight', () => {
  it('resolves stable current and delta Requirement identities before Build', () => {
    const requirements = [
      ...parseRequirementIdentities('runtime', '## ADDED Requirements\n### Requirement: Safe execution'),
      ...parseRequirementIdentities('evidence', '## Requirements\n### Requirement: Trace', 'CURRENT'),
    ];
    const tasks = parseSpecificationTasks(
      'mapping',
      '- [ ] 1.1 Build.\n  **Requirements:** Safe execution; evidence#Trace\n',
    );
    expect(resolveTaskRequirementIdentities(tasks, requirements).tasks[0]?.requirementRefs).toEqual([
      'evidence#trace',
      'runtime#safe-execution',
    ]);
    expect(() =>
      resolveTaskRequirementIdentities(
        parseSpecificationTasks('bad', '- [ ] 1.1 Build.\n  **Requirements:** Missing\n'),
        requirements,
      ),
    ).toThrow(/unknown/u);
  });

  it('computes the same static closure result for preflight and close candidates', () => {
    const requirements = parseRequirementIdentities(
      'fresh',
      '## ADDED Requirements\n### Requirement: Fresh behavior',
    );
    const input = [{ capabilityId: 'fresh', existed: false, purpose: 'Own fresh behavior.', requirements }];
    const preflight = analyzeSpecificationClosure(input);
    const closeCandidate = analyzeSpecificationClosure(structuredClone(input));
    expect(preflight).toEqual(closeCandidate);
    expect(preflight).toMatchObject({ valid: true, newCapabilityPurposes: { fresh: 'Own fresh behavior.' } });
    expect(analyzeSpecificationClosure([{ ...input[0]!, purpose: null }])).toMatchObject({
      valid: false,
      diagnostics: ['New capability fresh requires Purpose'],
    });
  });
});
