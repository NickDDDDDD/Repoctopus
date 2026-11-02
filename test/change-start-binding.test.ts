import { describe, expect, it } from 'vitest';

import {
  ChangeStartBindingError,
  createChangeStartBinding,
} from '../domains/change-lifecycle/start-binding.js';
import { createProjectSnapshot } from '../domains/project/snapshot.js';
import type { ProjectSnapshot, TargetBranchSnapshot } from '../domains/project/types.js';

function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return createProjectSnapshot({
    schemaVersion: 1,
    projectId: 'team',
    root: overrides.root ?? 'C:/team',
    capturedAt: overrides.capturedAt ?? '2026-11-02T00:00:00.000Z',
    repositories: overrides.repositories ?? [
      {
        id: 'workspace',
        name: 'workspace',
        path: 'C:/team/workspace',
        remoteIdentity: 'https://example.test/team/workspace.git',
        branch: 'change/runtime-binding',
        head: '1'.repeat(40),
        worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
      },
      {
        id: 'backend',
        name: 'backend',
        path: 'C:/team/backend',
        remoteIdentity: 'https://example.test/team/backend.git',
        branch: 'change/runtime-binding',
        head: '2'.repeat(40),
        worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
      },
    ],
    diagnostics: [],
  });
}

const target: TargetBranchSnapshot = {
  repositoryId: 'workspace',
  remote: 'origin',
  remoteIdentity: 'https://example.test/team/workspace.git',
  targetBranch: 'main',
  remoteOid: '3'.repeat(40),
};

function create(projectSnapshot = snapshot(), targetBranch = target) {
  return createChangeStartBinding({
    projectSnapshot,
    workspaceRepositoryId: 'workspace',
    targetBranch,
  });
}

describe('ChangeStartBinding', () => {
  it.each([
    ['source-branch-detached', () => create(snapshot({ repositories: snapshot().repositories.map((repo) => repo.id === 'workspace' ? { ...repo, branch: null } : repo) }))],
    ['source-target-equal', () => create(snapshot({ repositories: snapshot().repositories.map((repo) => repo.id === 'workspace' ? { ...repo, branch: 'main' } : repo) }))],
    ['remote-identity-mismatch', () => create(snapshot(), { ...target, remoteIdentity: 'https://example.test/other.git' })],
    ['repository-topology-mismatch', () => create(snapshot({ repositories: snapshot().repositories.map((repo) => repo.id === 'backend' ? { ...repo, remoteIdentity: null } : repo) }))],
  ] as const)('rejects %s', (reason, operation) => {
    expect(operation).toThrowError(ChangeStartBindingError);
    expect(operation).toThrowError(expect.objectContaining({ code: `runtime.workspace-binding.${reason}` }));
  });

  it('is stable across volatile snapshot facts', () => {
    const baseline = snapshot();
    const changed = snapshot({
      root: 'D:/other-machine',
      capturedAt: '2026-11-03T00:00:00.000Z',
      repositories: baseline.repositories.map((repository) => ({
        ...repository,
        path: `D:/other-machine/${repository.id}`,
        head: 'f'.repeat(40),
        worktree: { dirty: true, digest: 'changed', staged: 1, unstaged: 2, untracked: 3 },
      })),
    });
    expect(create(changed)).toEqual(create(baseline));
  });

  it('changes identity when the attached source branch changes', () => {
    const changed = snapshot({
      repositories: snapshot().repositories.map((repository) =>
        repository.id === 'workspace' ? { ...repository, branch: 'change/other' } : repository,
      ),
    });
    expect(create(changed).digest).not.toBe(create().digest);
  });
});
