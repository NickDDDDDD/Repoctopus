import { describe, expect, it } from 'vitest';

import {
  IDENTITY_DEPENDENCIES,
  createRuntimeIdentity,
  validateRuntimeIdentityBasis,
  type RuntimeIdentityBasis,
} from '../domains/runtime/identity.js';

describe('Runtime identity basis', () => {
  it('constructs deterministic owned identities and validates the fixed dependency matrix', () => {
    const first = createRuntimeIdentity('planning-semantic', { artifacts: ['a'], target: 'main' });
    const second = createRuntimeIdentity('planning-semantic', { target: 'main', artifacts: ['a'] });

    expect(second).toEqual(first);
    expect(first).toMatchObject({ owner: 'specification-planning' });
    expect(IDENTITY_DEPENDENCIES['execution-checkpoint']).toEqual(['build-plan', 'composition']);

    const basis: RuntimeIdentityBasis = {
      schemaVersion: 1,
      planningSemantic: first,
      approvalAuthority: createRuntimeIdentity('approval-authority', {
        planningSemantic: first.digest,
      }),
    };
    expect(() => validateRuntimeIdentityBasis(basis)).not.toThrow();
  });

  it('rejects wrong owners, missing dependencies, unknown combinations, and non-sha identities', () => {
    const semantic = createRuntimeIdentity('planning-semantic', { value: 'a' });
    const approval = createRuntimeIdentity('approval-authority', {
      planningSemantic: semantic.digest,
    });

    expect(() =>
      validateRuntimeIdentityBasis({
        schemaVersion: 1,
        planningSemantic: { ...semantic, owner: 'human-decision' },
      }),
    ).toThrow(/owner/u);
    expect(() =>
      validateRuntimeIdentityBasis({ schemaVersion: 1, approvalAuthority: approval }),
    ).toThrow(/planning-semantic/u);
    expect(() =>
      validateRuntimeIdentityBasis({
        schemaVersion: 1,
        planningSemantic: { ...semantic, digest: 'sha256:nope' },
      }),
    ).toThrow(/SHA-256/u);
    const unknownIdentityBasis = {
      schemaVersion: 1 as const,
      planningSemantic: semantic,
      unknownIdentity: semantic,
    };
    expect(() => validateRuntimeIdentityBasis(unknownIdentityBasis)).toThrow(/unknown identity/u);
  });
});
