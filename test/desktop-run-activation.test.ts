import { describe, expect, it, vi } from 'vitest';

import type { DesktopLauncher } from '../domains/desktop/launcher.js';
import { DesktopRunActivation } from '../services/desktop-run-activation.js';

const context = {
  schemaVersion: 1 as const,
  workspaceId: 'team-platform',
  changeId: 'add-windows-desktop-dashboard',
  runId: 'change-add-windows-desktop-dashboard-1234',
};

describe('DesktopRunActivation', () => {
  it('wakes desktop replay only after the Shell was started or activated', async () => {
    const launcher: DesktopLauncher = {
      activate: vi.fn(() => Promise.resolve({ status: 'started-or-activated' as const })),
    };
    const wakeReplay = vi.fn(() => Promise.resolve());

    const result = await new DesktopRunActivation(launcher, wakeReplay).beforeRun(context);

    expect(result).toEqual({ status: 'ready', diagnostics: [] });
    expect(launcher.activate).toHaveBeenCalledWith(context);
    expect(wakeReplay).toHaveBeenCalledWith(context);
    expect(vi.mocked(launcher.activate).mock.invocationCallOrder[0]).toBeLessThan(
      wakeReplay.mock.invocationCallOrder[0]!,
    );
  });

  it('turns launch and replay failures into bounded warnings instead of failing the Run', async () => {
    const launchFailure = new DesktopRunActivation(
      {
        activate: () => Promise.reject(new Error(`could not spawn\n${'x'.repeat(1_000)}`)),
      },
      () => Promise.resolve(),
    );

    const failedLaunch = await launchFailure.beforeRun(context);
    expect(failedLaunch.status).toBe('warning');
    expect(failedLaunch.diagnostics).toHaveLength(1);
    expect(failedLaunch.diagnostics[0]).toMatchObject({
      level: 'warning',
      code: 'desktop.launch-failed',
    });
    expect(failedLaunch.diagnostics[0]!.message.length).toBeLessThanOrEqual(320);
    expect(failedLaunch.diagnostics[0]!.message).not.toContain('\n');

    const replayFailure = new DesktopRunActivation(
      { activate: () => Promise.resolve({ status: 'started-or-activated' }) },
      () => Promise.reject(new Error('receiver is not ready')),
    );
    await expect(replayFailure.beforeRun(context)).resolves.toMatchObject({
      status: 'warning',
      diagnostics: [{ code: 'desktop.replay-wake-failed' }],
    });
  });

  it('reports unsupported platforms without attempting desktop replay', async () => {
    const wakeReplay = vi.fn(() => Promise.resolve());
    const activation = new DesktopRunActivation(
      { activate: () => Promise.resolve({ status: 'unsupported', platform: 'linux' }) },
      wakeReplay,
    );

    await expect(activation.beforeRun(context)).resolves.toMatchObject({
      status: 'unsupported',
      diagnostics: [{ code: 'desktop.platform-unsupported' }],
    });
    expect(wakeReplay).not.toHaveBeenCalled();
  });
});
