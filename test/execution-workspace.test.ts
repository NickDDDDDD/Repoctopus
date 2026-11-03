import { describe, expect, it, vi } from 'vitest';

import { createExecutionWorkspaceIntent } from '../domains/change-lifecycle/build-protocol.js';
import {
  BUILTIN_CHANGE_LIFECYCLE_DEFINITION,
  createChangeLifecycleSnapshot,
} from '../domains/change-lifecycle/definition.js';
import { evolveChangeLifecycle } from '../domains/change-lifecycle/transition.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import {
  bindExecutionWorkspace,
  ExecutionWorkspaceBindingError,
  type ExecutionCheckoutFacts,
} from '../services/execution-workspace.js';
import { WorkflowRuns } from '../services/workflow-runs.js';

const sha = (value: string): `sha256:${string}` => `sha256:${value.padEnd(64, value).slice(0, 64)}`;

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
    },
    {
      isolation: 'worktree' as const,
      path: 'C:\\workspace-worktree',
      fact: facts({
        checkoutPath: 'C:\\workspace-worktree',
        branch: 'feature',
        worktreeId: 'wt-1',
      }),
    },
  ])('validates $isolation checkout facts without creating a checkout', async (example) => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: example.isolation,
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
      bindExecutionWorkspace({ intent: worktree, project: project(), checkouts: [] }, () =>
        Promise.resolve(facts()),
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

  it('classifies a linked checkout selected as current as an intent revision', async () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'current',
    });

    await expect(
      bindExecutionWorkspace(
        {
          intent,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\workspace' }],
        },
        () => Promise.resolve(facts({ worktreeId: 'linked-worktree' })),
      ),
    ).rejects.toMatchObject({
      name: 'ExecutionWorkspaceBindingError',
      code: 'current-linked-worktree',
      recovery: 'intent-revision',
    });
  });

  it('classifies retryable binding facts separately from terminal identity drift', async () => {
    const current = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'current',
    });
    const worktree = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'worktree',
    });

    await expect(
      bindExecutionWorkspace(
        {
          intent: current,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\other' }],
        },
        () => Promise.resolve(facts({ checkoutPath: 'C:\\other' })),
      ),
    ).rejects.toMatchObject({
      code: 'current-checkout-mismatch',
      recovery: 'binding-retry',
    });
    await expect(
      bindExecutionWorkspace(
        {
          intent: worktree,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\worktree' }],
        },
        () => Promise.resolve(facts({ checkoutPath: 'C:\\worktree' })),
      ),
    ).rejects.toMatchObject({
      code: 'worktree-ownership-missing',
      recovery: 'binding-retry',
    });
    await expect(
      bindExecutionWorkspace({ intent: worktree, project: project(), checkouts: [] }, () =>
        Promise.resolve(facts()),
      ),
    ).rejects.toMatchObject({ code: 'repository-topology-drift', recovery: 'halt' });
    await expect(
      bindExecutionWorkspace(
        {
          intent: worktree,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\worktree' }],
        },
        () =>
          Promise.resolve(
            facts({
              checkoutPath: 'C:\\worktree',
              remoteIdentity: 'github.com/other/workspace',
              worktreeId: 'wt-1',
            }),
          ),
      ),
    ).rejects.toMatchObject({ code: 'remote-identity-drift', recovery: 'halt' });
  });

  it('keeps delivery targets out of the portable isolation intent', () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'branch',
    });

    expect(intent).toMatchObject({ schemaVersion: 2, isolation: 'branch' });
    expect(intent).not.toHaveProperty('targetBranch');
  });

  it('binds independent branches for every repository in branch isolation', async () => {
    const branches = new Map([
      ['workspace', 'codex/add-compact-task-status'],
      ['backend', 'main'],
      ['web-design', 'codex/compact-status-badge'],
      ['web-front', 'main'],
      ['web-plugin', 'main'],
    ]);
    const repositories = [...branches].map(([id, branch], index) => ({
      ...project().repositories[0]!,
      id,
      name: id,
      path: `C:\\acceptance\\${id}`,
      remoteIdentity: `github.com/team/${id}`,
      branch,
      head: String(index).repeat(40),
    }));
    const multiRepositoryProject: ProjectSnapshot = {
      ...project('C:\\acceptance\\workspace'),
      repositories,
    };
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'add-compact-task-status',
      isolation: 'branch',
    });
    const checkouts = repositories.map((repository) => ({
      repositoryId: repository.id,
      checkoutPath: repository.path,
    }));

    const binding = await bindExecutionWorkspace(
      { intent, project: multiRepositoryProject, checkouts },
      (checkoutPath) => {
        const repository = repositories.find((candidate) => candidate.path === checkoutPath)!;
        return Promise.resolve(
          facts({
            checkoutPath,
            branch: branches.get(repository.id)!,
            head: repository.head,
            remoteIdentity: repository.remoteIdentity,
            gitDirectory: `${checkoutPath}\\.git`,
            commonDirectory: `${checkoutPath}\\.git`,
          }),
        );
      },
    );

    expect(
      Object.fromEntries(
        binding.repositories.map((repository) => [repository.repositoryId, repository.branch]),
      ),
    ).toEqual(Object.fromEntries(branches));
  });

  it('rejects a detached checkout without attached branch facts', async () => {
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'change',
      isolation: 'branch',
    });

    await expect(
      bindExecutionWorkspace(
        {
          intent,
          project: project(),
          checkouts: [{ repositoryId: 'workspace', checkoutPath: 'C:\\branch' }],
        },
        () => Promise.resolve(facts({ checkoutPath: 'C:\\branch', branch: '' })),
      ),
    ).rejects.toThrow(/branch/iu);
  });

  it('freezes the complete multi-repository topology across restart inspection', async () => {
    const multiRepositoryProject: ProjectSnapshot = {
      ...project(),
      repositories: [
        project().repositories[0]!,
        {
          ...project().repositories[0]!,
          id: 'worker',
          name: 'worker',
          path: 'C:\\worker',
          remoteIdentity: 'github.com/team/worker',
        },
      ],
    };
    const intent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'multi-repository-change',
      isolation: 'current',
    });
    const checkouts = [
      { repositoryId: 'workspace', checkoutPath: 'C:\\workspace' },
      { repositoryId: 'worker', checkoutPath: 'C:\\worker' },
    ];
    const inspect = (checkoutPath: string) =>
      Promise.resolve(
        checkoutPath.endsWith('worker')
          ? facts({
              checkoutPath,
              remoteIdentity: 'github.com/team/worker',
              gitDirectory: 'C:\\worker\\.git',
              commonDirectory: 'C:\\worker\\.git',
            })
          : facts({ checkoutPath }),
      );

    const first = await bindExecutionWorkspace(
      { intent, project: multiRepositoryProject, checkouts },
      inspect,
    );
    const afterRestart = await bindExecutionWorkspace(
      { intent, project: multiRepositoryProject, checkouts: [...checkouts].reverse() },
      inspect,
    );
    expect(afterRestart.semanticDigest).toBe(first.semanticDigest);
    expect(afterRestart.localDigest).toBe(first.localDigest);

    await expect(
      bindExecutionWorkspace(
        { intent, project: multiRepositoryProject, checkouts: checkouts.slice(0, 1) },
        inspect,
      ),
    ).rejects.toThrow(/topology/u);
    await expect(
      bindExecutionWorkspace(
        { intent, project: multiRepositoryProject, checkouts },
        (checkoutPath) => inspect(checkoutPath).then((entry) => ({ ...entry, worktreeId: 'wt' })),
      ),
    ).rejects.toThrow(/current isolation/iu);
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

  it('validates an Open isolation before writing lifecycle or specification approval state', async () => {
    const intentWait = {
      schemaVersion: 1 as const,
      kind: 'human-decision' as const,
      waitId: 'open-approval:request-1',
      requestId: 'request-1',
      proposalDigest: sha('b'),
      inputDigest: sha('a'),
      reason: 'review',
    };
    const lifecycle = {
      ...createChangeLifecycleSnapshot({
        identity: { workspaceId: 'team', changeId: 'change', runId: 'run-1' },
      }),
      status: 'waiting' as const,
      currentWork: null,
      waitCondition: intentWait,
    };
    const acceptChangeObservation = vi.fn();
    const decideSpecification = vi.fn();
    const bind = vi
      .fn()
      .mockRejectedValue(
        new ExecutionWorkspaceBindingError(
          'Current isolation cannot bind a linked worktree',
          'current-linked-worktree',
          'intent-revision',
        ),
      );
    const service = Object.create(WorkflowRuns.prototype) as WorkflowRuns;
    Object.defineProperties(service, {
      operations: {
        value: { run: (_options: unknown, operation: () => Promise<unknown>) => operation() },
      },
      coordinator: { value: { acceptChangeObservation } },
      ctx: {
        value: {
          runStore: {
            loadRun: vi.fn().mockResolvedValue({
              runId: 'run-1',
              status: 'waiting',
              changeLifecycle: lifecycle,
              trigger: {
                facts: {
                  executionCheckouts: [
                    { repositoryId: 'workspace', checkoutPath: 'C:\\workspace' },
                  ],
                },
              },
            }),
            loadProjectSnapshot: vi.fn().mockResolvedValue(project()),
          },
          executionWorkspace: { bind },
          specificationPlanning: { decide: decideSpecification },
        },
      },
    });

    await expect(
      service.decideChange({
        runId: 'run-1',
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: 'request-1',
          proposalHash: sha('b'),
          decision: 'approve',
        },
        actor: { actorId: 'trusted-user', source: 'cli', authenticated: true },
        isolation: 'current',
      }),
    ).rejects.toMatchObject({ code: 'current-linked-worktree' });

    expect(bind).toHaveBeenCalledOnce();
    expect(acceptChangeObservation).not.toHaveBeenCalled();
    expect(decideSpecification).not.toHaveBeenCalled();
  });
});
