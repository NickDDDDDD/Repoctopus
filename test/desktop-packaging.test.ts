import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

interface DesktopBuilderConfig {
  appId: string;
  productName: string;
  asar: boolean;
  asarUnpack: string[];
  files: string[];
  extraResources: Array<{ from: string; to: string }>;
  win: { target: Array<{ target: string; arch: string[] }> };
  nsis: { deleteAppDataOnUninstall: boolean };
}

describe('Windows x64 desktop packaging contract', () => {
  it('pins product identity, x64 NSIS, deterministic resources and retained user data', async () => {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      author?: { name?: string };
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const config = JSON.parse(
      await readFile(path.join(root, 'electron-builder.json'), 'utf8'),
    ) as DesktopBuilderConfig;

    expect(metadata.devDependencies['electron-builder']).toBe('26.15.3');
    expect(metadata.author?.name).toBe('Repoctopus Contributors');
    expect(metadata.scripts['package:desktop']).toContain('--win nsis --x64 --publish never');
    expect(config).toMatchObject({
      appId: 'com.repoctopus.desktop',
      productName: 'Repoctopus',
      asar: true,
      win: { target: [{ target: 'nsis', arch: ['x64'] }] },
      nsis: { deleteAppDataOnUninstall: false },
    });
    expect(config.files).toEqual(expect.arrayContaining(['dist/desktop/**/*', 'package.json']));
    expect(config.asarUnpack).toContain('dist/desktop/host.mjs');
    expect(config.extraResources).toContainEqual({
      from: 'app/desktop/resources/icon.ico',
      to: 'desktop-icon.ico',
    });
  });

  it('keeps a reviewable brand source and deterministic generated Windows icon', async () => {
    const svg = await readFile(path.join(root, 'app', 'desktop', 'resources', 'icon.svg'), 'utf8');
    expect(svg).toContain('Repoctopus Desktop icon');
    await expect(
      access(path.join(root, 'app', 'desktop', 'resources', 'icon.ico')),
    ).resolves.toBeUndefined();
  });
});
