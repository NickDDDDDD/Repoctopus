import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, Serializable } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { DesktopHostProcess } from '../app/desktop/main/host-process.js';

class FakeHostChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4_242;
  connected = true;
  readonly sent: Serializable[] = [];
  readonly signals: NodeJS.Signals[] = [];

  send(message: Serializable, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    return true;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (signal === 'SIGKILL') {
      this.connected = false;
      queueMicrotask(() => this.emit('close', null, signal));
    }
    return true;
  }
}

const ready = {
  type: 'ready' as const,
  snapshot: { apiVersion: 'repoctopus.desktop/v1alpha1' as const, phase: 'ready' as const },
  receiver: {
    schemaVersion: 1 as const,
    endpoint: 'http://127.0.0.1:4318',
    sessionToken: 'a'.repeat(32),
  },
  projection: {
    schemaVersion: 1 as const,
    version: 0,
    activeChange: null,
    changes: [],
    freshness: { observedAt: null, status: 'empty' as const },
  },
};

describe('DesktopHostProcess', () => {
  it('keeps the packaged ASAR root as input while spawning from its containing directory', async () => {
    const child = new FakeHostChild();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess);
    const host = new DesktopHostProcess({
      executable: 'Repoctopus.exe',
      entry: 'resources\\app.asar.unpacked\\dist\\desktop\\host.mjs',
      productRoot: 'C:\\Repoctopus\\resources\\app.asar',
      workingDirectory: 'C:\\Repoctopus\\resources',
      spawnProcess,
    });

    const starting = host.start();

    expect(spawnProcess).toHaveBeenCalledWith(
      'Repoctopus.exe',
      [
        'resources\\app.asar.unpacked\\dist\\desktop\\host.mjs',
        'C:\\Repoctopus\\resources\\app.asar',
      ],
      expect.objectContaining({ cwd: 'C:\\Repoctopus\\resources' }),
    );
    child.emit('message', ready);
    await starting;
    child.connected = false;
    child.emit('close', 0, null);
  });

  it('bounds readiness and escalates shutdown without leaving a Host alive', async () => {
    const child = new FakeHostChild();
    const host = new DesktopHostProcess({
      executable: 'electron.exe',
      entry: 'host.mjs',
      productRoot: 'C:\\product',
      readyTimeoutMs: 5,
      stopTimeouts: { gracefulMs: 5, terminationMs: 5 },
      spawnProcess: vi.fn(() => child as unknown as ChildProcess),
    });

    const starting = host.start();
    expect(host.processId).toBe(4_242);
    await expect(starting).rejects.toThrow('did not become ready');

    expect(child.sent).toContainEqual({ type: 'shutdown' });
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(host.processId).toBeNull();
  });

  it('acknowledges graceful shutdown without sending a termination signal', async () => {
    const child = new FakeHostChild();
    child.send = vi.fn((message: Serializable, callback?: (error: Error | null) => void) => {
      child.sent.push(message);
      callback?.(null);
      if ((message as { type?: string }).type === 'shutdown') {
        queueMicrotask(() => {
          child.emit('message', { type: 'shutdown-complete' });
          child.emit('close', 0, null);
        });
      }
      return true;
    });
    const host = new DesktopHostProcess({
      executable: 'electron.exe',
      entry: 'host.mjs',
      productRoot: 'C:\\product',
      readyTimeoutMs: 50,
      stopTimeouts: { gracefulMs: 50, terminationMs: 5 },
      spawnProcess: () => child as unknown as ChildProcess,
    });

    const starting = host.start();
    child.emit('message', ready);
    await expect(starting).resolves.toEqual({
      snapshot: ready.snapshot,
      receiver: ready.receiver,
      projection: ready.projection,
    });
    await host.stop();

    expect(child.sent).toContainEqual({ type: 'shutdown' });
    expect(child.signals).toEqual([]);
    expect(host.processId).toBeNull();
  });
});
