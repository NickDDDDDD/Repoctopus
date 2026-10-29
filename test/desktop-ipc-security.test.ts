import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop renderer security boundary', () => {
  it('pins sandbox, denies permissions and ships a closed CSP', async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const [main, html, preload] = await Promise.all([
      readFile(path.join(root, 'app/desktop/main/main.ts'), 'utf8'),
      readFile(path.join(root, 'app/desktop/renderer/index.html'), 'utf8'),
      readFile(path.join(root, 'app/desktop/preload/main.ts'), 'utf8'),
    ]);
    expect(main).toMatch(/contextIsolation:\s*true/u);
    expect(main).toMatch(/nodeIntegration:\s*false/u);
    expect(main).toMatch(/sandbox:\s*true/u);
    expect(main).toContain('setPermissionRequestHandler');
    expect(main).toContain('setPermissionCheckHandler');
    expect(main).not.toMatch(/bootDesktopComposition|new\s+DesktopProjection/u);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/u);
    expect(preload).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/u);
  });
});
