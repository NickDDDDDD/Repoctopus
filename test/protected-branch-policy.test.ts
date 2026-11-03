import { describe, expect, it } from 'vitest';

import {
  isProtectedBranch,
  normalizeProtectedBranchPatterns,
} from '../domains/delivery/branch-policy.js';

describe('protected branch policy', () => {
  it.each([
    ['main', true],
    ['release/2026.11', true],
    ['release-candidate', false],
    ['support/v1', true],
    ['support/v12', false],
    ['codex/change-a', false],
  ])('matches %s with the shared exact, star and question semantics', (branch, protectedBranch) => {
    expect(isProtectedBranch(branch, ['main', 'release/*', 'support/v?'])).toBe(protectedBranch);
  });

  it('normalizes the configured policy and always protects the resolved target', () => {
    expect(normalizeProtectedBranchPatterns([' release/* ', 'main', 'main'], 'stable')).toEqual([
      'main',
      'release/*',
      'stable',
    ]);
  });

  it('rejects empty or unbounded policy values', () => {
    expect(() => normalizeProtectedBranchPatterns([' '], 'main')).toThrow(/empty/iu);
    expect(() =>
      normalizeProtectedBranchPatterns(Array.from({ length: 257 }, (_, i) => `p-${i}`)),
    ).toThrow(/256/iu);
  });
});
