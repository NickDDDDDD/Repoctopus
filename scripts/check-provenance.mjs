import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { validateCometProvenance } from './provenance/comet.mjs';

const root = path.resolve(import.meta.dirname, '..');
const findings = [];
const manifestPath = path.join(root, 'third_party', 'comet', 'source-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
findings.push(...validateCometProvenance(manifest, packageJson, packageLock));
for (const entry of manifest.files ?? []) {
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
for (const reference of manifest.references ?? []) {
  if (process.env.COMET_UPSTREAM_ROOT) {
    const source = await readFile(path.join(process.env.COMET_UPSTREAM_ROOT, reference.source));
    if (createHash('sha256').update(source).digest('hex') !== reference.sourceSha256) {
      findings.push(`Comet behavioral reference digest mismatch: ${reference.source}`);
    }
  }
}

const mattManifestPath = path.join(root, 'third_party', 'matt-skills', 'source-manifest.json');
const mattManifest = JSON.parse(await readFile(mattManifestPath, 'utf8'));
const mattAdoptionPath = path.join(root, 'third_party', 'matt-skills', 'method-adoptions.json');
const mattAdoption = JSON.parse(await readFile(mattAdoptionPath, 'utf8'));
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
  'method-adoptions.json',
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
  if (process.env.MATT_SKILLS_UPSTREAM_ROOT) {
    const source = await readFile(path.join(process.env.MATT_SKILLS_UPSTREAM_ROOT, entry.source));
    if (createHash('sha256').update(source).digest('hex') !== entry.sourceSha256) {
      findings.push(`Matt Skill source digest mismatch: ${entry.source}`);
    }
  }
}
if (
  mattAdoption.schemaVersion !== 1 ||
  mattAdoption.upstream?.repository !== mattManifest.upstream?.repository ||
  mattAdoption.upstream?.commit !== mattManifest.upstream?.commit ||
  mattAdoption.upstream?.license !== mattManifest.upstream?.license ||
  !Array.isArray(mattAdoption.providerRoots) ||
  !Array.isArray(mattAdoption.executableSkills) ||
  !Array.isArray(mattAdoption.relationships) ||
  !Array.isArray(mattAdoption.references) ||
  !Array.isArray(mattAdoption.rules) ||
  !Array.isArray(mattAdoption.reviewedMethods)
) {
  findings.push('Invalid Matt method adoption manifest header');
}
const providerRoots = mattAdoption.providerRoots ?? [];
const expectedProviderRoots = [
  'third_party/matt-skills/skills/engineering',
  'third_party/matt-skills/skills/productivity',
];
if (
  JSON.stringify([...providerRoots].sort()) !== JSON.stringify([...expectedProviderRoots].sort())
) {
  findings.push('Matt method adoption Provider roots do not match the builtin Provider');
}
const mattFilesByTarget = new Map((mattManifest.files ?? []).map((entry) => [entry.target, entry]));
const isInProviderRoot = (target) =>
  providerRoots.some(
    (providerRoot) => target === providerRoot || target.startsWith(`${providerRoot}/`),
  );
const requiredExecutableSkills = new Set(['codebase-design', 'pr', 'tdd']);
const executableSkillNames = new Set();
for (const skill of mattAdoption.executableSkills ?? []) {
  if (typeof skill.name === 'string') requiredExecutableSkills.delete(skill.name);
  const sourceEntry =
    typeof skill.target === 'string' ? mattFilesByTarget.get(skill.target) : undefined;
  if (
    typeof skill.name !== 'string' ||
    executableSkillNames.has(skill.name) ||
    typeof skill.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(skill.sourceSha256 ?? '') ||
    typeof skill.target !== 'string' ||
    !isInProviderRoot(skill.target) ||
    sourceEntry?.source !== skill.source ||
    sourceEntry?.sourceSha256 !== skill.sourceSha256
  ) {
    findings.push(`Invalid Matt executable Skill adoption: ${skill.name ?? '(missing name)'}`);
  }
  if (typeof skill.name === 'string') executableSkillNames.add(skill.name);
}
for (const name of requiredExecutableSkills) {
  findings.push(`Missing Matt executable Skill adoption: ${name}`);
}
if (
  !(mattAdoption.relationships ?? []).some(
    (entry) =>
      entry.from === 'tdd' &&
      entry.to === 'codebase-design' &&
      entry.kind === 'conditional-reference' &&
      typeof entry.trigger === 'string' &&
      entry.trigger.length > 0,
  )
) {
  findings.push('Missing Matt Skill relationship: tdd -> codebase-design');
}
const rulesById = new Map();
for (const rule of mattAdoption.rules ?? []) {
  if (
    typeof rule.id !== 'string' ||
    rulesById.has(rule.id) ||
    !Array.isArray(rule.sources) ||
    rule.sources.length === 0 ||
    typeof rule.statement !== 'string' ||
    rule.statement.length === 0
  ) {
    findings.push(`Invalid Matt adopted rule: ${rule.id ?? '(missing id)'}`);
    continue;
  }
  rulesById.set(rule.id, rule);
}
const requiredReferences = new Set(['to-spec', 'to-tickets']);
const referenceNames = new Set();
const requiredRejectedBehaviors = {
  'to-spec': ['publish-spec-to-issue-tracker', 'replace-openspec-artifact-template'],
  'to-tickets': [
    'write-local-ticket-files',
    'publish-tickets-to-issue-tracker',
    'create-secondary-ticket-authority',
  ],
};
for (const reference of mattAdoption.references ?? []) {
  if (typeof reference.name === 'string') requiredReferences.delete(reference.name);
  const sourceEntry =
    typeof reference.target === 'string' ? mattFilesByTarget.get(reference.target) : undefined;
  if (
    typeof reference.name !== 'string' ||
    referenceNames.has(reference.name) ||
    reference.status !== 'behavior-reference-only' ||
    typeof reference.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reference.sourceSha256 ?? '') ||
    typeof reference.target !== 'string' ||
    !reference.target.startsWith('third_party/matt-skills/references/') ||
    !/^[a-f0-9]{64}$/.test(reference.targetSha256 ?? '') ||
    sourceEntry?.source !== reference.source ||
    sourceEntry?.sourceSha256 !== reference.sourceSha256 ||
    sourceEntry?.sha256 !== reference.targetSha256 ||
    !Array.isArray(reference.adoptedRuleIds) ||
    reference.adoptedRuleIds.length === 0 ||
    !Array.isArray(reference.rejectedBehaviors) ||
    reference.rejectedBehaviors.length === 0
  ) {
    findings.push(`Invalid Matt behavior reference: ${reference.name ?? '(missing name)'}`);
    continue;
  }
  referenceNames.add(reference.name);
  if (isInProviderRoot(reference.target)) {
    findings.push(`Matt behavior reference is inside a Provider root: ${reference.name}`);
  }
  for (const ruleId of reference.adoptedRuleIds) {
    const rule = rulesById.get(ruleId);
    if (!rule) findings.push(`Unknown Matt adopted rule: ${ruleId}`);
    else if (!rule.sources?.includes(reference.name)) {
      findings.push(`Matt adopted rule source mismatch: ${reference.name} -> ${ruleId}`);
    }
  }
  for (const behavior of requiredRejectedBehaviors[reference.name] ?? []) {
    if (!reference.rejectedBehaviors.includes(behavior)) {
      findings.push(`Missing rejected Matt behavior: ${reference.name} -> ${behavior}`);
    }
  }
}
for (const name of requiredReferences) findings.push(`Missing Matt behavior reference: ${name}`);
const requiredReviewedMethods = new Set([
  'research',
  'prototype',
  'domain-modeling',
  'writing-for-agents',
  'retro',
]);
const reviewedMethodNames = new Set();
const expectedReviewedDecisions = {
  research: 'deferred-executable',
  prototype: 'deferred-executable',
  'domain-modeling': 'conditional-executable',
  'writing-for-agents': 'planned-method-profile',
  retro: 'deferred-post-change',
};
for (const method of mattAdoption.reviewedMethods ?? []) {
  if (typeof method.name === 'string') requiredReviewedMethods.delete(method.name);
  if (
    typeof method.name !== 'string' ||
    reviewedMethodNames.has(method.name) ||
    typeof method.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(method.sourceSha256 ?? '') ||
    method.decision !== expectedReviewedDecisions[method.name] ||
    typeof method.condition !== 'string' ||
    method.condition.length === 0 ||
    typeof method.reason !== 'string' ||
    method.reason.length === 0
  ) {
    findings.push(`Invalid Matt reviewed method decision: ${method.name ?? '(missing name)'}`);
  }
  if (typeof method.name === 'string') reviewedMethodNames.add(method.name);
  if (
    process.env.MATT_SKILLS_UPSTREAM_ROOT &&
    typeof method.source === 'string' &&
    /^[a-f0-9]{64}$/.test(method.sourceSha256 ?? '')
  ) {
    const source = await readFile(path.join(process.env.MATT_SKILLS_UPSTREAM_ROOT, method.source));
    if (createHash('sha256').update(source).digest('hex') !== method.sourceSha256) {
      findings.push(`Matt reviewed method source digest mismatch: ${method.source}`);
    }
  }
}
for (const name of requiredReviewedMethods) {
  findings.push(`Missing Matt reviewed method decision: ${name}`);
}

const dshAdoptionPath = path.join(root, 'third_party', 'dsh-adoption.json');
const dshAdoption = JSON.parse(await readFile(dshAdoptionPath, 'utf8'));
if (
  dshAdoption.schemaVersion !== 1 ||
  !/^[a-f0-9]{40}$/.test(dshAdoption.upstream?.commit ?? '') ||
  dshAdoption.upstream?.license !== 'MIT' ||
  !Array.isArray(dshAdoption.npmPackages) ||
  !Array.isArray(dshAdoption.desktopDependencies) ||
  typeof dshAdoption.desktopBinaryPreparation !== 'object' ||
  !Array.isArray(dshAdoption.desktopReferenceSurface) ||
  !Array.isArray(dshAdoption.desktopInstallScripts) ||
  !Array.isArray(dshAdoption.components) ||
  !Array.isArray(dshAdoption.forbiddenRuntimePackages)
) {
  findings.push('Invalid third_party/dsh-adoption.json');
}
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
for (const entry of dshAdoption.desktopDependencies ?? []) {
  if (
    typeof entry.name !== 'string' ||
    typeof entry.version !== 'string' ||
    entry.license !== 'MIT'
  ) {
    findings.push(`Invalid DSH desktop dependency entry: ${entry.name ?? '(missing name)'}`);
    continue;
  }
  if (packageJson.devDependencies?.[entry.name] !== entry.version) {
    findings.push(
      `DSH desktop dependency is not an exact devDependency: ${entry.name}@${entry.version}`,
    );
  }
  const locked = packageLock.packages?.[`node_modules/${entry.name}`];
  if (
    locked?.version !== entry.version ||
    locked?.license !== entry.license ||
    !/^sha512-/.test(locked.integrity ?? '')
  ) {
    findings.push(`DSH desktop dependency lock mismatch: ${entry.name}@${entry.version}`);
  }
}
const desktopBinary = dshAdoption.desktopBinaryPreparation;
const electronDependency = (dshAdoption.desktopDependencies ?? []).find(
  (entry) => entry.name === 'electron',
);
if (
  desktopBinary?.package !== 'electron' ||
  desktopBinary?.version !== electronDependency?.version ||
  desktopBinary?.acquisition !== 'lazy-package-resolution' ||
  desktopBinary?.command !== 'npm run desktop:prepare' ||
  packageJson.scripts?.['desktop:prepare'] !== 'node scripts/prepare-desktop.mjs'
) {
  findings.push('Invalid Electron binary preparation policy');
}
await readFile(path.join(root, 'scripts', 'prepare-desktop.mjs')).catch(() => {
  findings.push('Missing Electron binary preparation command');
});
const electronScriptKey = `electron@${electronDependency?.version ?? '(missing version)'}`;
if (Object.hasOwn(packageJson.allowScripts ?? {}, electronScriptKey)) {
  findings.push(
    `Electron binary acquisition must not be modeled as an install script: ${electronScriptKey}`,
  );
}
for (const reference of dshAdoption.desktopReferenceSurface ?? []) {
  if (
    typeof reference.source !== 'string' ||
    !/^[a-f0-9]{64}$/.test(reference.sourceSha256 ?? '') ||
    typeof reference.role !== 'string' ||
    reference.role.length === 0
  ) {
    findings.push(`Invalid DSH desktop reference: ${reference.source ?? '(missing source)'}`);
    continue;
  }
  if (process.env.DSH_UPSTREAM_ROOT) {
    const source = await readFile(path.join(process.env.DSH_UPSTREAM_ROOT, reference.source));
    if (createHash('sha256').update(source).digest('hex') !== reference.sourceSha256) {
      findings.push(`DSH desktop reference digest mismatch: ${reference.source}`);
    }
  }
}
for (const entry of dshAdoption.desktopInstallScripts ?? []) {
  if (
    typeof entry.name !== 'string' ||
    typeof entry.version !== 'string' ||
    typeof entry.allowed !== 'boolean'
  ) {
    findings.push(`Invalid desktop install script policy: ${entry.name ?? '(missing name)'}`);
    continue;
  }
  const key = `${entry.name}@${entry.version}`;
  if (packageJson.allowScripts?.[key] !== entry.allowed) {
    findings.push(`Desktop install script policy mismatch: ${key}`);
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
  const locked = packageLock.packages?.[`node_modules/${packageEntry.name}`];
  if (
    packageJson.dependencies?.[packageEntry.name] !== packageEntry.version ||
    locked?.link ||
    locked?.version !== packageEntry.version ||
    locked?.integrity !== packageEntry.npmIntegrity
  ) {
    findings.push(
      `Cordis npm dependency does not match its fixed provenance: ${packageEntry.name}`,
    );
  }
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
  const snapshotPackage = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  if (
    snapshotPackage.name !== packageEntry.name ||
    snapshotPackage.version !== packageEntry.version
  ) {
    findings.push(`Cordis package identity mismatch: ${packageEntry.name}@${packageEntry.version}`);
  }
  cordisFiles += packageEntry.files.length;
}

const upstreamBaselines = JSON.parse(
  await readFile(path.join(root, 'third_party', 'upstream-baselines.json'), 'utf8'),
);
if (
  upstreamBaselines.schemaVersion !== 2 ||
  !Array.isArray(upstreamBaselines.upstreams) ||
  upstreamBaselines.upstreams.some(
    (entry) =>
      !/^[a-f0-9]{40}$/u.test(entry.auditedBranchCommit ?? '') ||
      !/^[a-f0-9]{40}$/u.test(entry.pinnedTagCommit ?? ''),
  )
) {
  findings.push('Invalid third_party/upstream-baselines.json');
} else {
  const dshBaseline = upstreamBaselines.upstreams.find((entry) => entry.id === 'dsh');
  const cometBaseline = upstreamBaselines.upstreams.find((entry) => entry.id === 'comet');
  if (
    dshBaseline?.pinnedTagCommit !== dshAdoption.upstream.commit ||
    dshBaseline?.pinnedTagCommit !== cordisManifest.upstream.commit
  ) {
    findings.push('DSH baseline disagrees with DSH or Cordis provenance');
  }
  if (cometBaseline?.pinnedTagCommit !== manifest.upstream.commit) {
    findings.push('Comet baseline disagrees with Comet provenance');
  }
}

if (findings.length > 0) throw new Error(findings.join('\n'));
process.stdout.write(
  `Verified ${manifest.files.length} Comet-derived files, ${cordisFiles} immutable Cordis files, ${mattManifest.files.length} Matt Skill files, ${dshAdoption.npmPackages.length} fixed DSH packages, and ${dshAdoption.desktopReferenceSurface.length} DSH desktop references\n`,
);
