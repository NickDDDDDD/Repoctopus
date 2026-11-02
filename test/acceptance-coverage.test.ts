import { describe, expect, it } from 'vitest';

import { resolveAcceptanceCoverage } from '../domains/change-lifecycle/acceptance-coverage.js';
import type { EvidenceExecutionPlan } from '../domains/feedback/profile.js';
import { parseSpecificationTasks } from '../domains/specification/tasks.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const tasks = parseSpecificationTasks(
  'coverage',
  [
    '- [ ] 1.1 Build the API.',
    '  **Acceptance:** API works',
    '  **Requirements:** runtime#api',
    '- [ ] 1.2 Build the UI.',
    '  **Acceptance:** UI works',
    '  **Requirements:** dashboard#ui',
  ].join('\n'),
).tasks;

function plan(
  nodes: Array<{ id: string; covers: string[]; required?: boolean }>,
): EvidenceExecutionPlan {
  return {
    schemaVersion: 1,
    profileId: 'verify',
    configDigest: digest('c'),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: 'command' as const,
      repository: 'workspace',
      repositoryPath: '.',
      dependsOn: [],
      required: node.required ?? true,
      covers: node.covers,
      executable: 'npm',
      args: ['test'],
      timeoutMs: 60_000,
      cache: false,
    })),
    order: nodes.map((node) => node.id),
  };
}

describe('Acceptance coverage', () => {
  it('resolves wildcard, Task, Requirement, and exact selectors deterministically', () => {
    const firstAcceptance = tasks[0]!.acceptanceCriteria[0]!.acceptanceId;
    const resolved = resolveAcceptanceCoverage(
      tasks,
      plan([
        { id: 'z-all', covers: ['*'] },
        { id: 'a-task', covers: ['task:1.1'] },
        { id: 'm-requirement', covers: ['requirement:dashboard#ui'] },
        { id: 'b-exact', covers: [firstAcceptance] },
      ]),
    );

    expect(resolved.acceptanceCriteria.map((criterion) => criterion.acceptanceId)).toEqual(
      [...resolved.acceptanceCriteria]
        .map((criterion) => criterion.acceptanceId)
        .sort((left, right) => left.localeCompare(right)),
    );
    expect(resolved.acceptanceCoverage).toEqual(
      resolved.acceptanceCriteria.map((criterion) => ({
        acceptanceId: criterion.acceptanceId,
        nodeIds:
          criterion.taskId === '1.1' ? ['a-task', 'b-exact', 'z-all'] : ['m-requirement', 'z-all'],
      })),
    );
    expect(resolved.acceptanceSetHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(resolveAcceptanceCoverage(tasks, plan([{ id: 'z-all', covers: ['*'] }]))).toEqual(
      resolveAcceptanceCoverage(tasks, plan([{ id: 'z-all', covers: ['*'] }])),
    );
  });

  it('rejects duplicate, invalid, and unknown selectors', () => {
    expect(() =>
      resolveAcceptanceCoverage(tasks, plan([{ id: 'duplicate', covers: ['*', '*'] }])),
    ).toThrow(/duplicate Acceptance selectors/u);
    expect(() =>
      resolveAcceptanceCoverage(tasks, plan([{ id: 'invalid', covers: ['component:api'] }])),
    ).toThrow(/invalid Acceptance selector/u);
    expect(() =>
      resolveAcceptanceCoverage(tasks, plan([{ id: 'unknown', covers: ['task:9.9'] }])),
    ).toThrow(/unknown Acceptance selector/u);
  });

  it('rejects empty, duplicate, uncovered, and optional-only Acceptance sets', () => {
    expect(() => resolveAcceptanceCoverage([], plan([{ id: 'all', covers: ['*'] }]))).toThrow(
      /at least one approved Acceptance criterion/u,
    );
    expect(() =>
      resolveAcceptanceCoverage(
        [
          tasks[0]!,
          {
            ...tasks[1]!,
            acceptanceCriteria: [{ ...tasks[0]!.acceptanceCriteria[0]!, taskId: tasks[1]!.taskId }],
          },
        ],
        plan([{ id: 'all', covers: ['*'] }]),
      ),
    ).toThrow(/duplicate Acceptance identities/u);
    expect(() =>
      resolveAcceptanceCoverage(tasks, plan([{ id: 'api-only', covers: ['task:1.1'] }])),
    ).toThrow(/does not cover Acceptance/u);
    expect(() =>
      resolveAcceptanceCoverage(tasks, plan([{ id: 'optional', covers: ['*'], required: false }])),
    ).toThrow(/does not cover Acceptance/u);
  });
});
