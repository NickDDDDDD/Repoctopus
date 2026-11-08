import { execute, type ProcessResult } from '../process/execute.js';

/** Process-local policy for Runtime-owned Archive Git operations only. */
export function executeArchiveGit(cwd: string, args: readonly string[]): Promise<ProcessResult> {
  const commandArgs = process.platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args;
  return execute('git', commandArgs, { cwd });
}
