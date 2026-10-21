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

const mattManifestPath = path.join(root, 'third_party', 'matt-skills', 'source-manifest.json');
const mattManifest = JSON.parse(await readFile(mattManifestPath, 'utf8'));
if (
  mattManifest.schemaVersion !== 1 ||
  !/^[a-f0-9]{40}$/.test(mattManifest.upstream?.commit ?? '') ||
  mattManifest.upstream?.license !== 'MIT' ||
  !Array.isArray(mattManifest.files)
) {
  findings.push('Invalid third_party/matt-skills/source-manifest.json');
}
const mattRoot = path.join(root, 'third_party', 'matt-skills');
const expectedMattFiles = [
  'source-manifest.json',
  ...(mattManifest.files ?? []).map((entry) =>
    path.relative('third_party/matt-skills', entry.target).replaceAll('\\', '/'),
  ),
].sort();
const actualMattFiles = await listFiles(mattRoot);
for (const missing of expectedMattFiles.filter((file) => !actualMattFiles.includes(file))) {
  findings.push(`Missing Matt Skill file: ${missing}`);
}
for (const extra of actualMattFiles.filter((file) => !expectedMattFiles.includes(file))) {
  findings.push(`Unregistered Matt Skill file: ${extra}`);
}
for (const entry of mattManifest.files ?? []) {
  if (
    typeof entry.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.sourceSha256 ?? '') ||
    typeof entry.target !== 'string' ||
    !entry.target.startsWith('third_party/matt-skills/') ||
    !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') ||
    entry.adoption !== 'copied'
  ) {
    findings.push(`Invalid Matt Skill provenance entry: ${entry.target ?? '(missing target)'}`);
    continue;
  }
  const contents = await readFile(path.join(root, entry.target));
  const digest = createHash('sha256').update(contents).digest('hex');
  if (digest !== entry.sha256 || digest !== entry.sourceSha256) {
    findings.push(`Matt Skill snapshot digest mismatch: ${entry.target}`);
  }
}

const dshAdoptionPath = path.join(root, 'third_party', 'dsh-adoption.json');
const dshAdoption = JSON.parse(await readFile(dshAdoptionPath, 'utf8'));
if (
  dshAdoption.schemaVersion !== 1 ||
  !/^[a-f0-9]{40}$/.test(dshAdoption.upstream?.commit ?? '') ||
  dshAdoption.upstream?.license !== 'MIT' ||
  !Array.isArray(dshAdoption.npmPackages) ||
  !Array.isArray(dshAdoption.components) ||
  !Array.isArray(dshAdoption.forbiddenRuntimePackages)
) {
  findings.push('Invalid third_party/dsh-adoption.json');
}
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const entry of dshAdoption.npmPackages ?? []) {
  if (typeof entry.name !== 'string' || typeof entry.version !== 'string') {
    findings.push(`Invalid DSH package entry: ${entry.name ?? '(missing name)'}`);
    continue;
  }
  if (packageJson.dependencies?.[entry.name] !== entry.version) {
    findings.push(`DSH package is not an exact direct dependency: ${entry.name}@${entry.version}`);
  }
  if (packageJson.overrides?.[entry.name] !== entry.version) {
    findings.push(`DSH package override is not fixed: ${entry.name}@${entry.version}`);
  }
  const locked = packageLock.packages?.[`node_modules/${entry.name}`];
  if (locked?.version !== entry.version || !/^sha512-/.test(locked.integrity ?? '')) {
    findings.push(`DSH package lock mismatch: ${entry.name}@${entry.version}`);
  }
}
for (const packageName of dshAdoption.forbiddenRuntimePackages ?? []) {
  if (packageLock.packages?.[`node_modules/${packageName}`]) {
    findings.push(`Forbidden DSH runtime package installed: ${packageName}`);
  }
}
for (const component of dshAdoption.components ?? []) {
  if (!component.target) continue;
  if (
    !/^[a-f0-9]{64}$/.test(component.sourceSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(component.targetSha256 ?? '')
  ) {
    findings.push(`Invalid DSH adapted component digest: ${component.id ?? '(missing id)'}`);
    continue;
  }
  const contents = await readFile(path.join(root, component.target));
  if (createHash('sha256').update(contents).digest('hex') !== component.targetSha256) {
    findings.push(`DSH adapted target digest mismatch: ${component.target}`);
  }
  if (process.env.DSH_UPSTREAM_ROOT) {
    const source = await readFile(path.join(process.env.DSH_UPSTREAM_ROOT, component.source));
    if (createHash('sha256').update(source).digest('hex') !== component.sourceSha256) {
      findings.push(`DSH adapted source digest mismatch: ${component.source}`);
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

const upstreamBaselines = JSON.parse(
  await readFile(path.join(root, 'third_party', 'upstream-baselines.json'), 'utf8'),
);
if (upstreamBaselines.schemaVersion !== 1 || !Array.isArray(upstreamBaselines.upstreams)) {
  findings.push('Invalid third_party/upstream-baselines.json');
} else {
  const dshBaseline = upstreamBaselines.upstreams.find((entry) => entry.id === 'dsh');
  const cometBaseline = upstreamBaselines.upstreams.find((entry) => entry.id === 'comet');
  if (
    dshBaseline?.pinnedCommit !== dshAdoption.upstream.commit ||
    dshBaseline?.pinnedCommit !== cordisManifest.upstream.commit
  ) {
    findings.push('DSH baseline disagrees with DSH or Cordis provenance');
  }
  if (cometBaseline?.pinnedCommit !== manifest.upstream.commit) {
    findings.push('Comet baseline disagrees with Comet provenance');
  }
}

if (findings.length > 0) throw new Error(findings.join('\n'));
process.stdout.write(
  `Verified ${manifest.files.length} Comet-derived files, ${cordisFiles} immutable Cordis files, ${mattManifest.files.length} Matt Skill files, and ${dshAdoption.npmPackages.length} fixed DSH packages\n`,
);
