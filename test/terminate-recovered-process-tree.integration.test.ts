import { spawn, type ChildProcess } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { readProcessIdentity } from '../platform/process/process-identity.js';
import { terminateRecoveredProcessTree } from '../platform/process/terminate-process-tree.js';

const FIXTURE_START_TIMEOUT_MS = 5_000;

async function readDescendantPid(parent: ChildProcess): Promise<number> {
  const stdout = parent.stdout;
  if (!stdout) throw new Error('process-tree fixture has no stdout');
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('process-tree fixture did not report its descendant pid')),
      FIXTURE_START_TIMEOUT_MS,
    );
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      stdout.removeAllListeners('data');
      parent.removeListener('error', onError);
      parent.removeListener('exit', onExit);
      if (error) reject(error);
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (): void => finish(new Error('process-tree fixture exited before startup'));
    stdout.on('data', (chunk: Buffer | string) => {
      output += chunk.toString();
      const lineEnd = output.indexOf('\n');
      if (lineEnd === -1) return;
      const pid = Number(output.slice(0, lineEnd).trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        finish(new Error(`process-tree fixture reported an invalid pid: ${output.trim()}`));
        return;
      }
      finish();
      resolve(pid);
    });
    parent.once('error', onError);
    parent.once('exit', onExit);
  });
}

function processGroupExists(groupLeaderPid: number): boolean {
  try {
    process.kill(-groupLeaderPid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

describe('recovered POSIX process-tree integration', () => {
  it.runIf(process.platform !== 'win32')(
    'does not report terminated until the detached parent and descendant are gone',
    async () => {
      const parent = spawn(
        process.execPath,
        [
          '-e',
          [
            "const { spawn } = require('node:child_process');",
            "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
            "process.stdout.write(String(descendant.pid) + '\\n');",
            'setInterval(() => {}, 1000);',
          ].join('\n'),
        ],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );

      try {
        const descendantPid = await readDescendantPid(parent);
        const identity = parent.pid === undefined ? null : await readProcessIdentity(parent.pid);
        expect(parent.pid).toBeTypeOf('number');
        expect(identity).not.toBeNull();
        expect(processExists(descendantPid)).toBe(true);

        const result = await terminateRecoveredProcessTree(parent.pid!, identity!);

        expect(result).toBe('terminated');
        expect(processGroupExists(parent.pid!)).toBe(false);
        expect(processExists(descendantPid)).toBe(false);
      } finally {
        if (parent.pid !== undefined) {
          try {
            process.kill(-parent.pid, 'SIGKILL');
          } catch {
            // The successful path has already removed the complete process group.
          }
        }
      }
    },
    10_000,
  );
});
