import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

describe('installed Windows desktop end-to-end contract', () => {
  it('runs the installed candidate through every required lifecycle boundary', async () => {
    const script = await readFile(
      path.join(root, 'scripts', 'windows-desktop-package-e2e.mjs'),
      'utf8',
    );
    for (const contract of [
      'install-candidate',
      'run-activation',
      'otlp-receiver',
      'single-instance',
      'tray-hide-and-restore',
      'direct-exit',
      'uninstall-candidate',
    ]) {
      expect(script).toContain(`'${contract}'`);
    }
    expect(script).toContain("taskId: '7.2'");
    expect(script).toContain('REPOCTOPUS_DESKTOP_E2E_EVIDENCE');
  });

  it('exposes the packaged Windows E2E as an explicit verification command', async () => {
    const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageMetadata.scripts['test:desktop-package-e2e']).toBe(
      'node scripts/windows-desktop-package-e2e.mjs',
    );
  });
});
