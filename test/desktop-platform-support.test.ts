import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { DesktopPlatformSupportPanel } from '../app/desktop/renderer/src/platform-support-panel.js';
import {
  DESKTOP_PLATFORM_SUPPORT_MATRIX,
  desktopPlatformSupport,
} from '../domains/desktop/platform-support.js';
import { WindowsDesktopProcessLauncher } from '../platform/desktop/windows-desktop-process-launcher.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const launchContext = {
  schemaVersion: 1 as const,
  workspaceId: 'team-platform',
  changeId: 'platform-support',
  runId: 'change-platform-support-1234',
};

describe('Desktop platform support contract', () => {
  it('formally supports only Windows x64 and keeps future status vocabulary explicit', () => {
    expect(DESKTOP_PLATFORM_SUPPORT_MATRIX).toEqual([
      expect.objectContaining({ id: 'windows-x64', status: 'supported' }),
      expect.objectContaining({ id: 'windows-arm64', status: 'unsupported' }),
      expect.objectContaining({ id: 'macos-x64', status: 'unsupported' }),
      expect.objectContaining({ id: 'macos-arm64', status: 'unsupported' }),
      expect.objectContaining({ id: 'linux-x64', status: 'unsupported' }),
      expect.objectContaining({ id: 'linux-arm64', status: 'unsupported' }),
    ]);
    expect(desktopPlatformSupport('win32', 'x64').status).toBe('supported');
    expect(desktopPlatformSupport('win32', 'arm64').status).toBe('unsupported');
    expect(desktopPlatformSupport('darwin', 'x64').status).toBe('unsupported');
    expect(desktopPlatformSupport('linux', 'x64').status).toBe('unsupported');
    expect(desktopPlatformSupport('freebsd', 'x64')).toMatchObject({
      id: 'freebsd-x64',
      status: 'unsupported',
    });
  });

  it('never spawns the Windows desktop binary on Windows ARM64', async () => {
    const spawnProcess = vi.fn();
    const launcher = new WindowsDesktopProcessLauncher({
      platform: 'win32',
      architecture: 'arm64',
      executable: 'Repoctopus Desktop.exe',
      spawnProcess,
    });

    await expect(launcher.activate(launchContext)).resolves.toEqual({
      status: 'unsupported',
      platform: 'win32/arm64',
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('renders and documents the exact shared matrix without implying build equals support', async () => {
    const markup = renderToStaticMarkup(createElement(DesktopPlatformSupportPanel));
    const documentation = await readFile(
      path.join(repositoryRoot, 'docs', 'desktop-dashboard.md'),
      'utf8',
    );

    for (const target of DESKTOP_PLATFORM_SUPPORT_MATRIX) {
      expect(markup).toContain(target.label);
      expect(markup).toContain(target.status);
      expect(documentation).toMatch(
        new RegExp(`\\|\\s*${target.label.replace('/', '\\/')}\\s*\\|`, 'u'),
      );
      expect(documentation).toMatch(new RegExp(`\\|\\s*${target.status}\\s*\\|`, 'u'));
    }
    expect(documentation).toContain('能够编译或打包不等于正式支持');
  });
});
