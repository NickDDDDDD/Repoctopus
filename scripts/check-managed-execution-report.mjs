import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is required to reproduce the package archive');
const reportPath = path.join(
  root,
  'verification',
  'complete-managed-change-execution',
  'verification-report.md',
);
const report = await readFile(reportPath, 'utf8');
const commit = report.match(/Tested implementation commit: `([a-f0-9]{40})`/u)?.[1];
const expectedPackage = report
  .match(/Package SHA-256: `([a-f0-9]{64})`/u)?.[1]
  ?.toLowerCase();
if (!commit || !expectedPackage) {
  throw new Error('Managed execution verification report has no pinned commit or package checksum');
}

await execute('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root });
const changed = (
  await execute('git', ['diff', '--name-only', `${commit}..HEAD`], { cwd: root })
).stdout
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean);
const disallowed = changed.filter(
  (file) => file !== 'verification/complete-managed-change-execution/verification-report.md',
);
if (disallowed.length > 0) {
  throw new Error(
    `Managed execution report is stale for packaged product changes: ${disallowed.join(', ')}`,
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
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expectedPackage) {
    throw new Error(
      `Managed execution report package checksum mismatch: expected ${expectedPackage}, got ${actual}`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(
  `Verified managed execution report commit ${commit} and package ${expectedPackage}\n`,
);
