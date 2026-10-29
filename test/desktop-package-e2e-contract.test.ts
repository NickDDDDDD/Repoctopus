import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

describe('installed Windows desktop end-to-end contract', () => {
  it('covers every required installed-candidate lifecycle boundary', async () => {
    const script = await readFile(
      path.join(root, 'scripts', 'windows-desktop-package-e2e.mjs'),
      'utf8',
    );
    for (const check of [
      'install-candidate',
      'run-activation',
      'otlp-receiver',
      'single-instance',
      'tray-hide-and-restore',
      'direct-exit',
      'uninstall-candidate',
    ]) {
      expect(script).toContain(`'${check}'`);
    }
    expect(script).toContain('REPOCTOPUS_DESKTOP_E2E_EVIDENCE');
    expect(script).toContain('isolatedUserData: true');
    expect(script).toContain('isolatedDiscovery: true');
  });

  it('exposes package construction, contents verification and installed E2E commands', async () => {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(metadata.scripts['package:desktop']).toBeTruthy();
    expect(metadata.scripts['check:desktop-package']).toBe(
      'node scripts/check-desktop-package.mjs',
    );
    expect(metadata.scripts['test:desktop-package-e2e']).toBe(
      'node scripts/windows-desktop-package-e2e.mjs',
    );
  });
});
