import { describe, expect, it } from 'vitest';
import { parseBuildStrategyCandidate } from '../domains/change-lifecycle/strategy-selection.js';
import { strategyCandidateFixture } from './helpers/strategy-candidate.js';

describe('Design strategy candidate contract', () => {
  it.each([
    ['autonomous', 'tdd'],
    ['autonomous', 'direct'],
    ['subagent-driven-development', 'tdd'],
    ['subagent-driven-development', 'direct'],
  ] as const)('accepts execution %s independently from TDD %s', (execution, method) => {
    const result = parseBuildStrategyCandidate(strategyCandidateFixture(execution, method));
    expect(result.executionMode).toBe(execution);
    expect(result.tddMode).toBe(method);
    expect(result.rationale.execution.refs).toContain('tasks.md');
  });

  it.each([
    { executionMode: undefined },
    { tddMode: undefined },
    { executionMode: 'direct' },
    { tddMode: 'off' },
    { reviewMode: 'off' },
    { isolationIntent: 'current' },
    { rationale: { execution: { summary: 'Unsupported', refs: ['C:/private/file.md'] } } },
    { rationale: { execution: { summary: 'No source', refs: [] } } },
  ])('rejects missing, unsupported or unreviewable configuration %j', (patch) => {
    expect(() =>
      parseBuildStrategyCandidate({ ...strategyCandidateFixture(), ...patch }),
    ).toThrow();
  });
});
