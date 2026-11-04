import { describe, expect, it } from 'vitest';

import { runtimeInvalidationScope } from '../domains/runtime/invalidation.js';

describe('Runtime invalidation dependency closure', () => {
  it('invalidates planning dependents while retaining independent identities', () => {
    expect(runtimeInvalidationScope(['planning-semantic'])).toEqual({
      invalidatedIdentities: [
        'approval-authority',
        'build-plan',
        'execution-checkpoint',
        'package-completion',
        'planning-semantic',
        'validation-observation',
        'verification-input',
        'work-input',
      ],
      retainedIdentities: [
        'build-strategy',
        'composition',
        'evidence-dependency',
        'execution-binding',
        'publication-provenance',
      ],
    });
  });

  it('keeps publication reconciliation independent from planning and execution', () => {
    expect(runtimeInvalidationScope(['publication-provenance'])).toEqual({
      invalidatedIdentities: ['publication-provenance'],
      retainedIdentities: [
        'approval-authority',
        'build-plan',
        'build-strategy',
        'composition',
        'evidence-dependency',
        'execution-binding',
        'execution-checkpoint',
        'package-completion',
        'planning-semantic',
        'validation-observation',
        'verification-input',
        'work-input',
      ],
    });
  });

  it('invalidates a changed Work input and only its downstream consumers', () => {
    expect(runtimeInvalidationScope(['work-input'])).toEqual({
      invalidatedIdentities: [
        'execution-checkpoint',
        'package-completion',
        'verification-input',
        'work-input',
      ],
      retainedIdentities: [
        'approval-authority',
        'build-plan',
        'build-strategy',
        'composition',
        'evidence-dependency',
        'execution-binding',
        'planning-semantic',
        'publication-provenance',
        'validation-observation',
      ],
    });
  });

  it('invalidates verification without reopening Work when only its declared dependency changes', () => {
    expect(runtimeInvalidationScope(['evidence-dependency'])).toEqual({
      invalidatedIdentities: ['evidence-dependency', 'verification-input'],
      retainedIdentities: [
        'approval-authority',
        'build-plan',
        'build-strategy',
        'composition',
        'execution-binding',
        'execution-checkpoint',
        'package-completion',
        'planning-semantic',
        'publication-provenance',
        'validation-observation',
        'work-input',
      ],
    });
  });

  it('produces a stable closure regardless of changed identity enumeration order', () => {
    expect(runtimeInvalidationScope(['evidence-dependency', 'work-input'])).toEqual(
      runtimeInvalidationScope(['work-input', 'evidence-dependency']),
    );
  });

  it('invalidates the approved Plan and execution when approval authority changes', () => {
    expect(runtimeInvalidationScope(['approval-authority']).invalidatedIdentities).toEqual([
      'approval-authority',
      'build-plan',
      'execution-checkpoint',
      'package-completion',
      'verification-input',
      'work-input',
    ]);
  });
});
