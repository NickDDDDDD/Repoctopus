import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface SpecificationProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SpecificationProcessPort {
  execute(
    args: readonly string[],
    options: { cwd: string; signal?: AbortSignal },
  ): Promise<SpecificationProcessResult>;
}

export function installedOpenSpecEntry(): string {
  const entry = fileURLToPath(import.meta.resolve('@fission-ai/openspec'));
  return path.join(path.dirname(path.dirname(entry)), 'bin', 'openspec.js');
}

export class OpenSpecProcess implements SpecificationProcessPort {
  constructor(
    private readonly entry = installedOpenSpecEntry(),
    private readonly timeoutMs = 60_000,
    private readonly maxBufferBytes = 16 * 1024 * 1024,
  ) {}

  execute(
    args: readonly string[],
    options: { cwd: string; signal?: AbortSignal },
  ): Promise<SpecificationProcessResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [this.entry, ...args],
        {
          cwd: path.resolve(options.cwd),
          encoding: 'utf8',
          maxBuffer: this.maxBufferBytes,
          timeout: this.timeoutMs,
          windowsHide: true,
          signal: options.signal,
        },
        (error, stdout, stderr) => {
          if (error && (error as NodeJS.ErrnoException).code === 'ABORT_ERR') {
            reject(error instanceof Error ? error : new Error('OpenSpec process aborted'));
            return;
          }
          const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
          resolve({ exitCode, stdout, stderr });
        },
      );
      child.stdin?.end();
    });
  }
}
