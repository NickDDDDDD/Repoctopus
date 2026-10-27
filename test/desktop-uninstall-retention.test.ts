import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface RetentionFixture {
  schemaVersion: 1;
  installFiles: string[];
  userDataFiles: string[];
  workspaceFiles: string[];
  defaultUninstall: { remove: string[]; preserve: string[] };
  explicitUserDataCleanup: { remove: string[]; preserve: string[] };
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

async function materialize(root: string, files: readonly string[]): Promise<void> {
  for (const file of files) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `fixture:${file}\n`, 'utf8');
  }
}

describe('desktop uninstall and reinstall retention', () => {
  it('removes only the installation by default and never touches Workspace facts', async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '..');
    const fixture = JSON.parse(
      await readFile(
        path.join(
          repositoryRoot,
          'test',
          'fixtures',
          'desktop-dashboard',
          'uninstall-reinstall.json',
        ),
        'utf8',
      ),
    ) as RetentionFixture;
    const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-uninstall-'));
    try {
      const roots = {
        install: path.join(root, 'Program Files', 'Repoctopus'),
        userData: path.join(root, 'AppData', 'Roaming', 'Repoctopus'),
        workspace: path.join(root, 'team-platform'),
      };
      await materialize(roots.install, fixture.installFiles);
      await materialize(roots.userData, fixture.userDataFiles);
      await materialize(roots.workspace, fixture.workspaceFiles);

      expect(fixture.defaultUninstall).toEqual({
        remove: ['install'],
        preserve: ['userData', 'workspace'],
      });
      await rm(roots.install, { recursive: true });
      expect(await exists(roots.install)).toBe(false);
      expect(await exists(roots.userData)).toBe(true);
      expect(await exists(roots.workspace)).toBe(true);

      await materialize(roots.install, fixture.installFiles);
      expect(await exists(path.join(roots.userData, fixture.userDataFiles[0]!))).toBe(true);
      expect(await exists(path.join(roots.workspace, fixture.workspaceFiles[0]!))).toBe(true);

      expect(fixture.explicitUserDataCleanup).toEqual({
        remove: ['userData'],
        preserve: ['workspace'],
      });
      await rm(roots.userData, { recursive: true });
      expect(await exists(roots.workspace)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('documents security, retention, close and recovery semantics at the public boundary', async () => {
    const documentation = await readFile(
      path.resolve(import.meta.dirname, '..', 'docs', 'desktop-dashboard.md'),
      'utf8',
    );
    for (const marker of [
      'desktop-data:security',
      'desktop-data:retention',
      'desktop-data:close',
      'desktop-data:recovery',
      'desktop-data:uninstall',
    ]) {
      expect(documentation).toContain(`<!-- ${marker} -->`);
    }
    expect(documentation).toContain('%APPDATA%\\Repoctopus');
    expect(documentation).toContain('%LOCALAPPDATA%\\Repoctopus\\desktop-receiver.json');
    expect(documentation).toContain('不会读取或删除 Workspace');
  });
});
