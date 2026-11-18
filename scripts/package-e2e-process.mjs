import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';

export async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    return;
  }
  await new Promise((resolve, reject) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', reject);
    killer.once('exit', (code) => {
      if (code !== 0 && child.exitCode === null && child.signalCode === null) {
        reject(new Error('Unable to terminate acceptance process tree'));
      } else resolve();
    });
  });
}

export function runProcess(file, args, options = {}) {
  const { timeout = 120_000, onOutput, onSpawn, label = 'Acceptance', ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...spawnOptions,
    });
    onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let termination;
    const timer = setTimeout(() => {
      timedOut = true;
      termination = stopProcessTree(child);
      void termination.catch(reject);
    }, timeout);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      onOutput?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      onOutput?.(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', async (code) => {
      clearTimeout(timer);
      try {
        await termination;
      } catch (error) {
        reject(error);
        return;
      }
      if (timedOut) reject(new Error(label + ' command timed out'));
      else if (code !== 0)
        reject(new Error(label + ' exited ' + code + '\n' + stderr.slice(-8_000)));
      else resolve(stdout);
    });
  });
}
