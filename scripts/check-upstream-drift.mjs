import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.resolve(
  process.env.REPOCTOPUS_UPSTREAM_BASELINES ??
    path.join(root, 'third_party', 'upstream-baselines.json'),
);
const refsFixturePath = process.env.REPOCTOPUS_UPSTREAM_REFS_FILE;

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assertManifest(manifest);
const fixture = refsFixturePath
  ? JSON.parse(await readFile(path.resolve(refsFixturePath), 'utf8'))
  : undefined;

const results = [];
for (const upstream of manifest.upstreams) {
  const refs = fixture ? fixture[upstream.id] : await remoteRefs(upstream);
  if (!refs || typeof refs !== 'object' || Array.isArray(refs)) {
    throw new Error(`Missing upstream ref fixture for ${upstream.id}`);
  }
  const branchRef = `refs/heads/${upstream.branch}`;
  const tagRef = `refs/tags/${upstream.pinnedTag}`;
  const branchCommit = refs[branchRef];
  const tagCommit = refs[`${tagRef}^{}`] ?? refs[tagRef];
  const findings = [];
  if (!branchCommit) findings.push(`missing branch ${branchRef}`);
  else if (branchCommit !== upstream.pinnedCommit) {
    findings.push(`branch advanced to ${branchCommit}`);
  }
  if (!tagCommit) findings.push(`missing tag ${tagRef}`);
  else if (tagCommit !== upstream.pinnedTagCommit) {
    findings.push(`tag resolves to ${tagCommit}`);
  }
  results.push({
    id: upstream.id,
    pinnedCommit: upstream.pinnedCommit,
    branchCommit,
    tagCommit,
    status: findings.length === 0 ? 'current' : 'drifted',
    findings,
  });
}

if (process.argv.includes('--json')) {
  process.stdout.write(
    `${JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
} else {
  for (const result of results) {
    const detail = result.findings.length === 0 ? result.pinnedCommit : result.findings.join('; ');
    process.stdout.write(`${result.id}: ${result.status} (${detail})\n`);
  }
}

if (results.some((result) => result.status === 'drifted')) process.exitCode = 1;

async function remoteRefs(upstream) {
  const { stdout } = await execFileAsync(
    'git',
    [
      'ls-remote',
      upstream.repository,
      `refs/heads/${upstream.branch}`,
      `refs/tags/${upstream.pinnedTag}`,
      `refs/tags/${upstream.pinnedTag}^{}`,
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  );
  return Object.fromEntries(
    stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const [commit, ref] = line.split(/\s+/u);
        return [ref, commit];
      }),
  );
}

function assertManifest(value) {
  if (
    value?.schemaVersion !== 1 ||
    !Array.isArray(value.upstreams) ||
    value.upstreams.length === 0
  ) {
    throw new Error('Invalid upstream baseline manifest');
  }
  const ids = new Set();
  for (const upstream of value.upstreams) {
    if (
      typeof upstream.id !== 'string' ||
      ids.has(upstream.id) ||
      typeof upstream.repository !== 'string' ||
      typeof upstream.branch !== 'string' ||
      typeof upstream.pinnedTag !== 'string' ||
      !/^[a-f0-9]{40}$/u.test(upstream.pinnedCommit ?? '') ||
      !/^[a-f0-9]{40}$/u.test(upstream.pinnedTagCommit ?? '')
    ) {
      throw new Error(`Invalid upstream baseline: ${upstream?.id ?? '(missing id)'}`);
    }
    ids.add(upstream.id);
  }
}
