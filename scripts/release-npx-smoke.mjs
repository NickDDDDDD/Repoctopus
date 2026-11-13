import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const npm = process.env.npm_execpath;
const spec = process.argv[2];
if (!npm || !spec) throw new Error('Run npm run test:release-npx -- <tarball-or-URL>');
const packageSpec = spec.startsWith('https://') ? spec : path.resolve(spec);
const { version: expectedVersion } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const root = await mkdtemp(path.join(tmpdir(), 'repoctopus-release-npx-'));
try {
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const options = { cwd: workspace, timeout: 120_000, windowsHide: true };
  await execute('git', ['init', '--initial-branch=main'], options);
  await execute(
    'git',
    [
      '-c',
      'user.name=Repoctopus Release',
      '-c',
      'user.email=release@example.invalid',
      'commit',
      '--no-gpg-sign',
      '--allow-empty',
      '-m',
      'Release consumer fixture',
    ],
    options,
  );

  const args = [
    path.join(path.dirname(npm), 'npx-cli.js'),
    '--yes',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--cache',
    path.join(root, 'npm-cache'),
    '--package',
    packageSpec,
    'repoctopus',
  ];
  const version = await execute(process.execPath, [...args, '--version'], options);
  if (version.stdout.trim() !== expectedVersion) {
    throw new Error(`npx version does not match product package version ${expectedVersion}`);
  }
  const help = await execute(process.execPath, [...args, '--help'], options);
  if (!/^Usage: repoctopus /mu.test(help.stdout)) throw new Error('npx did not run Repoctopus');
  const detected = await execute(
    process.execPath,
    [...args, 'project', 'detect', '--workspace', '.', '--scan-root', root, '--json'],
    options,
  );
  const result = JSON.parse(detected.stdout);
  if (result.protocolVersion !== 1 || result.ok !== true || result.command !== 'project detect') {
    throw new Error('npx did not return the expected Repoctopus JSON protocol');
  }
  process.stdout.write('Verified isolated npx version, help and project detect JSON protocol\n');
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
