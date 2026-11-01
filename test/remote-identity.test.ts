import { describe, expect, it } from 'vitest';

import { normalizePublicationRepositoryIdentity } from '../platform/git/remote-identity.js';

describe('publication repository identity', () => {
  it('prefers a stable platform repository id', () => {
    expect(
      normalizePublicationRepositoryIdentity({
        stableRepositoryId: 'github:12345',
        remote: 'git@github.com:Team/Repo.git',
      }),
    ).toEqual({ value: 'github:12345', certainty: 'exact', source: 'stable-id' });
  });

  it('normalizes GitHub URI forms and explicit case-insensitive paths', () => {
    expect(
      normalizePublicationRepositoryIdentity({ remote: 'git@github.com:Team/Repo.git' }),
    ).toEqual({ value: 'github.com/team/repo', certainty: 'platform-rule', source: 'remote' });
    expect(
      normalizePublicationRepositoryIdentity({ remote: 'HTTPS://GitHub.com/team/repo/' }),
    ).toEqual({ value: 'github.com/team/repo', certainty: 'platform-rule', source: 'remote' });
  });

  it('preserves unknown-platform path case and reports conservative uncertainty', () => {
    expect(
      normalizePublicationRepositoryIdentity({ remote: 'ssh://git@example.test/Team/Repo.git' }),
    ).toEqual({
      value: 'example.test/Team/Repo',
      certainty: 'conservative',
      source: 'remote',
    });
  });
});
