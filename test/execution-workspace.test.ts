import { describe, expect, it } from 'vitest';

import { createExecutionWorkspaceIntent } from '../domains/change-lifecycle/build-protocol.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import { evolveChangeLifecycle } from '../domains/change-lifecycle/transition.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import {
  bindExecutionWorkspace,
  type ExecutionCheckoutFacts,
} from '../services/execution-workspace.js';

const sha = (value: string): `sha256:${string}` =>
  `sha256:${value.padEnd(64, value).slice(0, 64)}`;

function project(path = 'C:\\workspace'): ProjectSnapshot {
  return {
    schemaVersion: 1,
    projectId: 'team',
    root: path,
    capturedAt: '2026-10-28T00:00:00.000Z',
    repositories: [
      {
        id: 'workspace',
        name: 'workspace',
        path,
        remoteIdentity: 'github.com/team/workspace',
        branch: 'main',
        head: '0'.repeat(40),
        worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
      },
    ],
    diagnostics: [],
    digest: 'project-digest',
  };
}

function facts(overrides: Partial<ExecutionCheckoutFacts> = {}): ExecutionCheckoutFacts {
  return {
    checkoutPath: 'C:\\workspace',
    branch: 'main',
    head: '1'.repeat(40),
    remoteIdentity: 'github.com/team/workspace',
    gitDirectory: 'C:\\workspace\\.git',
    commonDirectory: 'C:\\workspace\\.git',
    worktreeId: null,
    ...overrides,
  };
}

describe('Execution Workspace binding', () => {
  it.each([
    {
      isolation: 'current' as const,
      path: 'C:\\workspace',
      fact: facts(),
    },
    {
      isolation: 'branch' as const,
      path: 'C:\\workspace-branch',
      fact: facts({ checkoutPath: 'C:\\workspace-branch', branch: 'feature' }),
      targetBranch: 'feature',
    },
    {
      isolation: 'worktree' as const,
      path: 'C:\\workspace-worktree',
      fact: facts({ checkoutPath: 'C:\\workspace-worktree', branch: 'feature', worktreeId: 'wt-1' }),
    },
  ])('validates $isolation checkout facts without creating a checkout', async (example) => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: example.isolation,
      ...(example.targetBranch ? { targetBranch: example.targetBranch } : {}),
    });
    let inspected = '';
    const binding = await bindExecutionWorkspace(
      {
        intent,
        project: project(),
        checkouts: [{ repositoryId: 'workspace', checkoutPath: example.path }],
      },
      (checkoutPath) => {
        inspected = checkoutPath;
        return Promise.resolve(example.fact);
      },
    );

    expect(inspected).toBe(example.path);
    expect(binding.isolation).toBe(example.isolation);
    expect(binding.repositories[0]).toMatchObject({ repositoryId: 'workspace' });
  });

  it('fails closed on topology, identity, branch, and worktree drift', async () => {
    const worktree = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'worktree',
    });
    await expect(
      bindExecutionWorkspace(
        { intent: worktree, project: project(), checkouts: [] },
        () => Promise.resolve(facts()),
      ),
    ).rejects.toThrow(/topology/u);
    await expect(
      bindExecutionWorkspace(
        {
          intent: worktree,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\workspace-worktree' }],
        },
        () =>
          Promise.resolve(
            facts({ checkoutPath: 'C:\\workspace-worktree', remoteIdentity: 'other' }),
          ),
      ),
    ).rejects.toThrow(/identity drifted/u);
    await expect(
      bindExecutionWorkspace(
        {
          intent: worktree,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\workspace-worktree' }],
        },
        () => Promise.resolve(facts({ checkoutPath: 'C:\\workspace-worktree' })),
      ),
    ).rejects.toThrow(/ownership facts/u);
  });

  it('binds the isolation choice to the current Open Human Decision', () => {
    const initial = createChangeLifecycleSnapshot({
      identity: { workspaceId: 'team', changeId: 'change', runId: 'run-1' },
    });
    const waiting = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: initial,
      observation: {
        kind: 'open-gate',
        result: 'waiting',
        reason: 'review',
        evidenceIds: [],
        inputDigest: sha('a'),
        requestId: 'request-1',
        proposalDigest: sha('b'),
      },
    }).snapshot;
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'worktree',
    });
    const selected = evolveChangeLifecycle({
      definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
      current: waiting,
      observation: {
        kind: 'open-workspace-intent-selected',
        intent,
        requestId: 'request-1',
        proposalDigest: sha('b'),
        actorId: 'user-1',
      },
    }).snapshot;

    expect(selected.workspaceIntent).toEqual(intent);
    expect(() =>
      evolveChangeLifecycle({
        definition: BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
        current: selected,
        observation: {
          kind: 'open-workspace-intent-selected',
          intent: createExecutionWorkspaceIntent({
            workspaceId: 'team',
            changeId: 'change',
            isolation: 'current',
          }),
          requestId: 'request-1',
          proposalDigest: sha('b'),
          actorId: 'user-1',
        },
      }),
    ).toThrow(/cannot replace/u);
  });
});
