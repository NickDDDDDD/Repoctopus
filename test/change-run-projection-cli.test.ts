import { describe, expect, it } from 'vitest';

import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { projectChangeRun } from '../domains/change-lifecycle/transition.js';
import { renderChangeProjection } from '../app/cli/change-run-view.js';

describe('Change Run CLI projection', () => {
  it('renders the canonical projection without dumping internal Run state', () => {
    const lifecycle = projectChangeRun(
      {
        ...createChangeLifecycleSnapshot({
          identity: {
            workspaceId: 'team',
            changeId: 'projection-test',
            generation: 3,
            mode: 'fresh',
            runId: 'change-team-projection-test-g3',
          },
        }),
        phase: 'design',
        status: 'waiting',
        waitCondition: {
          schemaVersion: 1,
          kind: 'human-decision',
          waitId: 'wait-design',
          reason: 'Review the planning proposal',
          inputDigest: `sha256:${'a'.repeat(64)}`,
          requestId: 'decision-1',
          proposalDigest: `sha256:${'b'.repeat(64)}`,
        },
      },
      {
        taskProgress: { total: 4, completed: 1, currentTaskId: null },
        evidence: {
          gateStatus: 'not-evaluated',
          acceptedBundleIds: [],
          latestAttemptId: null,
        },
        nextActions: [{ id: 'design.review', kind: 'decision', label: 'Review planning decision' }],
        freshness: {
          stateVersion: 5,
          trajectoryOffset: 8,
          observedAt: '2026-10-24T00:00:00.000Z',
        },
      },
    );
    const output = renderChangeProjection(lifecycle).join('\n');
    expect(output).toContain('Phase: design');
    expect(output).toContain('Status: waiting');
    expect(output).toContain('Tasks: 1/4');
    expect(output).toContain('Wait: human-decision - Review the planning proposal');
    expect(output).toContain('Lifecycle next actions:');
  });
});
