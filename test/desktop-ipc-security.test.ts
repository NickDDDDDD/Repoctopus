import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IPC_CONTRACT_VERSION,
  DESKTOP_IPC_MAX_PAYLOAD_BYTES,
  DESKTOP_IPC_REQUESTS,
  desktopIpcRequest,
} from '../app/desktop/shared/renderer-contract.js';
import {
  isTrustedDesktopIpcEvent,
  validateDesktopIpcRequest,
} from '../app/desktop/main/ipc-security.js';

function sender(url: string, overrides: Record<string, unknown> = {}) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  return {
    event: { sender: webContents, senderFrame: mainFrame, ...overrides },
    webContents,
  };
}

describe('desktop IPC security boundary', () => {
  it('pins the BrowserWindow sandbox and a closed renderer CSP', async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const [main, html] = await Promise.all([
      readFile(path.join(root, 'app', 'desktop', 'main', 'main.ts'), 'utf8'),
      readFile(path.join(root, 'app', 'desktop', 'renderer', 'index.html'), 'utf8'),
    ]);
    expect(main).toMatch(/contextIsolation:\s*true/gu);
    expect(main).toMatch(/nodeIntegration:\s*false/gu);
    expect(main).toMatch(/sandbox:\s*true/gu);
    expect(main).toMatch(/webSecurity:\s*true/gu);
    expect(main).toContain('setPermissionRequestHandler');
    expect(main).toContain('setWindowOpenHandler');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
  });

  it('uses a versioned, closed allowlist', () => {
    expect(DESKTOP_IPC_CONTRACT_VERSION).toBe('repoctopus.desktop-ipc/v1');
    expect(Object.keys(DESKTOP_IPC_REQUESTS).sort()).toEqual(['currentState', 'retry']);
    expect(Object.isFrozen(DESKTOP_IPC_REQUESTS)).toBe(true);
  });

  it('accepts only the expected window, main frame and exact renderer file origin', () => {
    const rendererEntry = 'C:\\repoctopus\\dist\\desktop\\renderer\\index.html';
    const trusted = sender('file:///C:/repoctopus/dist/desktop/renderer/index.html');
    const remote = sender('https://attacker.example/index.html');
    const wrongFile = sender('file:///C:/repoctopus/dist/desktop/renderer/other.html');

    expect(isTrustedDesktopIpcEvent(trusted.event, trusted.webContents, rendererEntry)).toBe(true);
    expect(isTrustedDesktopIpcEvent(remote.event, remote.webContents, rendererEntry)).toBe(false);
    expect(
      isTrustedDesktopIpcEvent(
        { sender: trusted.webContents, senderFrame: { url: trusted.event.senderFrame.url } },
        trusted.webContents,
        rendererEntry,
      ),
    ).toBe(false);
    expect(isTrustedDesktopIpcEvent(wrongFile.event, wrongFile.webContents, rendererEntry)).toBe(
      false,
    );
  });

  it('rejects unknown channels, wrong versions, extra payload and oversized input', () => {
    expect(
      validateDesktopIpcRequest(DESKTOP_IPC_REQUESTS.currentState, desktopIpcRequest()),
    ).toEqual(desktopIpcRequest());
    expect(() => validateDesktopIpcRequest('repoctopus:unknown', desktopIpcRequest())).toThrow(
      /allowlist/iu,
    );
    expect(() =>
      validateDesktopIpcRequest(DESKTOP_IPC_REQUESTS.retry, { apiVersion: 'v0' }),
    ).toThrow(/version/iu);
    expect(() =>
      validateDesktopIpcRequest(DESKTOP_IPC_REQUESTS.retry, {
        ...desktopIpcRequest(),
        command: 'arbitrary',
      }),
    ).toThrow(/payload/iu);
    expect(() =>
      validateDesktopIpcRequest(
        DESKTOP_IPC_REQUESTS.retry,
        'x'.repeat(DESKTOP_IPC_MAX_PAYLOAD_BYTES + 1),
      ),
    ).toThrow(/payload/iu);
  });
});
