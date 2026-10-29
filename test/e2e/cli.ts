import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CliResult<T = unknown> {
  protocolVersion: number;
  ok: boolean;
  command: string;
  runId: string | null;
  result: T | null;
  diagnostics: Array<{ level: string; code: string; message: string }>;
  nextActions: string[];
}

export async function runCli<T = unknown>(options: {
  packageRoot: string;
  args: string[];
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  realDesktop?: boolean;
}): Promise<CliResult<T>> {
  const entry = path.join(options.packageRoot, 'bin', 'repoctopus.js');
  const hasExplicitDesktopTarget = Object.prototype.hasOwnProperty.call(
    options.environment ?? {},
    'REPOCTOPUS_DESKTOP_EXECUTABLE',
  );
  const environment = {
    ...process.env,
    ...options.environment,
    ...(options.realDesktop || hasExplicitDesktopTarget
      ? {}
      : { REPOCTOPUS_DESKTOP_EXECUTABLE: process.execPath }),
  };
  const result = await execFileAsync(process.execPath, [entry, ...options.args, '--json'], {
    cwd: options.cwd,
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(result.stdout) as CliResult<T>;
}
