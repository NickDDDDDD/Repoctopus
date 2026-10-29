import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, spawn } from 'node:child_process';

import {
  decodeDesktopLaunchContext,
  desktopLaunchContextArgument,
  desktopLaunchContextFromArguments,
  desktopLaunchContextFromUrl,
  desktopLaunchContextUrl,
  encodeDesktopLaunchContext,
} from '../app/desktop/shared/launch-context.js';
import { isDesktopHostEvent, isDesktopShellCommand } from '../app/desktop/shared/host-protocol.js';
import { isDesktopShellState } from '../app/desktop/shared/renderer-contract.js';
import {
  claimDesktopSingleInstance,
  type DesktopSecondInstanceListener,
} from '../app/desktop/main/single-instance.js';
import { DesktopHostProcess } from '../app/desktop/main/host-process.js';

const context = {
  schemaVersion: 1 as const,
  workspaceId: 'team-platform',
  changeId: 'add-dashboard',
  runId: 'change-add-dashboard-1234',
};

describe('Desktop versioned protocol', () => {
  it('round-trips a bounded launch context through second-instance arguments', () => {
    const encoded = encodeDesktopLaunchContext(context);
    expect(decodeDesktopLaunchContext(encoded)).toEqual(context);
    expect(desktopLaunchContextFromArguments([desktopLaunchContextArgument(context)])).toEqual(
      context,
    );
    expect(() =>
      decodeDesktopLaunchContext(
        Buffer.from(JSON.stringify({ ...context, schemaVersion: 2 })).toString('base64url'),
      ),
    ).toThrow(/version/u);
    expect(() => encodeDesktopLaunchContext({ ...context, runId: 'r'.repeat(300) })).toThrow(
      /runId/u,
    );
  });

  it('round-trips the same context through the installed protocol URL', () => {
    const url = desktopLaunchContextUrl(context);
    expect(url).toMatch(/^repoctopus:\/\/activate\//u);
    expect(desktopLaunchContextFromUrl(url)).toEqual(context);
    expect(() => desktopLaunchContextFromUrl('https://activate.invalid/context')).toThrow(
      /protocol/u,
    );
    expect(() => desktopLaunchContextFromUrl('repoctopus://other/context')).toThrow(/host/u);
    expect(() => desktopLaunchContextFromUrl(`${url}?command=secret`)).toThrow(/query/u);
    expect(() =>
      desktopLaunchContextFromUrl(
        `repoctopus://activate/${Buffer.from(
          JSON.stringify({ ...context, schemaVersion: 2 }),
        ).toString('base64url')}`,
      ),
    ).toThrow(/version/u);
  });

  it('fails closed for unknown, oversized, or malformed Host and Renderer payloads', () => {
    expect(isDesktopHostEvent({ type: 'ready', protocolVersion: 2, snapshot: {} })).toBe(false);
    expect(
      isDesktopHostEvent({ type: 'fatal', protocolVersion: 1, message: 'x'.repeat(65_537) }),
    ).toBe(false);
    expect(isDesktopShellCommand({ type: 'activate-context', protocolVersion: 1, context })).toBe(
      true,
    );
    expect(isDesktopShellCommand({ type: 'activate-context', protocolVersion: 9, context })).toBe(
      false,
    );
    expect(
      isDesktopShellCommand({ type: 'select-change', protocolVersion: 1, selection: context }),
    ).toBe(true);
    expect(
      isDesktopShellCommand({
        type: 'select-change',
        protocolVersion: 1,
        selection: { ...context, runId: 'r'.repeat(300) },
      }),
    ).toBe(false);
    expect(isDesktopShellState({ protocolVersion: 1, phase: 'starting' })).toBe(true);
    expect(isDesktopShellState({ protocolVersion: 1, phase: 'unknown' })).toBe(false);
  });

  it('forwards only a validated launch context from the transient second instance', () => {
    let listener: DesktopSecondInstanceListener | undefined;
    const activate = vi.fn();
    const requestSingleInstanceLock = vi.fn(() => true);
    const owns = claimDesktopSingleInstance(
      {
        requestSingleInstanceLock,
        quit: vi.fn(),
        on: (_event, registered) => {
          listener = registered;
        },
      },
      context,
      activate,
    );

    expect(owns).toBe(true);
    expect(requestSingleInstanceLock).toHaveBeenCalledWith(
      expect.objectContaining({ repoctopusLaunchContext: encodeDesktopLaunchContext(context) }),
    );
    listener?.({}, [desktopLaunchContextArgument(context)], '.', {});
    expect(activate).toHaveBeenCalledWith(context);
    listener?.({}, ['--repoctopus-launch=not-base64'], '.', {});
    expect(activate).toHaveBeenLastCalledWith(null);
  });

  it('fails a Host that misses the bounded readiness deadline', async () => {
    vi.useFakeTimers();
    try {
      const kill = vi.fn(() => true);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        connected: true,
        send: vi.fn(),
        kill,
      }) as unknown as ChildProcess;
      const host = new DesktopHostProcess({
        executable: 'electron.exe',
        entry: 'host.mjs',
        productRoot: 'C:\\repoctopus',
        readyDeadlineMs: 10,
        spawnChild: vi.fn(() => child) as unknown as typeof spawn,
      });

      const started = host.start();
      const rejected = expect(started).rejects.toThrow(/readiness deadline/u);
      await vi.advanceTimersByTimeAsync(11);
      await rejected;
      expect(kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });
});
