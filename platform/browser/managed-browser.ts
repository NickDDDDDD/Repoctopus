import { createRequire } from 'node:module';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { runExternalCommandAsync } from '../process/external-command.js';

const require = createRequire(import.meta.url);

export interface ManagedChromiumMetadata {
  playwrightVersion: string;
  revision: string;
  browserVersion: string;
}

export interface ManagedBrowserDoctorResult {
  browser: 'chromium';
  source: 'managed';
  trust: 'verified' | 'unavailable';
  status: 'ready' | 'missing' | 'revision_mismatch' | 'unsupported_platform';
  cacheRoot: string;
  expected: ManagedChromiumMetadata;
  executablePath: string | null;
  installedRevisions: string[];
  installCommand: { executable: 'repoctopus'; args: string[] };
}

interface BrowsersJson {
  browsers?: Array<{
    name?: string;
    revision?: string;
    browserVersion?: string;
  }>;
}

export type BrowserInstallRunner = (input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => Promise<void>;

function packageRoot(): string {
  return path.dirname(require.resolve('playwright-core/package.json'));
}

export async function readManagedChromiumMetadata(): Promise<ManagedChromiumMetadata> {
  const [packageSource, browsersSource] = await Promise.all([
    readFile(path.join(packageRoot(), 'package.json'), 'utf8'),
    readFile(path.join(packageRoot(), 'browsers.json'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource) as { version?: string };
  const browsersJson = JSON.parse(browsersSource) as BrowsersJson;
  const chromium = browsersJson.browsers?.find((browser) => browser.name === 'chromium');
  if (
    typeof packageJson.version !== 'string' ||
    typeof chromium?.revision !== 'string' ||
    typeof chromium.browserVersion !== 'string'
  ) {
    throw new Error('Installed playwright-core metadata is invalid');
  }
  return {
    playwrightVersion: packageJson.version,
    revision: chromium.revision,
    browserVersion: chromium.browserVersion,
  };
}

export function managedBrowserCacheRoot(workspace: string): string {
  return path.join(path.resolve(workspace), '.repoctopus', 'browsers');
}

function executableParts(): string[] | null {
  if (process.platform === 'win32') return ['chrome-win64', 'chrome.exe'];
  if (process.platform === 'linux') {
    return process.arch === 'arm64'
      ? ['chrome-linux-arm64', 'chrome']
      : ['chrome-linux64', 'chrome'];
  }
  if (process.platform === 'darwin') {
    const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
    return [
      `chrome-mac-${architecture}`,
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    ];
  }
  return null;
}

export function expectedManagedChromiumExecutable(
  cacheRoot: string,
  revision: string,
): string | null {
  const parts = executableParts();
  return parts ? path.join(cacheRoot, `chromium-${revision}`, ...parts) : null;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function installedChromiumRevisions(cacheRoot: string): Promise<string[]> {
  try {
    return (await readdir(cacheRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
      .map((entry) => entry.name.slice('chromium-'.length))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function doctorManagedChromium(
  workspace: string,
): Promise<ManagedBrowserDoctorResult> {
  const cacheRoot = managedBrowserCacheRoot(workspace);
  const expected = await readManagedChromiumMetadata();
  const installedRevisions = await installedChromiumRevisions(cacheRoot);
  const executablePath = expectedManagedChromiumExecutable(cacheRoot, expected.revision);
  const ready = executablePath ? await exists(executablePath) : false;
  const status = !executablePath
    ? 'unsupported_platform'
    : ready
      ? 'ready'
      : installedRevisions.length > 0
        ? 'revision_mismatch'
        : 'missing';
  return {
    browser: 'chromium',
    source: 'managed',
    trust: status === 'ready' ? 'verified' : 'unavailable',
    status,
    cacheRoot,
    expected,
    executablePath: ready ? executablePath : null,
    installedRevisions,
    installCommand: {
      executable: 'repoctopus',
      args: ['browser', 'install', '--workspace', path.resolve(workspace)],
    },
  };
}

const defaultInstallRunner: BrowserInstallRunner = async (input) => {
  await runExternalCommandAsync(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env,
    timeoutMs: 15 * 60_000,
    maxBufferBytes: 1024 * 1024,
  });
};

export async function installManagedChromium(
  workspace: string,
  runner: BrowserInstallRunner = defaultInstallRunner,
): Promise<ManagedBrowserDoctorResult> {
  const root = path.resolve(workspace);
  const cli = path.join(packageRoot(), 'cli.js');
  const cacheRoot = managedBrowserCacheRoot(root);
  await runner({
    executable: process.execPath,
    args: [cli, 'install', 'chromium'],
    cwd: root,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cacheRoot },
  });
  const result = await doctorManagedChromium(root);
  if (result.status !== 'ready') {
    throw new Error(
      `Chromium installation did not provide revision ${result.expected.revision}: ${result.status}`,
    );
  }
  return result;
}
