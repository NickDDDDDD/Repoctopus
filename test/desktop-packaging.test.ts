import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

interface PackageMetadata {
  author: { name: string };
}

interface DesktopPackagingConfig {
  files: string[];
  asarUnpack: string[];
  extraResources: Array<{ from: string; to: string }>;
  [key: string]: unknown;
}

describe('Windows x64 desktop packaging contract', () => {
  it('pins product identity, target architecture, resources and retention-safe NSIS behavior', async () => {
    const packageMetadata = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    ) as PackageMetadata;
    const config = JSON.parse(
      await readFile(path.join(root, 'electron-builder.json'), 'utf8'),
    ) as DesktopPackagingConfig;
    expect(config).toMatchObject({
      appId: 'com.repoctopus.desktop',
      productName: 'Repoctopus',
      asar: true,
      win: { target: [{ target: 'nsis', arch: ['x64'] }] },
      nsis: { deleteAppDataOnUninstall: false },
    });
    expect(config.files).toEqual(
      expect.arrayContaining(['dist/desktop/**/*', 'app/boot/**/*', 'package.json']),
    );
    expect(config.asarUnpack).toContain('dist/desktop/host.mjs');
    expect(packageMetadata.author.name).toBe('Repoctopus Contributors');
    expect(config.extraResources).toContainEqual(
      expect.objectContaining({ from: 'app/desktop/resources/icon.ico', to: 'desktop-icon.ico' }),
    );
  });

  it('keeps a deterministic brand source and generated Windows icon', async () => {
    const svg = await readFile(path.join(root, 'app', 'desktop', 'resources', 'icon.svg'), 'utf8');
    expect(svg).toContain('Repoctopus Desktop icon');
    await expect(
      access(path.join(root, 'app', 'desktop', 'resources', 'icon.ico')),
    ).resolves.toBeUndefined();
  });
});
