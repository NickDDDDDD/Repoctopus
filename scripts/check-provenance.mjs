import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const findings = [];
const manifestPath = path.join(root, 'third_party', 'comet', 'source-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !manifest.upstream?.commit || !Array.isArray(manifest.files)) {
  throw new Error('Invalid third_party/comet/source-manifest.json');
}
for (const entry of manifest.files) {
  if (
    typeof entry.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
    typeof entry.target !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    !['copied', 'modified'].includes(entry.adoption)
  ) {
    findings.push(`Invalid provenance entry: ${entry.target ?? '(missing target)'}`);
    continue;
  }
  const target = await readFile(path.join(root, entry.target));
  if (createHash('sha256').update(target).digest('hex') !== entry.sha256) {
    findings.push(`Target digest mismatch: ${entry.target}`);
  }
  if (process.env.COMET_UPSTREAM_ROOT) {
    const source = await readFile(path.join(process.env.COMET_UPSTREAM_ROOT, entry.source));
    if (createHash('sha256').update(source).digest('hex') !== entry.sourceSha256) {
      findings.push(`Source digest mismatch: ${entry.source}`);
    }
  }
}

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(absolute, relative)));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

const cordisManifestPath = path.join(root, 'third_party', 'cordis-upstream.json');
const cordisManifest = JSON.parse(await readFile(cordisManifestPath, 'utf8'));
if (
  cordisManifest.schemaVersion !== 1 ||
  !/^[a-f0-9]{40}$/.test(cordisManifest.upstream?.commit ?? '') ||
  cordisManifest.upstream?.license !== 'MIT' ||
  !Array.isArray(cordisManifest.packages)
) {
  findings.push('Invalid third_party/cordis-upstream.json');
}

let cordisFiles = 0;
for (const packageEntry of cordisManifest.packages ?? []) {
  if (
    typeof packageEntry.name !== 'string' ||
    typeof packageEntry.version !== 'string' ||
    typeof packageEntry.sourcePath !== 'string' ||
    typeof packageEntry.target !== 'string' ||
    typeof packageEntry.npmIntegrity !== 'string' ||
    !Array.isArray(packageEntry.files)
  ) {
    findings.push(`Invalid Cordis package entry: ${packageEntry.name ?? '(missing name)'}`);
    continue;
  }
  const packageRoot = path.join(root, packageEntry.target);
  const expectedFiles = packageEntry.files.map((entry) => entry.path).sort();
  const actualFiles = await listFiles(packageRoot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    const missing = expectedFiles.filter((file) => !actualFiles.includes(file));
    const extra = actualFiles.filter((file) => !expectedFiles.includes(file));
    if (missing.length)
      findings.push(`Missing Cordis files in ${packageEntry.name}: ${missing.join(', ')}`);
    if (extra.length)
      findings.push(`Unregistered Cordis files in ${packageEntry.name}: ${extra.join(', ')}`);
  }
  for (const entry of packageEntry.files) {
    if (typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      findings.push(
        `Invalid Cordis file entry: ${packageEntry.name}/${entry.path ?? '(missing path)'}`,
      );
      continue;
    }
    const contents = await readFile(path.join(packageRoot, entry.path));
    if (createHash('sha256').update(contents).digest('hex') !== entry.sha256) {
      findings.push(`Cordis snapshot digest mismatch: ${packageEntry.target}/${entry.path}`);
    }
  }
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (packageJson.name !== packageEntry.name || packageJson.version !== packageEntry.version) {
    findings.push(`Cordis package identity mismatch: ${packageEntry.name}@${packageEntry.version}`);
  }
  cordisFiles += packageEntry.files.length;
}

if (findings.length > 0) throw new Error(findings.join('\n'));
process.stdout.write(
  `Verified ${manifest.files.length} Comet-derived files and ${cordisFiles} immutable Cordis files\n`,
);
