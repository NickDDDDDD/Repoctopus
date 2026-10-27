import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopLauncher } from '../domains/desktop/launcher.js';
import desktopRunContributor from '../plugins/desktop/desktop-run-contributor.js';
import { DesktopLocalDestination } from '../services/desktop-local-destination.js';
import { DesktopRuntimeActivation } from '../services/desktop-runtime-activation.js';

const launchContext = {
  schemaVersion: 1 as const,
  workspaceId: 'team-platform',
  changeId: 'desktop-composition',
  runId: 'change-desktop-composition-1234',
};

describe('desktop Runtime composition', () => {
  it('leaves a zero-desktop Context free of launch side effects', async () => {
    const context = new Context();
    await expect(
      context.serial('repoctopus/desktop-before-change-run', launchContext),
    ).resolves.toBeUndefined();
    await context.fiber.dispose();
  });

  it('routes activation and replay wake through injected Services and a disposable Contributor', async () => {
    const context = new Context();
    const activate = vi.fn(() => Promise.resolve({ status: 'started-or-activated' as const }));
    const launcher: DesktopLauncher = { activate };
    const destination = new DesktopLocalDestination(context);
    new DesktopRuntimeActivation(context, { enabled: true, launcher });
    const contributor = context.plugin(desktopRunContributor);
    await contributor;

    await expect(
      context.serial('repoctopus/desktop-before-change-run', launchContext),
    ).resolves.toEqual({ status: 'ready', diagnostics: [] });
    expect(activate).toHaveBeenCalledWith(launchContext);
    expect(destination.snapshot()).toMatchObject({
      wakeCount: 1,
      lastContext: launchContext,
    });

    await contributor.dispose();
    await expect(
      context.serial('repoctopus/desktop-before-change-run', launchContext),
    ).resolves.toBeUndefined();
    expect(destination.snapshot().wakeCount).toBe(1);
    await context.fiber.dispose();
  });

  it('keeps disabled desktop activation silent and dependency failures non-blocking', async () => {
    const disabledContext = new Context();
    new DesktopLocalDestination(disabledContext);
    const disabled = new DesktopRuntimeActivation(disabledContext, { enabled: false });
    await expect(disabled.beforeRun(launchContext)).resolves.toEqual({
      status: 'disabled',
      diagnostics: [],
    });
    await disabledContext.fiber.dispose();

    const missingContext = new Context();
    new DesktopLocalDestination(missingContext);
    const missing = new DesktopRuntimeActivation(missingContext, {
      enabled: true,
      executable: 'Z:\\missing\\Repoctopus.exe',
      platform: 'win32',
    });
    await expect(missing.beforeRun(launchContext)).resolves.toMatchObject({
      status: 'warning',
      diagnostics: [{ code: 'desktop.launch-failed' }],
    });
    await missingContext.fiber.dispose();
  });
});
