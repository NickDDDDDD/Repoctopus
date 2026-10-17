import type {
  CommandAdapter,
  CommandRequest,
  CommandResult,
} from '../../domains/feedback/ports.js';
import { readProcessIdentity } from '../process/process-identity.js';
import { spawnCommand } from '../process/spawn-command.js';
import { terminateProcessTree } from '../process/terminate-process-tree.js';
import { BoundedTextCapture } from './bounded-text-capture.js';

export const DEFAULT_COMMAND_OUTPUT_BYTES = 20 * 1024 * 1024;

export class LocalCommandAdapter implements CommandAdapter {
  async run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve) => {
      const stdout = new BoundedTextCapture(request.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES);
      const stderr = new BoundedTextCapture(request.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_BYTES);
      let settled = false;
      let timedOut = false;
      const child = spawnCommand(request.executable, request.args, {
        cwd: request.cwd,
      });
      const pid = child.pid;
      const identity = pid === undefined ? Promise.resolve(null) : readProcessIdentity(pid);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout.append(chunk);
      });
      child.stderr.on('data', (chunk: string) => {
        stderr.append(chunk);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateProcessTree(child).catch(() => child.kill('SIGKILL'));
      }, request.timeoutMs);
      timer.unref();

      const finish = (result: Pick<CommandResult, 'exitCode' | 'timedOut' | 'error'>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void identity.then((processIdentity) => {
          const capturedStdout = stdout.finish();
          const capturedStderr = stderr.finish();
          resolve({
            ...result,
            stdout: capturedStdout.contents,
            stderr: capturedStderr.contents,
            stdoutBytes: capturedStdout.bytesSeen,
            stderrBytes: capturedStderr.bytesSeen,
            stdoutTruncated: capturedStdout.truncated,
            stderrTruncated: capturedStderr.truncated,
            ...(pid !== undefined ? { pid } : {}),
            ...(processIdentity ? { processIdentity } : {}),
          });
        });
      };
      child.on('error', (error) => {
        finish({ exitCode: null, timedOut, error: error.message });
      });
      child.on('close', (exitCode) => {
        finish({ exitCode, timedOut });
      });
    });
  }
}
