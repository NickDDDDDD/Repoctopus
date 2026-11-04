import { describe, expect, it } from 'vitest';

import {
  createBuildStrategy,
  createExecutionBinding,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import { createProjectSnapshot } from '../domains/project/snapshot.js';
import { classifyProtectedBranchRebind } from '../domains/runtime/authorized-rebind.js';

const strategy = createBuildStrategy({
  runId: 'run-1',
  revision: 1,
  executionMode: 'autonomous',
  tddMode: 'tdd',
  reviewMode: 'standard',
  isolationIntent: 'current',
});
const workspaceIntent = createExecutionWorkspaceIntent({
  workspaceId: 'workspace-1',
  changeId: 'change-1',
  isolation: 'current',
});
const workspaceBinding = createExecutionWorkspaceBinding({
  intent: workspaceIntent,
  repositories: [
    {
      repositoryId: 'app',
      checkoutPath: 'C:/project/app',
      branch: 'main',
      head: 'a'.repeat(40),
      worktreeId: null,
      workspaceOwned: true,
    },
    {
      repositoryId: 'worker',
      checkoutPath: 'C:/project/worker',
      branch: 'main',
      head: 'b'.repeat(40),
      worktreeId: null,
      workspaceOwned: true,
    },
  ],
});
const binding = createExecutionBinding({
  strategy,
  revision: 1,
  coordinatorHostId: 'host-1',
  workspaceBinding,
  workspaceOwnerId: 'workspace-1',
  localOverlayRef: 'overlay:one',
});
const candidate = {
  packages: [
    {
      packageKey: 'one',
      taskIds: ['task-1'],
      repositoryIds: ['app'],
      writeScopes: [{ repositoryId: 'app', paths: ['src/**'] }],
      acceptanceRefs: ['acceptance-1'],
      expectedOutcomes: ['done'],
      validatorProfile: 'build-package-v1',
      dependsOn: [],
    },
    {
      packageKey: 'two',
      taskIds: ['task-2'],
      repositoryIds: ['worker'],
      writeScopes: [{ repositoryId: 'worker', paths: ['src/**'] }],
      acceptanceRefs: ['acceptance-2'],
      expectedOutcomes: ['done'],
      validatorProfile: 'build-package-v1',
      dependsOn: ['one'],
    },
  ],
};

function snapshot(branches: { app: string; worker: string }, appPath = 'C:/project/app') {
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId: 'project-1',
    root: 'C:/project',
    capturedAt: '2026-11-04T00:00:00.000Z',
    repositories: [
      {
        id: 'app',
        name: 'app',
        path: appPath,
        remoteIdentity: 'remote-app',
        branch: branches.app,
        head: 'a'.repeat(40),
        worktree: { dirty: false, digest: 'clean-app', staged: 0, unstaged: 0, untracked: 0 },
      },
      {
        id: 'worker',
        name: 'worker',
        path: 'C:/project/worker',
        remoteIdentity: 'remote-worker',
        branch: branches.worker,
        head: 'b'.repeat(40),
        worktree: {
          dirty: false,
          digest: 'clean-worker',
          staged: 0,
          unstaged: 0,
          untracked: 0,
        },
      },
    ],
    diagnostics: [],
  });
}

function classify(current = snapshot({ app: 'feature/recovery', worker: 'feature/recovery' })) {
  return classifyProtectedBranchRebind({
    phase: 'build',
    workKind: 'build.plan',
    executionStatus: 'invoking',
    continuation: 'awaiting-correction',
    candidate,
    binding,
    protectedBranches: ['main'],
    previousProjectSnapshot: snapshot({ app: 'main', worker: 'main' }),
    currentProjectSnapshot: current,
    reconciliationRequired: false,
  });
}

describe('authorized protected branch rebind classification', () => {
  it('authorizes only the rejected protected write repositories', () => {
    const result = classify();
    expect(result).toMatchObject({
      authorized: true,
      value: {
        correctedRepositoryIds: ['app', 'worker'],
        unresolvedRepositoryIds: [],
        repositoryCount: 2,
        poisonRecovery: false,
      },
    });
  });

  it('keeps partial correction explicit and bounded', () => {
    const result = classify(snapshot({ app: 'feature/recovery', worker: 'main' }));
    expect(result).toMatchObject({
      authorized: true,
      value: {
        correctedRepositoryIds: ['app'],
        unresolvedRepositoryIds: ['worker'],
      },
    });
  });

  it('rejects unrelated branch and path identity drift', () => {
    expect(
      classifyProtectedBranchRebind({
        phase: 'build',
        workKind: 'build.plan',
        executionStatus: 'invoking',
        continuation: 'awaiting-correction',
        candidate: { packages: [candidate.packages[0]!] },
        binding,
        protectedBranches: ['main'],
        previousProjectSnapshot: snapshot({ app: 'main', worker: 'main' }),
        currentProjectSnapshot: snapshot({ app: 'feature/recovery', worker: 'other' }),
        reconciliationRequired: false,
      }),
    ).toMatchObject({ authorized: false, reason: 'branch-change-unrelated' });
    expect(
      classify(snapshot({ app: 'feature/recovery', worker: 'feature/recovery' }, 'D:/moved/app')),
    ).toMatchObject({ authorized: false, reason: 'project-identity-drift' });
  });

  it('requires exact matching evidence before clearing reconciliation poison', () => {
    const current = snapshot({ app: 'feature/recovery', worker: 'feature/recovery' });
    const base = classify(current);
    if (!base.authorized) throw new Error('expected authorized baseline');
    expect(
      classifyProtectedBranchRebind({
        phase: 'build',
        workKind: 'build.plan',
        executionStatus: 'invoking',
        continuation: 'awaiting-correction',
        candidate,
        binding,
        protectedBranches: ['main'],
        previousProjectSnapshot: snapshot({ app: 'main', worker: 'main' }),
        currentProjectSnapshot: current,
        reconciliationRequired: true,
        poisonReconciliation: base.value.reconciliation,
      }),
    ).toMatchObject({ authorized: true, value: { poisonRecovery: true } });
    expect(
      classifyProtectedBranchRebind({
        phase: 'build',
        workKind: 'build.plan',
        executionStatus: 'invoking',
        continuation: 'awaiting-correction',
        candidate,
        binding,
        protectedBranches: ['main'],
        previousProjectSnapshot: snapshot({ app: 'main', worker: 'main' }),
        currentProjectSnapshot: current,
        reconciliationRequired: true,
        poisonReconciliation: null,
      }),
    ).toMatchObject({ authorized: false, reason: 'reconciliation-poison-mismatch' });
  });
});
