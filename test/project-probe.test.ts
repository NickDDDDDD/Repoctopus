import { execFile } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { probeProject, normalizeRemoteIdentity } from '../platform/git/probe.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('multi-repository project probe', () => {
  it('discovers only direct sibling repositories without writing to them', async () => {
    const root = await temporaryDirectory('repoctopus-probe-');
    cleanup.push(root);
    const workspace = await createGitRepository(root, 'repoctopus-workspace');
    const first = await createGitRepository(
      root,
      'front',
      'https://token@example.com/team/front.git',
    );
    await createGitRepository(root, 'backend', 'git@example.com:team/backend.git');
    const nestedParent = path.join(root, 'nested');
    await mkdir(nestedParent);
    await createGitRepository(nestedParent, 'ignored');
    const before = await readFile(path.join(first, 'README.md'), 'utf8');
    const beforeStatus = (
      await execFileAsync('git', ['status', '--porcelain=v2', '-z'], { cwd: first })
    ).stdout;
    const beforeIndex = await readFile(path.join(first, '.git', 'index'));
    const beforeHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: first })).stdout;
    const beforeBranch = (
      await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: first })
    ).stdout;

    const snapshot = await probeProject({
      root,
      workspaceRoot: workspace,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const later = await probeProject({
      root,
      workspaceRoot: workspace,
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    });

    expect(snapshot.repositories.map((repository) => repository.name).sort()).toEqual([
      'backend',
      'front',
    ]);
    expect(
      snapshot.repositories.find((repository) => repository.name === 'front')?.remoteIdentity,
    ).toBe('example.com/team/front');
    expect(snapshot.digest).toBe(later.digest);
    expect(await readFile(path.join(first, 'README.md'), 'utf8')).toBe(before);
    expect(await readFile(path.join(first, '.git', 'index'))).toEqual(beforeIndex);
    expect(
      (await execFileAsync('git', ['status', '--porcelain=v2', '-z'], { cwd: first })).stdout,
    ).toBe(beforeStatus);
    expect((await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: first })).stdout).toBe(
      beforeHead,
    );
    expect(
      (await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: first })).stdout,
    ).toBe(beforeBranch);
  });

  it('detects worktree changes and strips remote credentials', async () => {
    const root = await temporaryDirectory('repoctopus-probe-dirty-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'front');
    const clean = await probeProject({ root });
    await writeFile(path.join(repository, 'staged.txt'), 'staged');
    await execFileAsync('git', ['add', 'staged.txt'], { cwd: repository });
    await writeFile(path.join(repository, 'README.md'), '# changed\n');
    await writeFile(path.join(repository, 'new.txt'), 'untracked');
    const dirty = await probeProject({ root });
    expect(clean.digest).not.toBe(dirty.digest);
    expect(dirty.repositories[0]?.worktree.staged).toBe(1);
    expect(dirty.repositories[0]?.worktree.unstaged).toBe(1);
    expect(dirty.repositories[0]?.worktree.untracked).toBe(1);
    expect(normalizeRemoteIdentity('https://alice:secret@example.com/team/repo.git?token=x')).toBe(
      'example.com/team/repo',
    );
  });

  it('supports detached HEAD and spaces while ignoring non-Git and escaping junctions', async () => {
    const root = await temporaryDirectory('repoctopus probe edges ');
    const outside = await temporaryDirectory('repoctopus-outside-');
    cleanup.push(root, outside);
    const repository = await createGitRepository(root, 'front app');
    await execFileAsync('git', ['checkout', '--detach'], { cwd: repository });
    await mkdir(path.join(root, 'notes'));
    await createGitRepository(outside, 'outside-repo');
    await symlink(path.join(outside, 'outside-repo'), path.join(root, 'escaped'), 'junction');
    const snapshot = await probeProject({ root });
    expect(snapshot.repositories).toHaveLength(1);
    expect(snapshot.repositories[0]).toMatchObject({ name: 'front app', branch: null });
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'path-outside-root' })]),
    );
  });

  it('rejects duplicate remote identities', async () => {
    const root = await temporaryDirectory('repoctopus-duplicate-');
    cleanup.push(root);
    await createGitRepository(root, 'front-a', 'https://example.com/team/front.git');
    await createGitRepository(root, 'front-b', 'git@example.com:team/front.git');
    await expect(probeProject({ root })).rejects.toThrow(/duplicate repository identity/i);
  });

  it('can omit every ambiguous identity while retaining unrelated repositories', async () => {
    const root = await temporaryDirectory('repoctopus-duplicate-diagnostic-');
    cleanup.push(root);
    const first = await createGitRepository(root, 'first', 'https://github.com/example/shared.git');
    const second = await createGitRepository(root, 'second', 'git@github.com:example/shared.git');
    await createGitRepository(root, 'unique', 'https://github.com/example/unique.git');

    const snapshot = await probeProject({ root, duplicateIdentity: 'omit-ambiguous' });

    expect(snapshot.repositories).toHaveLength(1);
    expect(snapshot.repositories[0]?.name).toBe('unique');
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-repository-identity', path: first }),
        expect.objectContaining({ code: 'duplicate-repository-identity', path: second }),
      ]),
    );
  });
});
