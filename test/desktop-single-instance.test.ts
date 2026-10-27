import { describe, expect, it, vi } from 'vitest';

import {
  encodeDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../domains/desktop/launcher.js';
import {
  claimDesktopSingleInstance,
  DESKTOP_SECOND_INSTANCE_CONTEXT_KEY,
  type DesktopSingleInstanceApplication,
} from '../app/desktop/main/single-instance.js';

class FakeApplication implements DesktopSingleInstanceApplication {
  readonly quit = vi.fn();
  readonly requestSingleInstanceLock = vi.fn((additionalData?: Record<string, unknown>) => {
    void additionalData;
    return true;
  });
  private secondInstance!: DesktopSingleInstanceApplication['on'] extends (
    event: 'second-instance',
    listener: infer Listener,
  ) => unknown
    ? Listener
    : never;

  on(
    _event: 'second-instance',
    listener: Parameters<DesktopSingleInstanceApplication['on']>[1],
  ): unknown {
    this.secondInstance = listener;
    return this;
  }

  activate(arguments_: readonly string[], additionalData: Record<string, unknown> = {}): void {
    this.secondInstance({}, [...arguments_], process.cwd(), additionalData);
  }
}

const first: DesktopLaunchContext = {
  schemaVersion: 1,
  workspaceId: 'workspace-a',
  changeId: 'change-a',
  runId: 'run-a',
};

const second: DesktopLaunchContext = {
  schemaVersion: 1,
  workspaceId: 'workspace-b',
  changeId: 'change-b',
  runId: 'run-b',
};

describe('Desktop single-instance coordination', () => {
  it('keeps one Shell and forwards every concurrent Run activation to its owner', () => {
    const application = new FakeApplication();
    const activateOwner = vi.fn();

    expect(claimDesktopSingleInstance(application, first, activateOwner)).toBe(true);
    application.activate([], {
      [DESKTOP_SECOND_INSTANCE_CONTEXT_KEY]: encodeDesktopLaunchContext(second),
    });
    application.activate([
      'electron.exe',
      'main.js',
      '--repoctopus-launch-context',
      encodeDesktopLaunchContext(first),
    ]);

    expect(application.requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(application.quit).not.toHaveBeenCalled();
    expect(activateOwner.mock.calls).toEqual([[second], [first]]);
  });

  it('passes bounded context while yielding ownership and ignores malformed forwarded data', () => {
    const secondary = new FakeApplication();
    secondary.requestSingleInstanceLock.mockReturnValue(false);
    expect(claimDesktopSingleInstance(secondary, second, vi.fn())).toBe(false);
    expect(secondary.requestSingleInstanceLock).toHaveBeenCalledWith({
      [DESKTOP_SECOND_INSTANCE_CONTEXT_KEY]: encodeDesktopLaunchContext(second),
    });
    expect(secondary.quit).toHaveBeenCalledOnce();

    const owner = new FakeApplication();
    const activateOwner = vi.fn();
    claimDesktopSingleInstance(owner, first, activateOwner);
    owner.activate(['electron.exe', '--repoctopus-launch-context', 'not-valid'], {
      [DESKTOP_SECOND_INSTANCE_CONTEXT_KEY]: { forged: true },
    });
    expect(activateOwner).toHaveBeenCalledWith(null);
  });
});
