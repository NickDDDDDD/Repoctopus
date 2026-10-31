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
    expect(script).toContain("path.join(systemRoot, 'System32', 'reg.exe')");
    expect(script).toContain(
      'HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\App Paths\\\\Repoctopus.exe',
    );
    expect(script).toContain('await readInstalledExecutable()');
    expect(script).toContain('launchUrl(options.changeId, options.runId)');
    expect(script).toContain("child.once('spawn'");
    expect(script).not.toContain('launchExplorer');
    expect(script).not.toContain("const executable = path.join(installRoot, 'Repoctopus.exe')");
    expect(script).not.toContain('REPOCTOPUS_DESKTOP_EXECUTABLE');
    expect(script).not.toContain("transport: 'url'");
    expect(script).toContain("'restore-registry-state'");
    expect(script).toContain("'export'");
    expect(script).toContain("'import'");
  });

  it('exposes package construction, contents verification and installed E2E commands', async () => {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(metadata.scripts.build).toContain('build:desktop');
    expect(metadata.scripts['check:generated']).toContain('build-desktop.mjs --check');
    expect(metadata.scripts['package:desktop']).toBeTruthy();
    expect(metadata.scripts['check:desktop-package']).toBe(
      'node scripts/check-desktop-package.mjs',
    );
    expect(metadata.scripts['test:desktop-package-e2e']).toBe(
      'node scripts/windows-desktop-package-e2e.mjs',
    );
  });

  it('registers the bounded Repoctopus activation protocol in the Windows installer', async () => {
    const configuration = JSON.parse(
      await readFile(path.join(root, 'electron-builder.json'), 'utf8'),
    ) as {
      protocols?: Array<{ name?: string; schemes?: string[] }>;
      nsis?: { include?: string };
    };
    expect(configuration.protocols).toEqual([
      { name: 'Repoctopus Change Activation', schemes: ['repoctopus'] },
    ]);
    expect(configuration.nsis?.include).toBe('app/desktop/resources/installer.nsh');
    const installer = await readFile(
      path.join(root, 'app', 'desktop', 'resources', 'installer.nsh'),
      'utf8',
    );
    expect(installer).toContain(
      'Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Repoctopus.exe',
    );
    expect(installer).toContain('$INSTDIR\\Repoctopus.exe');
    expect(installer).toContain('DeleteRegKey SHCTX');
    const packageCheck = await readFile(
      path.join(root, 'scripts', 'check-desktop-package.mjs'),
      'utf8',
    );
    expect(packageCheck).toContain('Repoctopus Change Activation');
    expect(packageCheck).toContain("schemes.includes('repoctopus')");
    expect(packageCheck).toContain('Windows protocol handler');
  });
});
