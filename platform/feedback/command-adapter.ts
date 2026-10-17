import type {
  CommandAdapter,
  CommandRequest,
  CommandResult,
} from '../../domains/feedback/ports.js';
import { readProcessIdentity } from '../process/process-identity.js';
import { spawnCommand } from '../process/spawn-command.js';
import { terminateProcessTree } from '../process/terminate-process-tree.js';

export class LocalCommandAdapter implements CommandAdapter {
  async run(request: CommandRequest): Promise<CommandResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
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
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateProcessTree(child).catch(() => child.kill('SIGKILL'));
      }, request.timeoutMs);
      timer.unref();

      const finish = (result: Omit<CommandResult, 'pid' | 'processIdentity'>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void identity.then((processIdentity) => {
          resolve({
            ...result,
            ...(pid !== undefined ? { pid } : {}),
            ...(processIdentity ? { processIdentity } : {}),
          });
        });
      };
      child.on('error', (error) => {
        finish({ exitCode: null, stdout, stderr, timedOut, error: error.message });
      });
      child.on('close', (exitCode) => {
        finish({ exitCode, stdout, stderr, timedOut });
      });
    });
  }
}
