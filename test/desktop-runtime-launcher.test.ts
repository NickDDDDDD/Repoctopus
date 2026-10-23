import { EventEmitter } from 'node:events';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_ACTIVATION_ARGUMENT,
  DESKTOP_ACTIVATION_CONTRACT,
} from '../app/desktop/shared/activation-protocol.js';
import {
  readDesktopActivationRequest,
  writeDesktopActivationResponse,
} from '../platform/desktop/activation-files.js';
import { WindowsDesktopLauncher } from '../platform/desktop/windows-launcher.js';

const authorization = `Bearer ${'a'.repeat(43)}`;

describe('Windows Desktop Launcher', () => {
  it('uses a bounded one-time activation exchange and removes the credential-bearing files', async () => {
    let requestFile = '';
    const unref = vi.fn();
    const spawnProcess = vi.fn((_executable: string, args: readonly string[]) => {
      requestFile = args
        .find((value) => value.startsWith(DESKTOP_ACTIVATION_ARGUMENT))!
        .slice(DESKTOP_ACTIVATION_ARGUMENT.length);
      const child = new EventEmitter() as EventEmitter & { unref(): void };
      child.unref = unref;
      void readDesktopActivationRequest(requestFile).then((request) =>
        writeDesktopActivationResponse(requestFile, {
          apiVersion: DESKTOP_ACTIVATION_CONTRACT,
          requestId: request.requestId,
          status: 'ready',
          shellPid: 42,
          receiver: { origin: 'http://127.0.0.1:4318', authorization },
        }),
      );
      return child;
    });
    const launcher = new WindowsDesktopLauncher({
      productRoot: path.resolve('.'),
      workspaceRoot: path.resolve('elsewhere'),
      environment: { REPOCTOPUS_DESKTOP_EXECUTABLE: process.execPath },
      platform: 'win32',
      timeoutMs: 2_000,
      pollIntervalMs: 5,
      spawnProcess: spawnProcess as never,
    });

    await expect(
      launcher.activate({
        schemaVersion: 1,
        workspaceId: 'workspace',
        changeId: 'dashboard-change',
        runId: 'run-dashboard',
      }),
    ).resolves.toEqual({
      status: 'ready',
      shellPid: 42,
      receiver: { origin: 'http://127.0.0.1:4318', authorization },
    });
    expect(unref).toHaveBeenCalledOnce();
    await expect(stat(requestFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(requestFile.replace('.request.json', '.response.json'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('returns an explicit capability result without spawning on unsupported platforms', async () => {
    const spawnProcess = vi.fn();
    const launcher = new WindowsDesktopLauncher({
      productRoot: path.resolve('.'),
      workspaceRoot: path.resolve('.'),
      platform: 'linux',
      spawnProcess: spawnProcess as never,
    });

    await expect(
      launcher.activate({ schemaVersion: 1, workspaceId: 'workspace', runId: 'run' }),
    ).resolves.toEqual({
      status: 'unavailable',
      diagnostic: 'desktop-platform-unsupported',
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
