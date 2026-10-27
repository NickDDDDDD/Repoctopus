import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { extractAll, listPackage } from '@electron/asar';

const root = path.resolve(import.meta.dirname, '..');
const execute = promisify(execFile);
const release = path.join(root, 'release', 'desktop');
const asar = path.join(release, 'win-unpacked', 'resources', 'app.asar');
const unpacked = path.join(release, 'win-unpacked');
const installer = path.join(release, 'Repoctopus-Desktop-0.1.0-x64-Setup.exe');
const required = [
  '/dist/desktop/main.js',
  '/dist/desktop/preload.cjs',
  '/dist/desktop/host.mjs',
  '/dist/desktop/renderer/index.html',
  '/dist/desktop/resource-manifest.json',
  '/app/desktop/host/projection-journal-store.ts',
  '/package.json',
];

await Promise.all([
  access(asar),
  access(installer),
  access(path.join(unpacked, 'Repoctopus.exe')),
  access(path.join(unpacked, 'resources', 'desktop-icon.ico')),
  access(path.join(unpacked, 'resources', 'app.asar.unpacked', 'dist', 'desktop', 'host.mjs')),
]);

const entries = new Set(listPackage(asar).map((entry) => entry.replaceAll('\\', '/')));
for (const entry of required) {
  if (!entries.has(entry)) throw new Error(`Packaged Desktop is missing ${entry}`);
}

const extracted = await mkdtemp(path.join(tmpdir(), 'repoctopus-package-check-'));
let manifest;
try {
  extractAll(asar, extracted);
  manifest = JSON.parse(
    await readFile(path.join(extracted, 'dist', 'desktop', 'resource-manifest.json'), 'utf8'),
  );
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.arch !== 'x64') {
    throw new Error('Packaged Desktop resource manifest has the wrong identity');
  }
  for (const resource of manifest.resources) {
    const bytes = await readFile(
      resource.path === 'desktop-icon.ico'
        ? path.join(unpacked, 'resources', resource.path)
        : path.join(extracted, ...resource.path.split('/')),
    );
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== resource.sha256 || bytes.length !== resource.size) {
      throw new Error(`Packaged Desktop resource does not match manifest: ${resource.path}`);
    }
  }
} finally {
  await rm(extracted, { recursive: true, force: true });
}

const installerSize = (await stat(installer)).size;
if (installerSize === 0) throw new Error('Desktop installer is empty');
if (!path.basename(installer).startsWith('Repoctopus-Desktop-')) {
  throw new Error('Desktop installer does not use the Repoctopus brand');
}
const executable = path.join(unpacked, 'Repoctopus.exe');
const versionScript =
  '$v=(Get-Item -LiteralPath $env:REPOCTOPUS_EXE).VersionInfo; @{ProductName=$v.ProductName;FileDescription=$v.FileDescription;CompanyName=$v.CompanyName;ProductVersion=$v.ProductVersion}|ConvertTo-Json -Compress';
const { stdout } = await execute(
  path.join(
    process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  ),
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', versionScript],
  { windowsHide: true, env: { ...process.env, REPOCTOPUS_EXE: executable } },
);
const version = JSON.parse(stdout);
if (
  version.ProductName !== 'Repoctopus' ||
  version.FileDescription !== 'Repoctopus' ||
  !String(version.CompanyName).includes('Repoctopus') ||
  version.ProductVersion !== '0.1.0.0'
) {
  throw new Error(`Desktop executable has invalid product metadata: ${JSON.stringify(version)}`);
}

process.stdout.write(
  `Verified Repoctopus Windows x64 installer, ${required.length} required package entries, ${manifest.resources.length} deterministic resources, and ${installerSize} installer bytes\n`,
);
