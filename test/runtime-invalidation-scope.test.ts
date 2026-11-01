import { describe, expect, it } from 'vitest';

import { runtimeInvalidationScope } from '../domains/runtime/invalidation.js';

describe('Runtime invalidation dependency closure', () => {
  it('invalidates planning dependents while retaining independent identities', () => {
    expect(runtimeInvalidationScope(['planning-semantic'])).toEqual({
      invalidatedIdentities: [
        'approval-authority',
        'build-plan',
        'execution-checkpoint',
        'planning-semantic',
        'validation-observation',
        'verification-input',
      ],
      retainedIdentities: [
        'build-configuration',
        'composition',
        'publication-provenance',
      ],
    });
  });

  it('keeps publication reconciliation independent from planning and execution', () => {
    expect(runtimeInvalidationScope(['publication-provenance'])).toEqual({
      invalidatedIdentities: ['publication-provenance'],
      retainedIdentities: [
        'approval-authority',
        'build-configuration',
        'build-plan',
        'composition',
        'execution-checkpoint',
        'planning-semantic',
        'validation-observation',
        'verification-input',
      ],
    });
  });
});
