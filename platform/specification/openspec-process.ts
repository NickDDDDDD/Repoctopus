import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface SpecificationProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  failureKind?: 'aborted' | 'timeout' | 'output-limit' | 'non-zero-exit' | 'spawn-error';
}

export interface SpecificationProcessPort {
  execute(
    args: readonly string[],
    options: { cwd: string; signal?: AbortSignal },
  ): Promise<SpecificationProcessResult>;
}

const require = createRequire(import.meta.url);

function installedOpenSpecRoot(): string {
  const entry = require.resolve('@fission-ai/openspec');
  return path.dirname(path.dirname(entry));
}

export function installedOpenSpecEntry(): string {
  return path.join(installedOpenSpecRoot(), 'bin', 'openspec.js');
}

export function installedOpenSpecVersion(): string {
  const manifestFile = path.join(installedOpenSpecRoot(), 'package.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('Installed OpenSpec package has no valid version');
  }
  return manifest.version;
}

export class OpenSpecProcess implements SpecificationProcessPort {
  constructor(
    private readonly entry = installedOpenSpecEntry(),
    private readonly timeoutMs = 60_000,
    private readonly maxBufferBytes = 16 * 1024 * 1024,
    private readonly environment: NodeJS.ProcessEnv = {},
  ) {}

  execute(
    args: readonly string[],
    options: { cwd: string; signal?: AbortSignal },
  ): Promise<SpecificationProcessResult> {
    return new Promise((resolve) => {
      const child = execFile(
        process.execPath,
        [this.entry, ...args],
        {
          cwd: path.resolve(options.cwd),
          encoding: 'utf8',
          maxBuffer: this.maxBufferBytes,
          timeout: this.timeoutMs,
          windowsHide: true,
          env: { ...process.env, ...this.environment },
          signal: options.signal,
        },
        (error, stdout, stderr) => {
          const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
          if (!error) {
            resolve({ exitCode, stdout, stderr });
            return;
          }
          const code = (error as NodeJS.ErrnoException).code;
          const killed = 'killed' in error && error.killed === true;
          const failureKind =
            code === 'ABORT_ERR'
              ? 'aborted'
              : code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                ? 'output-limit'
                : killed
                  ? 'timeout'
                  : typeof error.code === 'number'
                    ? 'non-zero-exit'
                    : 'spawn-error';
          resolve({ exitCode, stdout, stderr, failureKind });
        },
      );
      child.stdin?.end();
    });
  }
}
