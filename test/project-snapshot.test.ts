import { describe, expect, it } from 'vitest';

import { reconcileProjectSnapshots } from '../domains/project/snapshot.js';
import type { ProjectSnapshot, RepositorySnapshot } from '../domains/project/types.js';
import { projectFixture } from './helpers/fixtures.js';

function repository(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    id: 'repository-1',
    name: 'front',
    path: 'C:/project/front',
    remoteIdentity: 'example.com/team/front',
    branch: 'main',
    head: 'a'.repeat(40),
    worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
    ...overrides,
  };
}

const repositoryDriftCases: Array<
  [string, Partial<RepositorySnapshot>, 'content' | 'identity', boolean]
> = [
  ['head', { head: 'b'.repeat(40) }, 'content', false],
  [
    'worktree',
    { worktree: { dirty: true, digest: 'dirty', staged: 0, unstaged: 1, untracked: 0 } },
    'content',
    false,
  ],
  ['branch', { branch: 'feature' }, 'identity', true],
  ['remoteIdentity', { remoteIdentity: 'example.com/other/front' }, 'identity', true],
  ['path', { path: 'D:/moved/front' }, 'identity', true],
];

const projectIdentityDriftCases: Array<[string, Partial<ProjectSnapshot>]> = [
  ['project identity', { projectId: 'other-project' }],
  ['project root', { root: 'D:/other-project' }],
  ['repository addition', { repositories: [repository(), repository({ id: 'repository-2' })] }],
  ['repository removal', { repositories: [] }],
  [
    'diagnostics',
    {
      diagnostics: [
        { code: 'path-unreadable' as const, path: 'C:/project/front', message: 'unreadable' },
      ],
    },
  ],
];

describe('project reconciliation', () => {
  it('reports path, branch, HEAD and worktree changes', () => {
    const previous = projectFixture({ repositories: [repository()] });
    const current = projectFixture({
      repositories: [
        repository({
          path: 'D:/moved/front',
          branch: 'feature',
          head: 'b'.repeat(40),
          worktree: { dirty: true, digest: 'dirty', staged: 0, unstaged: 1, untracked: 0 },
        }),
      ],
    });
    expect(reconcileProjectSnapshots(previous, current).changedRepositories[0]?.fields).toEqual([
      'path',
      'branch',
      'head',
      'worktree',
    ]);
  });

  it('reports no changes when only capture time differs', () => {
    const previous = projectFixture({ repositories: [repository()] });
    const current = projectFixture({
      capturedAt: '2027-01-01T00:00:00.000Z',
      repositories: [repository()],
    });
    expect(reconcileProjectSnapshots(previous, current)).toMatchObject({
      changed: false,
      changeClass: 'same',
      requiresReconciliation: false,
    });
  });

  it.each(repositoryDriftCases)(
    'classifies repository %s drift as %s',
    (_field, overrides, changeClass, requiresReconciliation) => {
      const previous = projectFixture({ repositories: [repository()] });
      const current = projectFixture({ repositories: [repository(overrides)] });

      expect(reconcileProjectSnapshots(previous, current)).toMatchObject({
        changed: true,
        changeClass,
        requiresReconciliation,
      });
    },
  );

  it.each(projectIdentityDriftCases)('classifies %s drift as identity', (_label, overrides) => {
    const previous = projectFixture({ repositories: [repository()] });
    const current = projectFixture(overrides);

    expect(reconcileProjectSnapshots(previous, current)).toMatchObject({
      changed: true,
      changeClass: 'identity',
      requiresReconciliation: true,
    });
  });
});
