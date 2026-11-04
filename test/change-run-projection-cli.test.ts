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

  it('renders the public Build protocol projection without exposing checkout paths', () => {
    const lifecycle = projectChangeRun(
      {
        ...createChangeLifecycleSnapshot({
          identity: {
            workspaceId: 'team',
            changeId: 'build-projection',
            runId: 'change-team-build-projection-g1',
          },
        }),
        phase: 'build',
        status: 'running',
      },
      {
        taskProgress: { total: 2, completed: 1, currentTaskId: '1.2' },
        evidence: {
          gateStatus: 'not-evaluated',
          acceptedBundleIds: [],
          latestAttemptId: null,
        },
        nextActions: [],
        freshness: {
          stateVersion: 8,
          trajectoryOffset: 14,
          observedAt: '2026-10-28T00:00:00.000Z',
        },
      },
    );
    const output = renderChangeProjection({
      ...lifecycle,
      build: {
        action: 'execute',
        actionAttempt: 2,
        strategyId: 'build-strategy:123',
        bindingId: 'execution-binding:456',
        bindingRevision: 2,
        executionMode: 'subagent-driven-development',
        tddMode: 'tdd',
        isolation: 'worktree',
        planId: 'build-plan:456',
        planRevision: 3,
        packageId: 'work-package:789',
        completedPackages: 1,
        totalPackages: 2,
        checkAccepted: false,
      },
    }).join('\n');

    expect(output).toContain('Build action: execute (attempt 2)');
    expect(output).toContain('execution=subagent-driven-development; tdd=tdd; isolation=worktree');
    expect(output).toContain('Build plan: build-plan:456 (revision 3)');
    expect(output).toContain('Build packages: 1/2 (current work-package:789)');
    expect(output).not.toMatch(/[A-Z]:\\|checkoutPath/u);
  });

  it('renders a terminal Archive projection without a stale next action', () => {
    const lifecycle = projectChangeRun(
      {
        ...createChangeLifecycleSnapshot({
          identity: {
            workspaceId: 'team',
            changeId: 'completed-change',
            runId: 'change-team-completed-change',
          },
        }),
        phase: 'archive',
        status: 'completed',
        currentWork: null,
      },
      {
        taskProgress: { total: 2, completed: 2, currentTaskId: null },
        evidence: {
          gateStatus: 'satisfied',
          acceptedBundleIds: ['bundle-completed'],
          latestAttemptId: 'attempt-completed',
        },
        nextActions: [],
        freshness: {
          stateVersion: 12,
          trajectoryOffset: 20,
          observedAt: '2026-11-04T00:00:00.000Z',
        },
      },
    );

    const output = renderChangeProjection(lifecycle).join('\n');
    expect(output).toContain('Phase: archive');
    expect(output).toContain('Status: completed');
    expect(output).toContain('Work: -');
    expect(output).not.toContain('Lifecycle next actions:');
  });
});
