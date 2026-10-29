import { EventEmitter } from 'node:events';
import path from 'node:path';

import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopLauncher,
  type DesktopProcessAdapter,
} from '../services/desktop-launcher.js';

const launchContext = {
  schemaVersion: 1 as const,
  workspaceId: 'team-platform',
  changeId: 'desktop-dashboard',
  runId: 'run-desktop-dashboard',
};

class FakeChild extends EventEmitter {
  readonly unref = vi.fn();
  readonly kill = vi.fn(() => true);
}

interface LauncherHarnessOptions {
  environment?: NodeJS.ProcessEnv;
  existingInstance?: boolean;
  existingPaths?: readonly string[];
  protocolHandlerAvailable?: boolean;
  process?: DesktopProcessAdapter;
  launchDeadlineMs?: number;
}

function harness(options: LauncherHarnessOptions = {}) {
  const context = new Context();
  const productRoot = path.resolve('C:\\repoctopus-product');
  const process = options.process ?? vi.fn();
  const existingPaths = new Set(options.existingPaths ?? []);
  const launcher = new DesktopLauncher(context, {
    productRoot,
    environment: options.environment ?? {},
    platform: 'win32',
    process,
    pathExists: (candidate) =>
      Promise.resolve(existingPaths.has(path.relative(productRoot, candidate))),
    probeExistingInstance: () => Promise.resolve(options.existingInstance ?? false),
    protocolHandlerAvailable: () =>
      Promise.resolve(options.protocolHandlerAvailable ?? true),
    launchDeadlineMs: options.launchDeadlineMs ?? 50,
  });
  return { context, launcher, process, productRoot };
}

afterEach(() => vi.useRealTimers());

describe('DesktopLauncher', () => {
  it.each([
    {
      name: 'explicit override',
      options: { environment: { REPOCTOPUS_DESKTOP_EXECUTABLE: 'C:\\ops\\desktop.exe' } },
      expectedKind: 'override',
      expectedExecutable: 'C:\\ops\\desktop.exe',
    },
    {
      name: 'Product Root source artifacts',
      options: {
        existingPaths: [
          path.join('node_modules', 'electron', 'dist', 'electron.exe'),
          path.join('dist', 'desktop', 'main.js'),
        ],
      },
      expectedKind: 'source',
      expectedExecutable: path.join(
        path.resolve('C:\\repoctopus-product'),
        'node_modules',
        'electron',
        'dist',
        'electron.exe',
      ),
    },
    {
      name: 'installed protocol',
      options: {},
      expectedKind: 'installed-protocol',
      expectedExecutable: 'explorer.exe',
    },
  ])('uses the fixed target priority for $name', async ({ options, expectedKind, expectedExecutable }) => {
    const child = new FakeChild();
    const process = vi.fn<DesktopProcessAdapter>(() => child);
    const instance = harness({ ...options, process });
    const activation = instance.launcher.activate(launchContext);
    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
    child.emit('spawn');

    await expect(activation).resolves.toEqual({
      status: 'started',
      targetKind: expectedKind,
      reason: 'new-instance',
    });
    expect(process).toHaveBeenCalledOnce();
    expect(process.mock.calls[0]?.[0]).toBe(expectedExecutable);
    expect(process.mock.calls[0]?.[1]).toEqual(expect.any(Array));
    await instance.context.fiber.dispose();
  });

  it('returns a bounded missing-artifact result instead of leaking Product Root paths', async () => {
    const instance = harness({
      existingPaths: [path.join('node_modules', 'electron', 'dist', 'electron.exe')],
    });
    await expect(instance.launcher.activate(launchContext)).resolves.toEqual({
      status: 'unavailable',
      targetKind: 'source',
      reason: 'development-artifact-missing',
    });
    expect(instance.process).not.toHaveBeenCalled();
    await instance.context.fiber.dispose();
  });

  it('returns protocol-handler-unavailable before attempting an installed launch', async () => {
    const instance = harness({ protocolHandlerAvailable: false });
    await expect(instance.launcher.activate(launchContext)).resolves.toEqual({
      status: 'unavailable',
      targetKind: 'installed-protocol',
      reason: 'protocol-handler-unavailable',
    });
    expect(instance.process).not.toHaveBeenCalled();
    await instance.context.fiber.dispose();
  });

  it('reports activated only when secure discovery found an existing instance', async () => {
    const child = new FakeChild();
    const process = vi.fn(() => child);
    const instance = harness({
      existingInstance: true,
      process: process as unknown as DesktopProcessAdapter,
    });
    const activation = instance.launcher.activate(launchContext);
    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
    child.emit('spawn');
    await expect(activation).resolves.toEqual({
      status: 'activated',
      targetKind: 'installed-protocol',
      reason: 'existing-instance',
    });
    await instance.context.fiber.dispose();
  });

  it('maps synchronous throws and asynchronous errors exactly once', async () => {
    const thrown = harness({
      process: (() => {
        throw new Error('private executable path');
      }),
    });
    await expect(thrown.launcher.activate(launchContext)).resolves.toEqual({
      status: 'unavailable',
      targetKind: 'installed-protocol',
      reason: 'launch-rejected',
    });
    await thrown.context.fiber.dispose();

    const child = new FakeChild();
    const process = vi.fn(() => child);
    const rejected = harness({ process: process as unknown as DesktopProcessAdapter });
    const activation = rejected.launcher.activate(launchContext);
    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
    child.emit('error', new Error('private executable path'));
    child.emit('error', new Error('second error remains handled'));
    await expect(activation).resolves.toEqual({
      status: 'unavailable',
      targetKind: 'installed-protocol',
      reason: 'launch-rejected',
    });
    await rejected.context.fiber.dispose();
  });

  it('bounds launch acknowledgement and terminates an unacknowledged child', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const process = vi.fn(() => child);
    const instance = harness({
      process: process as unknown as DesktopProcessAdapter,
      launchDeadlineMs: 10,
    });
    const activation = instance.launcher.activate(launchContext);
    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(11);
    await expect(activation).resolves.toEqual({
      status: 'unavailable',
      targetKind: 'installed-protocol',
      reason: 'launch-timeout',
    });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.unref).not.toHaveBeenCalled();
    await instance.context.fiber.dispose();
  });

  it('does not attempt Desktop activation outside the supported platform', async () => {
    const context = new Context();
    const process = vi.fn() as unknown as DesktopProcessAdapter;
    const launcher = new DesktopLauncher(context, {
      productRoot: path.resolve('C:\\repoctopus-product'),
      platform: 'linux',
      process,
    });
    await expect(launcher.activate(launchContext)).resolves.toEqual({
      status: 'unsupported',
      targetKind: 'none',
      reason: 'platform-unsupported',
    });
    expect(process).not.toHaveBeenCalled();
    await context.fiber.dispose();
  });
});
