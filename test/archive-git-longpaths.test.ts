import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { GitSpecificationCheckoutManager } from '../platform/git/specification-checkout.js';
import { executeArchiveGit } from '../platform/git/archive-git.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const git = promisify(execFile);
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('managed Archive Git long paths', () => {
  it('keeps NUL path output intact and leaves the parent configuration unchanged', async () => {
    const root = await temporaryDirectory('repoctopus-archive-git-output-');
    cleanup.push(root);
    const repository = await createGitRepository(root, 'workspace');
    await git('git', ['config', '--local', 'core.longpaths', 'false'], { cwd: repository });
    const file = ' leading path with spaces.txt';
    await writeFile(path.join(repository, file), 'content\n');
    await git('git', ['add', '--', file], { cwd: repository });
    const environment = { ...process.env };
    const output = await executeArchiveGit(repository, ['diff', '--cached', '--name-only', '-z']);
    expect(output.stdout).toBe(`${file}\0`);
    expect(
      (await executeArchiveGit(repository, ['config', '--get', 'core.longpaths'])).stdout.trim(),
    ).toBe(process.platform === 'win32' ? 'true' : 'false');
    expect(
      (
        await git('git', ['config', '--local', '--get', 'core.longpaths'], { cwd: repository })
      ).stdout.trim(),
    ).toBe('false');
    expect(process.env).toEqual(environment);
  });

  it.runIf(process.platform === 'win32')(
    'creates and cleans an isolated checkout beyond default Windows path limits',
    async () => {
      const root = await temporaryDirectory('repoctopus-archive-path-');
      cleanup.push(root);
      const repository = await createGitRepository(
        root,
        'w'.repeat(Math.max(16, 140 - root.length - 1)),
      );
      // Fixture-local false neutralizes a CI-global true. Real default-settings
      // acceptance separately retains unset user configuration and OS defaults.
      await git('git', ['config', '--local', 'core.longpaths', 'false'], { cwd: repository });
      await writeFile(path.join(repository, '.gitattributes'), '* text eol=lf\n');
      const relative =
        'openspec/changes/path-fixture/specs/archive-contract-with-an-additional-path-boundary/spec.md';
      expect(path.join(repository, relative).length).toBeLessThan(240);
      await mkdir(path.dirname(path.join(repository, relative)), { recursive: true });
      await writeFile(path.join(repository, relative), '# Long path fixture\n');
      await git('git', ['add', '.gitattributes', relative], { cwd: repository });
      await git('git', ['commit', '-m', 'test: archive path input'], { cwd: repository });
      const source = (await git('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim();
      const configuration = (await git('git', ['config', '--local', '--list'], { cwd: repository }))
        .stdout;
      const environment = { ...process.env };
      const manager = new GitSpecificationCheckoutManager(repository);
      const checkoutRoot = path.join(
        repository,
        '.repoctopus',
        'archive-checkouts',
        'closure-path-fixture',
      );
      // Git has a distinct GIT_DIR metadata-argument limit even with longpaths.
      // Stay within it so this control isolates file/directory path handling.
      expect(path.join(checkoutRoot, '.git').length).toBeLessThan(220);
      expect(path.join(checkoutRoot, relative).length).toBeGreaterThan(260);
      await expect(
        git('git', ['worktree', 'add', '--detach', checkoutRoot, source], { cwd: repository }),
      ).rejects.toThrow(/Filename too long/u);
      expect(await manager.find('closure-path-fixture')).toBeNull();
      const checkout = await manager.create('closure-path-fixture', source);
      expect(path.join(checkout.root, relative).length).toBeGreaterThan(260);
      expect(await readFile(path.join(checkout.root, relative), 'utf8')).toBe(
        '# Long path fixture\n',
      );
      expect((await manager.find(checkout.checkoutId))?.head).toBe(source);
      await manager.cleanup(checkout);
      expect(await manager.find(checkout.checkoutId)).toBeNull();
      expect((await git('git', ['config', '--local', '--list'], { cwd: repository })).stdout).toBe(
        configuration,
      );
      expect((await git('git', ['rev-parse', 'HEAD'], { cwd: repository })).stdout.trim()).toBe(
        source,
      );
      expect(process.env).toEqual(environment);
    },
  );
});
