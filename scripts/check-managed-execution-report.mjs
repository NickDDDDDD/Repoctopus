import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { packageContentDigest } from './package-content-digest.mjs';

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required to reproduce the package archive');
const evidenceOnly = (file) =>
  file.startsWith('.comet/') ||
  file.startsWith('docs/superpowers/') ||
  file.startsWith('openspec/') ||
  file.startsWith('verification/');
const verificationRoot = path.join(root, 'verification');
const reportPaths = (await readdir(verificationRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(verificationRoot, entry.name, 'verification-report.md'));
const reports = [];
for (const reportPath of reportPaths) {
  let report;
  try {
    report = await readFile(reportPath, 'utf8');
  } catch {
    continue;
  }
  const commit = report.match(/Tested implementation commit: `([a-f0-9]{40})`/u)?.[1];
  const expectedPackage = report
    .match(/Package content SHA-256: `([a-f0-9]{64})`/u)?.[1]
    ?.toLowerCase();
  const expectedFiles = Number(report.match(/Package files: `(\d+)`/u)?.[1]);
  const expectedBytes = Number(report.match(/Package content bytes: `(\d+)`/u)?.[1]);
  if (
    !commit ||
    !expectedPackage ||
    !Number.isSafeInteger(expectedFiles) ||
    expectedFiles <= 0 ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0
  ) {
    continue;
  }
  try {
    await execute('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root });
  } catch {
    continue;
  }
  const changed = (
    await execute('git', ['diff', '--name-only', `${commit}..HEAD`], { cwd: root })
  ).stdout
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const distance = Number(
    (await execute('git', ['rev-list', '--count', `${commit}..HEAD`], { cwd: root })).stdout.trim(),
  );
  reports.push({
    reportPath,
    relativePath: path.relative(root, reportPath).split(path.sep).join('/'),
    commit,
    expectedPackage,
    expectedFiles,
    expectedBytes,
    distance,
    disallowed: changed.filter((file) => !evidenceOnly(file)),
  });
}
const eligible = reports
  .filter((report) => report.disallowed.length === 0)
  .sort(
    (left, right) =>
      left.distance - right.distance || left.relativePath.localeCompare(right.relativePath, 'en'),
  );
const selected = eligible[0];
if (!selected) {
  const closest = reports.sort(
    (left, right) =>
      left.distance - right.distance || left.relativePath.localeCompare(right.relativePath, 'en'),
  )[0];
  const suffix = closest
    ? `; closest report is stale for packaged product changes: ${closest.disallowed.join(', ')}`
    : '';
  throw new Error(
    `No managed execution verification report covers the current packaged product${suffix}`,
  );
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-verification-pack-'));
try {
  const packed = JSON.parse(
    (
      await execute(
        process.execPath,
        [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
        { cwd: root, maxBuffer: 16 * 1024 * 1024 },
      )
    ).stdout,
  );
  const filename = packed?.[0]?.filename;
  if (typeof filename !== 'string') throw new Error('npm pack did not return a package filename');
  const archive = await readFile(path.join(temporary, filename));
  const actual = packageContentDigest(archive);
  if (
    actual.sha256 !== selected.expectedPackage ||
    actual.files !== selected.expectedFiles ||
    actual.bytes !== selected.expectedBytes
  ) {
    throw new Error(
      `Managed execution report package content mismatch: expected ${selected.expectedPackage} (${selected.expectedFiles} files, ${selected.expectedBytes} bytes), got ${actual.sha256} (${actual.files} files, ${actual.bytes} bytes)`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(
  `Verified lifecycle report ${path.relative(root, selected.reportPath)} at commit ${selected.commit} and package content ${selected.expectedPackage} (${selected.expectedFiles} files, ${selected.expectedBytes} bytes)\n`,
);
