import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  DESKTOP_ACTIVATION_ARGUMENT,
  DESKTOP_ACTIVATION_CONTRACT,
  type DesktopActivationRequest,
  type DesktopRunContext,
} from '../../app/desktop/shared/activation-protocol.js';
import type { DesktopActivationResult } from '../../services/desktop-runtime.js';
import {
  desktopActivationPaths,
  readDesktopActivationResponse,
  removeDesktopActivationFiles,
  writeDesktopActivationRequest,
} from './activation-files.js';

interface DesktopCommand {
  executable: string;
  args: string[];
}

export interface WindowsDesktopLauncherOptions {
  productRoot: string;
  workspaceRoot: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  pollIntervalMs?: number;
  spawnProcess?: typeof spawn;
}

function unavailable(diagnostic: string): DesktopActivationResult {
  return { status: 'unavailable', diagnostic };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function requestId(context: DesktopRunContext): string {
  return createHash('sha256')
    .update(`${context.workspaceId}\0${context.changeId ?? ''}\0${context.runId}\0${randomUUID()}`)
    .digest('hex');
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class WindowsDesktopLauncher {
  private readonly environment: NodeJS.ProcessEnv;

  constructor(private readonly options: WindowsDesktopLauncherOptions) {
    this.environment = options.environment ?? process.env;
  }

  async activate(context: DesktopRunContext): Promise<DesktopActivationResult> {
    if ((this.options.platform ?? process.platform) !== 'win32') {
      return unavailable('desktop-platform-unsupported');
    }
    const command = await this.command();
    if (!command) return unavailable('desktop-application-unavailable');

    const id = requestId(context);
    const files = desktopActivationPaths(id);
    const request: DesktopActivationRequest = {
      apiVersion: DESKTOP_ACTIVATION_CONTRACT,
      requestId: id,
      context,
    };
    try {
      await writeDesktopActivationRequest(files.request, request);
      const activationArgument = `${DESKTOP_ACTIVATION_ARGUMENT}${files.request}`;
      const child = (this.options.spawnProcess ?? spawn)(
        command.executable,
        [...command.args, activationArgument],
        {
          cwd: this.options.productRoot,
          env: this.environment,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      child.unref();
      const response = await this.waitForResponse(files.response, child);
      return response?.requestId === id
        ? { status: 'ready', shellPid: response.shellPid, receiver: response.receiver }
        : unavailable('desktop-activation-timeout');
    } catch {
      return unavailable('desktop-activation-failed');
    } finally {
      await removeDesktopActivationFiles(id).catch(() => undefined);
    }
  }

  private async command(): Promise<DesktopCommand | null> {
    const configured = this.environment.REPOCTOPUS_DESKTOP_EXECUTABLE;
    if (configured) {
      const executable = path.resolve(configured);
      return (await exists(executable)) ? { executable, args: [] } : null;
    }
    if (path.resolve(this.options.productRoot) !== path.resolve(this.options.workspaceRoot)) {
      return null;
    }
    const entry = path.join(this.options.productRoot, 'dist', 'desktop', 'main.js');
    if (!(await exists(entry))) return null;
    try {
      const require = createRequire(path.join(this.options.productRoot, 'package.json'));
      const executable = require('electron') as unknown;
      return typeof executable === 'string' && path.isAbsolute(executable)
        ? { executable, args: [entry] }
        : null;
    } catch {
      return null;
    }
  }

  private async waitForResponse(
    responseFile: string,
    child: Pick<ChildProcess, 'once'>,
  ): Promise<Awaited<ReturnType<typeof readDesktopActivationResponse>>> {
    let failed = false;
    child.once('error', () => {
      failed = true;
    });
    const deadline = Date.now() + (this.options.timeoutMs ?? 15_000);
    while (!failed && Date.now() < deadline) {
      const response = await readDesktopActivationResponse(responseFile);
      if (response) return response;
      await wait(this.options.pollIntervalMs ?? 50);
    }
    return null;
  }
}
