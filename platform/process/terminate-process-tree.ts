import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { inspectProcessOwnership } from './process-identity.js';

const WINDOWS_TASKKILL_ATTEMPT_MS = 1_000;
const WINDOWS_TASKKILL_ATTEMPTS = 2;
const POSIX_GROUP_EXIT_WAIT_MS = 1_000;
const POSIX_EXIT_POLL_MS = 20;

async function waitForPosixGroupExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + POSIX_GROUP_EXIT_WAIT_MS;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return true;
      if (code !== 'EPERM') return false;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POSIX_EXIT_POLL_MS));
  }
}

/** Best-effort compatibility wrapper. Callers needing proof use the confirmed variant. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  await terminateProcessTreeConfirmed(child);
}

/** Returns whether terminating the complete child process tree was confirmed. */
export async function terminateProcessTreeConfirmed(child: ChildProcess): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill('SIGKILL');
    return false;
  }
  if (process.platform === 'win32') {
    const exited = () => typeof child.exitCode === 'number' || child.signalCode !== null;
    // An exited child handle must not authorize killing a possibly reused raw PID.
    if (exited()) return false;
    const configuredSystemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    const systemRoot =
      configuredSystemRoot && path.win32.isAbsolute(configuredSystemRoot)
        ? path.win32.resolve(configuredSystemRoot)
        : 'C:\\Windows';
    const taskkill = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
    const runTaskkillAttempt = (): Promise<boolean> =>
      new Promise((resolve) => {
        let finished = false;
        let killer: ChildProcess | null = null;
        let fallbackTimer: NodeJS.Timeout | null = null;
        const finish = (confirmed: boolean, terminateKiller = false): void => {
          if (finished) return;
          finished = true;
          if (fallbackTimer) clearTimeout(fallbackTimer);
          if (terminateKiller) killer?.kill('SIGKILL');
          resolve(confirmed);
        };
        try {
          killer = spawn(taskkill, ['/pid', String(pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('error', () => finish(false));
          killer.once('close', (code) => finish(code === 0));
          fallbackTimer = setTimeout(() => finish(false, true), WINDOWS_TASKKILL_ATTEMPT_MS);
        } catch {
          finish(false);
        }
      });
    for (let attempt = 0; attempt < WINDOWS_TASKKILL_ATTEMPTS; attempt += 1) {
      if (exited()) return false;
      if (await runTaskkillAttempt()) {
        child.kill('SIGKILL');
        return true;
      }
    }
    child.kill('SIGKILL');
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    return false;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code !== 'ESRCH' &&
      !(process.platform === 'darwin' && code === 'EPERM' && (await waitForPosixGroupExit(pid)))
    ) {
      throw error;
    }
  }
  child.kill('SIGKILL');
  return true;
}

export type RecoveredTermination = 'terminated' | 'not_running' | 'identity_mismatch' | 'unknown';

async function taskkillProcessTree(pid: number): Promise<boolean> {
  const configuredSystemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const systemRoot =
    configuredSystemRoot && path.win32.isAbsolute(configuredSystemRoot)
      ? path.win32.resolve(configuredSystemRoot)
      : 'C:\\Windows';
  const taskkill = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
  return new Promise((resolve) => {
    let finished = false;
    let killer: ChildProcess | null = null;
    let timer: NodeJS.Timeout | null = null;
    const finish = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve(ok);
    };
    try {
      killer = spawn(taskkill, ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => finish(false));
      killer.once('close', (code) => finish(code === 0));
      timer = setTimeout(() => {
        killer?.kill('SIGKILL');
        finish(false);
      }, WINDOWS_TASKKILL_ATTEMPT_MS);
    } catch {
      finish(false);
    }
  });
}

/** Terminate a recovered process only after its creation identity still matches. */
export async function terminateRecoveredProcessTree(
  pid: number,
  expectedIdentity: string,
): Promise<RecoveredTermination> {
  const ownership = await inspectProcessOwnership(pid, expectedIdentity);
  if (ownership !== 'matched') return ownership;
  if (process.platform === 'win32') {
    for (let attempt = 0; attempt < WINDOWS_TASKKILL_ATTEMPTS; attempt += 1) {
      if (await taskkillProcessTree(pid)) return 'terminated';
      const after = await inspectProcessOwnership(pid, expectedIdentity);
      if (after === 'not_running') return 'terminated';
      if (after !== 'matched') return after;
    }
    return 'unknown';
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return 'unknown';
  }
  return (await waitForPosixGroupExit(pid)) ? 'terminated' : 'unknown';
}
