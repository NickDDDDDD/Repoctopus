import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
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
