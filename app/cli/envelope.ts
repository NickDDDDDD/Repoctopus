import type { RuntimeDiagnostic } from '../../domains/runtime/types.js';

export interface CliEnvelope<T> {
  protocolVersion: 1;
  ok: boolean;
  command: string;
  runId: string | null;
  result: T | null;
  diagnostics: RuntimeDiagnostic[];
  nextActions: string[];
}

export function successEnvelope<T>(options: {
  command: string;
  result: T;
  runId?: string | null;
  diagnostics?: RuntimeDiagnostic[];
  nextActions?: string[];
}): CliEnvelope<T> {
  return {
    protocolVersion: 1,
    ok: true,
    command: options.command,
    runId: options.runId ?? null,
    result: options.result,
    diagnostics: options.diagnostics ?? [],
    nextActions: options.nextActions ?? [],
  };
}

export function failureEnvelope(command: string, error: unknown): CliEnvelope<never> {
  return {
    protocolVersion: 1,
    ok: false,
    command,
    runId: null,
    result: null,
    diagnostics: [
      {
        level: 'error',
        code: 'cli.command-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    nextActions: [],
  };
}
