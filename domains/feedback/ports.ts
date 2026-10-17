export interface CommandRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
  pid?: number;
  processIdentity?: string;
}

export interface CommandAdapter {
  run(request: CommandRequest): Promise<CommandResult>;
}
