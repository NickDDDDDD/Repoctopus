import { describe, expect, it } from 'vitest';

import { reconcileProjectSnapshots } from '../domains/project/snapshot.js';
import type { RepositorySnapshot } from '../domains/project/types.js';
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
    expect(reconcileProjectSnapshots(previous, current).changed).toBe(false);
  });
});
