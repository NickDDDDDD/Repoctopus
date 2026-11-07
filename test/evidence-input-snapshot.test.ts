import { execFile } from 'node:child_process';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { collectEvidenceInputFiles } from '../platform/git/evidence-input-snapshot.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(() => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

it('binds effective bytes across dirty, index and commit and observes real changes', async () => {
  const root = await temporaryDirectory('evidence-source-');
  cleanup.push(root);
  const repo = await createGitRepository(root, 'app');
  await writeFile(path.join(repo, 'source.txt'), 'real input\n');
  const capture = () => collectEvidenceInputFiles({ root: repo });
  const dirty = await capture();
  await git('git', ['add', '.'], { cwd: repo });
  expect(await capture()).toEqual(dirty);
  await git('git', ['commit', '-m', 'same effective bytes'], { cwd: repo });
  expect(await capture()).toEqual(dirty);
  await writeFile(path.join(repo, 'source.txt'), 'changed input\n');
  expect(await capture()).not.toEqual(dirty);
});

it('captures explicit ignored input and literal brackets without trusting gitignore', async () => {
  const root = await temporaryDirectory('evidence-explicit-');
  cleanup.push(root);
  const repo = await createGitRepository(root, 'app');
  await writeFile(path.join(repo, '.gitignore'), 'private/\n');
  await mkdir(path.join(repo, 'private'));
  await writeFile(path.join(repo, 'private', '[id].txt'), 'private\n');
  const capture = () => collectEvidenceInputFiles({ root: repo, files: ['private/[id].txt'] });
  expect((await capture()).map((file) => file.path)).toEqual(['private/[id].txt']);
  await writeFile(path.join(repo, 'private', '[id].txt'), 'changed\n');
  expect((await capture())[0]!.size).toBe(8);
});

it('rejects a collection that changes while it is captured', async () => {
  const root = await temporaryDirectory('evidence-race-');
  cleanup.push(root);
  const repo = await createGitRepository(root, 'app');
  const file = path.join(repo, 'source.txt');
  await writeFile(file, 'before');
  await expect(
    collectEvidenceInputFiles({
      root: repo,
      hooks: {
        beforeFinalSelection: () => writeFile(file, 'after'),
      },
    }),
  ).rejects.toThrow(/changed/u);
});

it('includes unknown ignored files in the default conservative scope', async () => {
  const root = await temporaryDirectory('evidence-ignored-default-');
  cleanup.push(root);
  const repo = await createGitRepository(root, 'app');
  await writeFile(path.join(repo, '.gitignore'), '.env\n');
  await writeFile(path.join(repo, '.env'), 'MODE=one');
  const first = await collectEvidenceInputFiles({ root: repo });
  expect(first.some((file) => file.path === '.env')).toBe(true);
  await writeFile(path.join(repo, '.env'), 'MODE=two');
  expect(await collectEvidenceInputFiles({ root: repo })).not.toEqual(first);
});

it('binds internal symlink target bytes and rejects external targets', async (context) => {
  const root = await temporaryDirectory('evidence-symlink-');
  cleanup.push(root);
  const repo = await createGitRepository(root, 'app');
  await writeFile(path.join(repo, 'real.txt'), 'before');
  try {
    await symlink('real.txt', path.join(repo, 'config.txt'), 'file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      context.skip();
      return;
    }
    throw error;
  }
  const first = await collectEvidenceInputFiles({ root: repo, files: ['config.txt'] });
  await writeFile(path.join(repo, 'real.txt'), 'after');
  expect(await collectEvidenceInputFiles({ root: repo, files: ['config.txt'] })).not.toEqual(first);
  await writeFile(path.join(root, 'outside.txt'), 'secret');
  await symlink('../outside.txt', path.join(repo, 'external.txt'), 'file');
  await expect(collectEvidenceInputFiles({ root: repo, files: ['external.txt'] })).rejects.toThrow(
    /outside/u,
  );
});
