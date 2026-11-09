import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { removeTemporaryDirectory, temporaryDirectory } from '../helpers/fixtures.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..', '..');
const entry = path.join(packageRoot, 'bin', 'repoctopus.js');
const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('CLI preflight', () => {
  it('reports its packaged version outside the product without reading the business package', async () => {
    const cwd = await temporaryDirectory('repoctopus-cli-version-');
    cleanup.push(cwd);
    await writeFile(path.join(cwd, 'package.json'), '{"name":"business-app","version":"99.0.0"}');
    const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    const result = await execFileAsync(process.execPath, [entry, '--version'], { cwd });
    expect(result.stdout.trim()).toBe(metadata.version);
    expect(result.stderr).toBe('');
    expect(await readdir(cwd)).toEqual(['package.json']);
  });

  it('preserves explicit help precedence when version is also requested', async () => {
    const cwd = await temporaryDirectory('repoctopus-cli-version-help-');
    cleanup.push(cwd);
    const result = await execFileAsync(process.execPath, [entry, '--version', '--help'], { cwd });
    expect(result.stdout).toMatch(/^Usage: repoctopus /u);
    expect(await readdir(cwd)).toEqual([]);
  });

  it.each([['--help'], ['--version'], ['run', 'start', '--help']])(
    'answers %s without booting a composition',
    async (...args) => {
      const cwd = await temporaryDirectory('repoctopus-cli-preflight-');
      cleanup.push(cwd);
      await expect(
        execFileAsync(process.execPath, [entry, ...args], { cwd }),
      ).resolves.toBeDefined();
      expect(await readdir(cwd)).toEqual([]);
    },
  );

  it.each([
    { args: ['run', 'start', '--unknown'], message: 'Unknown option: --unknown' },
    { args: ['spec', 'inspect'], message: 'Missing required option: --change' },
    { args: ['run', 'start', '--change', 'sample'], message: 'Missing required option: --target' },
    {
      args: [
        'run',
        'archive-prepare',
        '--run',
        'sample',
        '--intent',
        'missing.yaml',
        '--attempt',
        'evidence-1',
      ],
      message:
        'run archive-prepare no longer accepts ambiguous --attempt; use --evidence-attempt <attempt-id>',
    },
    {
      args: ['run', 'archive-prepare', '--run', 'sample', '--intent', 'missing.yaml'],
      message: 'Missing required option: --evidence-attempt',
    },
    {
      args: ['run', 'archive-publish', '--run', 'sample', '--attempt', '2'],
      message:
        'run archive-publish no longer accepts ambiguous --attempt; use --work-attempt <integer>',
    },
    {
      args: ['run', 'archive-publish', '--run', 'sample', '--work-attempt', 'zero'],
      message: 'Option --work-attempt must be an integer',
    },
  ] as const)(
    'rejects invalid input before composition and persistence',
    async ({ args, message }) => {
      const cwd = await temporaryDirectory('repoctopus-cli-preflight-');
      cleanup.push(cwd);
      const failure: unknown = await execFileAsync(process.execPath, [entry, ...args, '--json'], {
        cwd,
      }).catch((error: unknown) => error);
      if (
        !failure ||
        typeof failure !== 'object' ||
        !('stderr' in failure) ||
        typeof failure.stderr !== 'string'
      ) {
        throw new Error('CLI failure did not expose bounded stderr');
      }
      expect(failure.stderr).toContain(message);
      expect(await readdir(cwd)).toEqual([]);
    },
  );
});
