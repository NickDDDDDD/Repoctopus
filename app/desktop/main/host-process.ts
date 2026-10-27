import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import type { DesktopApplicationSnapshot } from '../../../services/desktop-application.js';
import type {
  ChangeProjectionDelta,
  ChangeProjectionSnapshot,
} from '../../../domains/telemetry/change-projection.js';
import { isDesktopHostEvent } from '../shared/host-protocol.js';
import { desktopNodeEnvironment } from './node-environment.js';

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024;
const READY_TIMEOUT_MS = 15_000;
const GRACEFUL_STOP_MS = 10_000;
const TERMINATION_STOP_MS = 5_000;

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

async function readyWithin<T>(ready: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Repoctopus Desktop Host did not become ready within ${milliseconds}ms`));
    }, milliseconds);
    timer.unref();
  });
  try {
    return await Promise.race([ready, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface DesktopHostReady {
  snapshot: DesktopApplicationSnapshot;
  receiver: { schemaVersion: 1; endpoint: string; sessionToken: string };
  projection: ChangeProjectionSnapshot;
}

export interface DesktopHostProcessOptions {
  executable: string;
  entry: string;
  productRoot: string;
  environment?: NodeJS.ProcessEnv;
  onReady?: (ready: DesktopHostReady) => void;
  onProjection?: (snapshot: ChangeProjectionSnapshot, delta: ChangeProjectionDelta) => void;
  onFailure?: (error: Error) => void;
  readyTimeoutMs?: number;
  stopTimeouts?: Readonly<{ gracefulMs: number; terminationMs: number }>;
  spawnProcess?: (command: string, arguments_: string[], options: SpawnOptions) => ChildProcess;
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
  private starting: Promise<DesktopHostReady> | undefined;
  private stoppingPromise: Promise<void> | undefined;
  private stderr = '';
  private failureReported = false;
  private stopping = false;
  private shutdownCompleted = false;
  private childExited = false;

  constructor(private readonly options: DesktopHostProcessOptions) {}

  get processId(): number | null {
    return this.child?.pid ?? null;
  }

  start(): Promise<DesktopHostReady> {
    if (this.starting !== undefined) return this.starting;
    const starting = this.startOnce();
    this.starting = starting;
    return starting;
  }

  private async startOnce(): Promise<DesktopHostReady> {
    const spawnProcess =
      this.options.spawnProcess ??
      ((command: string, arguments_: string[], options: SpawnOptions) =>
        spawn(command, arguments_, options));
    const child = spawnProcess(
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
        const ready = {
          snapshot: message.snapshot,
          receiver: message.receiver,
          projection: message.projection,
        };
        try {
          this.options.onReady?.(ready);
          this.readyResolve(ready);
        } catch (error) {
          this.fail(
            error instanceof Error ? error : new Error('Desktop Host ready listener failed'),
          );
          child.kill('SIGTERM');
        }
      } else if (message.type === 'projection-updated') {
        try {
          this.options.onProjection?.(message.snapshot, message.delta);
        } catch (error) {
          this.fail(
            error instanceof Error ? error : new Error('Desktop Host projection listener failed'),
          );
          child.kill('SIGTERM');
        }
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
        this.childExited = true;
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
    try {
      return await readyWithin(this.readyPromise, this.options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error('Repoctopus Desktop Host failed to start');
      this.fail(failure);
      try {
        await this.stop();
      } catch (stopError) {
        throw new AggregateError([failure, stopError], 'Desktop Host startup cleanup failed', {
          cause: stopError,
        });
      }
      throw failure;
    }
  }

  stop(): Promise<void> {
    if (this.stoppingPromise !== undefined) return this.stoppingPromise;
    const stopping = this.stopOnce();
    this.stoppingPromise = stopping;
    return stopping;
  }

  private async stopOnce(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    this.stopping = true;
    if (!this.childExited) {
      this.readyReject(new Error('Repoctopus Desktop Host stopped before becoming ready'));
    }
    const requestedShutdown = !this.childExited && child.connected;
    if (requestedShutdown) {
      child.send({ type: 'shutdown' }, (error) => {
        if (error !== null) this.fail(error);
      });
    }
    const exited = this.exitPromise ?? Promise.resolve();
    const gracefulMs = this.options.stopTimeouts?.gracefulMs ?? GRACEFUL_STOP_MS;
    const terminationMs = this.options.stopTimeouts?.terminationMs ?? TERMINATION_STOP_MS;
    const graceful = await exitsWithin(exited, gracefulMs);
    if (!graceful) child.kill('SIGTERM');
    if (!(await exitsWithin(exited, terminationMs))) {
      child.kill('SIGKILL');
      if (!(await exitsWithin(exited, terminationMs))) {
        throw new Error('Repoctopus Desktop Host did not exit after SIGKILL');
      }
    }
    this.child = undefined;
    if (requestedShutdown && graceful && !this.shutdownCompleted) {
      throw new Error('Repoctopus Desktop Host exited without acknowledging shutdown');
    }
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
