import { describe, expect, it } from 'vitest';

import { createRuntimeIdentity, type RuntimeIdentityBasis } from '../domains/runtime/identity.js';
import { planRuntimeInvalidation } from '../domains/runtime/invalidation.js';

function basis(suffix = 'a'): RuntimeIdentityBasis {
  const planningSemantic = createRuntimeIdentity('planning-semantic', { suffix });
  const approvalAuthority = createRuntimeIdentity('approval-authority', {
    planningSemantic: planningSemantic.digest,
  });
  const composition = createRuntimeIdentity('composition', { code: suffix });
  const buildConfiguration = createRuntimeIdentity('build-configuration', {
    composition: composition.digest,
  });
  const buildPlan = createRuntimeIdentity('build-plan', {
    planningSemantic: planningSemantic.digest,
    buildConfiguration: buildConfiguration.digest,
  });
  return {
    schemaVersion: 1,
    planningSemantic,
    approvalAuthority,
    composition,
    buildConfiguration,
    buildPlan,
    executionCheckpoint: createRuntimeIdentity('execution-checkpoint', {
      buildPlan: buildPlan.digest,
      composition: composition.digest,
    }),
    verificationInput: createRuntimeIdentity('verification-input', {
      planningSemantic: planningSemantic.digest,
      buildPlan: buildPlan.digest,
    }),
    publicationProvenance: createRuntimeIdentity('publication-provenance', { oid: suffix }),
  };
}

describe('dependency-aware Runtime invalidation planner', () => {
  it.each([
    ['planningSemantic', 'semantic', 'invalidate', 'design'],
    ['approvalAuthority', 'approval-authority', 'invalidate', 'design'],
    ['composition', 'composition', 'migration_required', 'migration_required'],
    ['buildConfiguration', 'build-input', 'invalidate', 'configure'],
    ['buildPlan', 'build-input', 'invalidate', 'plan'],
    ['verificationInput', 'verification-input', 'invalidate', 'verify'],
    ['publicationProvenance', 'publication', 'reconcile', 'reconcile'],
  ] as const)(
    'classifies %s drift and returns the fixed successor',
    (field, classification, disposition, successor) => {
      const previous = basis();
      const current = structuredClone(previous);
      const priorIdentity = current[field];
      if (!priorIdentity) throw new Error(`missing fixture identity: ${field}`);
      current[field] = createRuntimeIdentity(priorIdentity.kind, { changed: field });
      const result = planRuntimeInvalidation({ previous, current });
      expect(result).toMatchObject({ classification, disposition, successor, scope: 'exact' });
      expect(result.invalidatedIdentities).toContain(priorIdentity.kind);
    },
  );

  it('is deterministic, retains unrelated identities, and fails closed for unknown observations', () => {
    const previous = basis();
    const current = structuredClone(previous);
    current.publicationProvenance = createRuntimeIdentity('publication-provenance', {
      oid: 'new',
    });
    const first = planRuntimeInvalidation({ previous, current });
    const second = planRuntimeInvalidation({ previous, current });
    expect(second).toEqual(first);
    expect(first.retainedIdentities).toContain('execution-checkpoint');

    expect(
      planRuntimeInvalidation({ previous, current: null, observationStatus: 'unknown' }),
    ).toMatchObject({
      classification: 'unknown',
      disposition: 'invalidate',
      scope: 'conservative',
      successor: 'human-decision',
    });
  });
});
