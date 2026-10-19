export interface CommandRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error?: string;
  pid?: number;
  processIdentity?: string;
}

export interface CommandAdapter {
  run(request: CommandRequest): Promise<CommandResult>;
}
