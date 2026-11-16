import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';

import {
  observeExecutionCleanupCommit,
  readTrackedExecutionInputs,
} from '../platform/git/execution-workspace.js';
import {
  commitGitRepository,
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const execute = promisify(execFile);
const cleanup: string[] = [];
const runtimeFile = '.repoctopus/example state.json';
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function fixture() {
  const root = await temporaryDirectory('repoctopus-cleanup-git-');
  cleanup.push(root);
  const checkout = await createGitRepository(root, 'workspace');
  const git = async (...args: string[]) =>
    (await execute('git', args, { cwd: checkout })).stdout.trim();
  await writeFile(path.join(checkout, '.gitignore'), '/.repoctopus/\n');
  await mkdir(path.join(checkout, '.repoctopus'));
  await writeFile(path.join(checkout, runtimeFile), '{}');
  await git('add', '-f', '--', runtimeFile);
  return { checkout, git };
}

it('observes tracked runtime paths in both the index and the bound HEAD', async () => {
  const { checkout, git } = await fixture();
  expect(await readTrackedExecutionInputs(checkout, await git('rev-parse', 'HEAD'))).toContain(
    runtimeFile,
  );
  await commitGitRepository(checkout, 'track fixture run state');
  const previous = await git('rev-parse', 'HEAD');
  await git('rm', '--cached', '--', runtimeFile);
  expect(await readTrackedExecutionInputs(checkout, previous)).toContain(runtimeFile);
  await commitGitRepository(checkout, 'untrack fixture run state');
  expect(await readTrackedExecutionInputs(checkout, await git('rev-parse', 'HEAD'))).not.toContain(
    runtimeFile,
  );
});

it.each([
  'only-delete',
  'mixed',
  'staged',
  'two-commits',
  'assume-unchanged',
  'skip-worktree',
  'modified-output',
] as const)(
  'proves one observed deletion-only Git commit, rejecting %s when out of scope',
  async (scenario) => {
    const { checkout, git } = await fixture();
    await commitGitRepository(checkout, 'track fixture run state');
    const previous = await git('rev-parse', 'HEAD');
    if (scenario === 'modified-output') {
      await writeFile(path.join(checkout, runtimeFile), '{"changed":true}');
    } else {
      await git('rm', '--cached', '--', runtimeFile);
    }
    if (scenario === 'mixed')
      await writeFile(path.join(checkout, 'README.md'), 'changed product\n');
    await commitGitRepository(checkout, 'untrack fixture run state');
    if (scenario === 'two-commits') await git('commit', '--allow-empty', '-m', 'second commit');
    if (scenario === 'staged') await git('add', '-f', '--', runtimeFile);
    if (scenario === 'assume-unchanged' || scenario === 'skip-worktree') {
      await git('update-index', `--${scenario}`, '--', 'README.md');
      await writeFile(path.join(checkout, 'README.md'), 'hidden product change\n');
      expect(await git('status', '--porcelain')).toBe('');
    }
    const head = await git('rev-parse', 'HEAD');
    expect(await observeExecutionCleanupCommit(checkout, previous, head)).toEqual(
      scenario === 'only-delete' ? [runtimeFile] : null,
    );
  },
);

it('allows only the exact unstaged projection of an accepted task', async () => {
  const { checkout, git } = await fixture();
  const taskPath = 'tasks.md';
  const baseline = '- [ ] 1. Add the acceptance marker\n';
  const projected = '- [x] 1. Add the acceptance marker\n';
  await writeFile(path.join(checkout, taskPath), baseline);
  await commitGitRepository(checkout, 'track fixture output and planning');
  const previous = await git('rev-parse', 'HEAD');
  await git('rm', '--cached', '--', runtimeFile);
  await git('commit', '-m', 'untrack only the fixture output');
  const head = await git('rev-parse', 'HEAD');
  const expected = vi.fn(() =>
    Promise.resolve({
      path: taskPath,
      rawDigest: `sha256:${createHash('sha256').update(projected).digest('hex')}` as const,
      matchesCommittedDocument: (document: string) => document === baseline,
    }),
  );
  expect(await observeExecutionCleanupCommit(checkout, previous, head, expected)).toEqual([
    runtimeFile,
  ]);
  expect(expected).not.toHaveBeenCalled();
  await writeFile(path.join(checkout, taskPath), projected);
  expect(await observeExecutionCleanupCommit(checkout, previous, head, expected)).toEqual([
    runtimeFile,
  ]);
  await writeFile(path.join(checkout, taskPath), projected + 'Unapproved change\n');
  expect(await observeExecutionCleanupCommit(checkout, previous, head, expected)).toBeNull();
  await writeFile(path.join(checkout, taskPath), projected);
  await git('add', '--', taskPath);
  expect(await observeExecutionCleanupCommit(checkout, previous, head, expected)).toBeNull();
});
