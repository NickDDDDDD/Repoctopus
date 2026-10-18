import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  doctorManagedChromium,
  expectedManagedChromiumExecutable,
  installManagedChromium,
  managedBrowserCacheRoot,
  readManagedChromiumMetadata,
} from '../platform/browser/managed-browser.js';
import { removeTemporaryDirectory, temporaryDirectory } from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function createExpectedExecutable(workspace: string): Promise<string> {
  const metadata = await readManagedChromiumMetadata();
  const executable = expectedManagedChromiumExecutable(
    managedBrowserCacheRoot(workspace),
    metadata.revision,
  );
  if (!executable) throw new Error(`Unsupported test platform: ${process.platform}`);
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, 'fixture');
  return executable;
}

describe('managed browser', () => {
  it('pins Playwright metadata and reports an explicit install command without downloading', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-missing-');
    cleanup.push(workspace);
    const metadata = await readManagedChromiumMetadata();
    expect(metadata).toMatchObject({ playwrightVersion: '1.64.1', revision: '1248' });

    const result = await doctorManagedChromium(workspace);
    expect(result).toMatchObject({
      status: 'missing',
      trust: 'unavailable',
      executablePath: null,
      installCommand: {
        executable: 'repoctopus',
        args: ['browser', 'install', '--workspace', path.resolve(workspace)],
      },
    });
  });

  it('rejects an installed Chromium revision that does not match playwright-core', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-revision-');
    cleanup.push(workspace);
    await mkdir(path.join(managedBrowserCacheRoot(workspace), 'chromium-1'), {
      recursive: true,
    });
    const result = await doctorManagedChromium(workspace);
    expect(result).toMatchObject({
      status: 'revision_mismatch',
      trust: 'unavailable',
      installedRevisions: ['1'],
    });
  });

  it('returns verified only for the exact managed Chromium executable', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-ready-');
    cleanup.push(workspace);
    const executable = await createExpectedExecutable(workspace);
    expect(await doctorManagedChromium(workspace)).toMatchObject({
      status: 'ready',
      trust: 'verified',
      executablePath: executable,
    });
  });

  it('uses an explicit isolated install runner and verifies the result', async () => {
    const workspace = await temporaryDirectory('repoctopus-browser-install-');
    cleanup.push(workspace);
    let invoked = false;
    const result = await installManagedChromium(workspace, async (input) => {
      invoked = true;
      expect(input.executable).toBe(process.execPath);
      expect(input.args.slice(-2)).toEqual(['install', 'chromium']);
      expect(input.env.PLAYWRIGHT_BROWSERS_PATH).toBe(managedBrowserCacheRoot(workspace));
      await createExpectedExecutable(workspace);
    });
    expect(invoked).toBe(true);
    expect(result).toMatchObject({ status: 'ready', trust: 'verified' });
  });
});
