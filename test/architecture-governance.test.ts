import { describe, expect, it } from 'vitest';

import { evaluateLegacyWorkflowProductBoundary } from '../scripts/legacy-workflow-boundary.mjs';

const rules = [
  { path: '.codex', match: 'tree', ownership: 'external-exclusive' },
  { path: 'scripts/workflow-hook.mjs', match: 'file', ownership: 'external-exclusive' },
] as const;

describe('legacy workflow product boundary', () => {
  it('does not reject an untracked Host installation merely because it exists', () => {
    expect(
      evaluateLegacyWorkflowProductBoundary({
        rules,
        headPaths: ['README.md'],
        indexPaths: ['README.md'],
      }),
    ).toEqual([]);
  });

  it('rejects external-exclusive paths in either HEAD or index', () => {
    expect(
      evaluateLegacyWorkflowProductBoundary({
        rules,
        headPaths: ['.codex/rules/workflow.md'],
        indexPaths: ['scripts/workflow-hook.mjs'],
      }),
    ).toEqual([
      '.codex/rules/workflow.md: external Host path must not enter the Repoctopus product tree (.codex)',
      'scripts/workflow-hook.mjs: external Host path must not enter the Repoctopus product tree (scripts/workflow-hook.mjs)',
    ]);
  });

  it('rejects malformed rules instead of silently widening the boundary', () => {
    expect(
      evaluateLegacyWorkflowProductBoundary({
        rules: [
          { path: '.codex', match: 'glob', ownership: 'external-exclusive' },
        ] as unknown as typeof rules,
        headPaths: [],
        indexPaths: [],
      }),
    ).toEqual(['Invalid legacy workflow path ownership rule']);
  });
});
