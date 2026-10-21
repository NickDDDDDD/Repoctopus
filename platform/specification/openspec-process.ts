import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
