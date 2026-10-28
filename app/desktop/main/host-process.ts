import { spawn, type ChildProcess } from 'node:child_process';

import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';
import type { DesktopLaunchContext } from '../shared/launch-context.js';
import { DESKTOP_HOST_PROTOCOL_VERSION, isDesktopHostEvent } from '../shared/host-protocol.js';
import type {
  ChangeProjectionDelta,
  ChangeProjectionSnapshot,
} from '../../../domains/trajectory/projection.js';
import type { DesktopReceiverConnection } from '../../../services/desktop-receiver.js';
import { desktopNodeEnvironment } from './node-environment.js';

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024;
const GRACEFUL_STOP_MS = 10_000;
const TERMINATION_STOP_MS = 5_000;
const READY_DEADLINE_MS = 15_000;

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, milliseconds);
    timer.unref();
  });
  try {
    return await Promise.race([exit.then(() => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface DesktopHostReady {
  snapshot: DesktopApplicationSnapshot;
  receiver: DesktopReceiverConnection;
  projection: ChangeProjectionSnapshot;
}

export interface DesktopHostProjectionUpdate {
  snapshot: ChangeProjectionSnapshot;
  delta: ChangeProjectionDelta;
}

export interface DesktopHostProcessOptions {
  executable: string;
  entry: string;
  productRoot: string;
  environment?: NodeJS.ProcessEnv;
  onReady?: (ready: DesktopHostReady) => void;
  onSnapshot?: (ready: DesktopHostReady) => void;
  onProjection?: (update: DesktopHostProjectionUpdate) => void;
  onFailure?: (error: Error) => void;
  readyDeadlineMs?: number;
  spawnChild?: typeof spawn;
}

/** One Cordis Desktop Host running under the Electron executable in Node mode. */
export class DesktopHostProcess {
  private child: ChildProcess | undefined;
  private readyResolve!: (ready: DesktopHostReady) => void;
  private readyReject!: (error: Error) => void;
  private readonly readyPromise = new Promise<DesktopHostReady>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });
  private exitPromise: Promise<void> | undefined;
  private stderr = '';
  private failureReported = false;
  private stopping = false;
  private shutdownCompleted = false;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private readyState: DesktopHostReady | undefined;

  constructor(private readonly options: DesktopHostProcessOptions) {}

  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise;
    const child = (this.options.spawnChild ?? spawn)(
      this.options.executable,
      [this.options.entry, this.options.productRoot],
      {
        cwd: this.options.productRoot,
        env: desktopNodeEnvironment(this.options.environment),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      },
    );
    this.child = child;
    this.readyTimer = setTimeout(() => {
      this.fail(new Error('Repoctopus Desktop Host readiness deadline exceeded'));
      child.kill('SIGTERM');
    }, this.options.readyDeadlineMs ?? READY_DEADLINE_MS);
    this.readyTimer.unref();
    child.stdout?.pipe(process.stdout);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS);
    });
    child.on('message', (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error('Repoctopus Desktop Host sent an invalid IPC event'));
        child.kill('SIGTERM');
        return;
      }
      if (message.type === 'ready') {
        this.clearReadyTimer();
        const ready = {
          snapshot: message.snapshot,
          receiver: message.receiver,
          projection: message.projection,
        };
        this.readyState = ready;
        try {
          this.options.onReady?.(ready);
          this.readyResolve(ready);
        } catch (error) {
          this.fail(
            error instanceof Error ? error : new Error('Desktop Host ready listener failed'),
          );
          child.kill('SIGTERM');
        }
      } else if (message.type === 'snapshot-updated') {
        if (this.readyState !== undefined) {
          this.readyState = { ...this.readyState, snapshot: message.snapshot };
          this.options.onSnapshot?.(this.readyState);
        }
      } else if (message.type === 'projection-updated') {
        if (this.readyState !== undefined) {
          this.readyState = { ...this.readyState, projection: message.snapshot };
        }
        this.options.onProjection?.({ snapshot: message.snapshot, delta: message.delta });
      } else if (message.type === 'fatal') {
        this.fail(new Error(message.message));
      } else if (this.stopping) {
        this.shutdownCompleted = true;
      } else {
        this.fail(new Error('Repoctopus Desktop Host acknowledged an unrequested shutdown'));
      }
    });
    child.once('error', (error) => {
      this.fail(error);
    });
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('close', (code, signal) => {
        this.clearReadyTimer();
        const diagnostic = this.stderr.trim();
        const suffix = diagnostic.length === 0 ? '' : `: ${diagnostic}`;
        if (!this.stopping) {
          this.fail(
            new Error(
              `Repoctopus Desktop Host stopped (code ${String(code)}, signal ${String(signal)})${suffix}`,
            ),
          );
        }
        resolve();
      });
    });
    return this.readyPromise;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.stopping = true;
    this.clearReadyTimer();
    if (child.connected) {
      child.send({ protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, type: 'shutdown' }, (error) => {
        if (error !== null) this.fail(error);
      });
    }
    const exited = this.exitPromise ?? Promise.resolve();
    const graceful = await exitsWithin(exited, GRACEFUL_STOP_MS);
    if (!graceful) child.kill('SIGTERM');
    if (!(await exitsWithin(exited, TERMINATION_STOP_MS))) {
      child.kill('SIGKILL');
      if (!(await exitsWithin(exited, TERMINATION_STOP_MS))) {
        throw new Error('Repoctopus Desktop Host did not exit after SIGKILL');
      }
    }
    this.child = undefined;
    this.readyState = undefined;
    if (graceful && !this.shutdownCompleted) {
      throw new Error('Repoctopus Desktop Host exited without acknowledging shutdown');
    }
  }

  activate(context: DesktopLaunchContext): void {
    const child = this.child;
    if (child?.connected) {
      child.send({
        protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
        type: 'activate-context',
        context,
      });
    }
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
  }

  private fail(error: Error): void {
    this.readyReject(error);
    if (!this.failureReported && !this.stopping) {
      this.failureReported = true;
      try {
        this.options.onFailure?.(error);
      } catch (listenerError) {
        console.error('desktop host failure listener failed', listenerError);
      }
    }
  }
}
