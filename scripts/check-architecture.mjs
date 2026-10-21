import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { evaluateSourceBoundaries } from './architecture-source-boundaries.mjs';

const root = path.resolve(import.meta.dirname, '..');
const policy = JSON.parse(
  await readFile(path.join(root, 'scripts', 'architecture-governance.json'), 'utf8'),
);
const findings = [];

function portable(value) {
  return value.replaceAll('\\', '/');
}

async function filesUnder(relative) {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = portable(path.join(relative, entry.name));
    if (entry.isDirectory()) files.push(...(await filesUnder(child)));
    else files.push(child);
  }
  return files;
}

function matches(target, pattern) {
  return pattern.endsWith('/**') ? target.startsWith(pattern.slice(0, -2)) : target === pattern;
}

if (policy.schemaVersion !== 1 || !Array.isArray(policy.capabilities)) {
  findings.push('Invalid architecture governance policy');
}

const productionSources = (
  await Promise.all(policy.reviewedSourceRoots.map((directory) => filesUnder(directory)))
)
  .flat()
  .filter((file) => /\.tsx?$/u.test(file))
  .sort();
const productionSourceContents = await Promise.all(
  productionSources.map(async (source) => ({
    path: source,
    contents: await readFile(path.join(root, source), 'utf8'),
  })),
);

for (const source of productionSources) {
  const owners = policy.capabilities.filter((capability) =>
    capability.targets.some((target) => matches(source, target)),
  );
  if (owners.length !== 1) {
    findings.push(
      `${source}: expected exactly one capability owner, found ${owners.map((item) => item.id).join(', ') || 'none'}`,
    );
  }
}

const allowedDispositions = new Set([
  'source-modified',
  'behavior-reimplemented',
  'repoctopus-native',
]);
for (const capability of policy.capabilities) {
  if (!allowedDispositions.has(capability.disposition)) {
    findings.push(`${capability.id}: unknown disposition ${capability.disposition}`);
  }
  if (!capability.rationale || !Array.isArray(capability.upstream)) {
    findings.push(`${capability.id}: missing rationale or upstream review`);
  }
  for (const target of capability.targets) {
    if (target.endsWith('/**')) continue;
    try {
      await readFile(path.join(root, target));
    } catch {
      findings.push(`${capability.id}: missing target ${target}`);
    }
  }
}

const sourceManifest = JSON.parse(
  await readFile(path.join(root, 'third_party', 'comet', 'source-manifest.json'), 'utf8'),
);
for (const entry of sourceManifest.files) {
  const owner = policy.capabilities.find((capability) =>
    capability.targets.some((target) => matches(entry.target, target)),
  );
  if (!owner || owner.disposition !== 'source-modified') {
    findings.push(`${entry.target}: provenance entry is not owned by a source-modified capability`);
  }
}

const legacy = policy.legacyWorkflow;
const excluded = new Set(legacy.excludedTargets);
for (const forbidden of legacy.forbiddenPaths) {
  try {
    await lstat(path.join(root, forbidden));
    findings.push(`${forbidden}: legacy workflow path must not exist in Repoctopus`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
for (const target of legacy.scanTargets) {
  let files;
  try {
    const absolute = path.join(root, target);
    files = (await readdir(absolute, { withFileTypes: true }).catch(() => null))
      ? await filesUnder(target)
      : [target];
  } catch {
    continue;
  }
  for (const file of files.filter((item) => !excluded.has(item))) {
    if (!/\.(?:js|mjs|ts|json|md|ya?ml)$/iu.test(file)) continue;
    const source = await readFile(path.join(root, file), 'utf8');
    for (const configured of legacy.forbiddenPatterns) {
      const caseSensitive = configured.startsWith('CASE:');
      const pattern = caseSensitive ? configured.slice('CASE:'.length) : configured;
      const flags = caseSensitive ? 'u' : 'iu';
      if (new RegExp(pattern, flags).test(source)) {
        findings.push(`${file}: contains legacy workflow marker /${pattern}/${flags}`);
      }
    }
  }
}

const transitionPolicyFiles = new Set(policy.stateTransitionModels.flatMap((model) => model.files));
for (const source of productionSources) {
  const contents = await readFile(path.join(root, source), 'utf8');
  if (/transition\.json|journal\.jsonl|interface\s+\w*Journal/u.test(contents)) {
    if (!transitionPolicyFiles.has(source)) {
      findings.push(`${source}: introduces an unregistered state transition or Journal model`);
    }
  }
}

for (const binding of policy.protectedEvidenceFlow?.requiredBindings ?? []) {
  const source = await readFile(path.join(root, binding.file), 'utf8').catch(() => null);
  if (source === null) {
    findings.push(`${binding.file}: protected Evidence binding file is missing`);
    continue;
  }
  for (const pattern of binding.patterns) {
    if (!source.includes(pattern)) {
      findings.push(`${binding.file}: protected Evidence binding is missing '${pattern}'`);
    }
  }
}

for (const restriction of policy.protectedEvidenceFlow?.restrictedCalls ?? []) {
  const expression = new RegExp(restriction.pattern, 'u');
  for (const source of productionSources) {
    const contents = await readFile(path.join(root, source), 'utf8');
    if (expression.test(contents) && !restriction.allowed.includes(source)) {
      findings.push(`${source}: restricted Runtime transition call /${restriction.pattern}/`);
    }
  }
}

for (const guard of policy.compositionGuards ?? []) {
  const expression = new RegExp(guard.pattern, 'u');
  for (const source of productionSources) {
    const contents = await readFile(path.join(root, source), 'utf8');
    if (expression.test(contents) && !guard.allowed.includes(source)) {
      findings.push(`${source}: forbidden composition root /${guard.pattern}/`);
    }
  }
}

findings.push(...evaluateSourceBoundaries(productionSourceContents, policy.sourceBoundaries));

if (findings.length > 0) throw new Error(findings.join('\n'));
process.stdout.write(
  `Verified ${productionSources.length} production sources, ${policy.capabilities.length} capability owners, protected source boundaries, Evidence flow, and legacy workflow isolation\n`,
);
