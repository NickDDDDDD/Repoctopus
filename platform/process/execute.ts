import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export async function execute(
  executable: string,
  args: readonly string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): Promise<ProcessResult> {
  try {
    const result = await execFileAsync(executable, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (options.allowFailure && error && typeof error === 'object') {
      const detail = error as { stdout?: string; stderr?: string };
      return { stdout: detail.stdout ?? '', stderr: detail.stderr ?? '' };
    }
    throw error;
  }
}
