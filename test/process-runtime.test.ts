import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalCommandAdapter } from '../platform/feedback/command-adapter.js';
import {
  inspectProcessLiveness,
  readProcessIdentity,
} from '../platform/process/process-identity.js';
import {
  assertSafeWindowsBatchArguments,
  spawnCommand,
} from '../platform/process/spawn-command.js';
import { terminateProcessTree } from '../platform/process/terminate-process-tree.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('process runtime', () => {
  it('passes arguments without a second shell expansion', async () => {
    const cwd = await temporaryDirectory('repoctopus-process-');
    cleanup.push(cwd);
    const result = await new LocalCommandAdapter().run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'value with spaces & symbols'],
      cwd,
      timeoutMs: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('value with spaces & symbols');
    expect(result.pid).toBeTypeOf('number');
  });

  it('rejects shell syntax in Windows batch arguments', () => {
    expect(() => assertSafeWindowsBatchArguments(['safe', 'unsafe & command'])).toThrow(
      /must not contain shell syntax/i,
    );
  });

  it('uses creation identity instead of PID alone', async () => {
    const identity = await readProcessIdentity(process.pid);
    expect(identity).toBeTruthy();
    expect(await inspectProcessLiveness(process.pid, identity ?? undefined)).toBe('alive');
    expect(await inspectProcessLiveness(process.pid, 'other:identity')).not.toBe('alive');
  });

  it('terminates the process tree represented by the owned child handle', async () => {
    const cwd = await temporaryDirectory('repoctopus-process-tree-');
    cleanup.push(cwd);
    const child = spawnCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd });
    expect(child.pid).toBeTypeOf('number');
    await terminateProcessTree(child);
    await once(child, 'close');
    expect(child.exitCode ?? child.signalCode).not.toBeNull();
  });

  it('times out a command and records the failed attempt', async () => {
    const cwd = await temporaryDirectory('repoctopus-process-timeout-');
    cleanup.push(cwd);
    const result = await new LocalCommandAdapter().run({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd,
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});
