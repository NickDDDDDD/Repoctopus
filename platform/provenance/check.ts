import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface ProvenanceEntry {
  source: string;
  sourceSha256: string;
  target: string;
  sha256: string;
  adoption: 'copied' | 'modified';
}

interface ProvenanceManifest {
  schemaVersion: number;
  upstream?: { commit?: string };
  files?: ProvenanceEntry[];
}

interface ImmutablePackageManifest {
  name: string;
  version: string;
  target: string;
  files: Array<{ path: string; sha256: string }>;
}

interface CordisManifest {
  schemaVersion: number;
  upstream?: { commit?: string; license?: string };
  packages?: ImmutablePackageManifest[];
}

interface DshAdoptionManifest {
  schemaVersion: number;
  upstream?: { commit?: string; license?: string };
  npmPackages?: Array<{ name: string; version: string }>;
  forbiddenRuntimePackages?: string[];
  components?: Array<{
    id?: string;
    target?: string;
    sourceSha256?: string;
    targetSha256?: string;
  }>;
}

export interface ProvenanceCheck {
  valid: boolean;
  fileCount: number;
  findings: string[];
}

export async function checkProvenance(
  productRoot: string,
  upstreamRoot?: string,
): Promise<ProvenanceCheck> {
  const findings: string[] = [];
  const manifestPath = path.join(productRoot, 'third_party', 'comet', 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ProvenanceManifest;
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.upstream?.commit ||
    !Array.isArray(manifest.files)
  ) {
    return { valid: false, fileCount: 0, findings: ['Invalid provenance manifest header'] };
  }

  for (const entry of manifest.files) {
    if (
      typeof entry.source !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
      typeof entry.target !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !['copied', 'modified'].includes(entry.adoption)
    ) {
      findings.push(`Invalid provenance entry: ${entry.target || '(missing target)'}`);
      continue;
    }
    const target = await readFile(path.join(productRoot, entry.target));
    const targetHash = createHash('sha256').update(target).digest('hex');
    if (targetHash !== entry.sha256) findings.push(`Target digest mismatch: ${entry.target}`);
    if (upstreamRoot) {
      const source = await readFile(path.join(upstreamRoot, entry.source));
      const sourceHash = createHash('sha256').update(source).digest('hex');
      if (sourceHash !== entry.sourceSha256)
        findings.push(`Source digest mismatch: ${entry.source}`);
    }
  }
  const cordisPath = path.join(productRoot, 'third_party', 'cordis-upstream.json');
  const cordis = JSON.parse(await readFile(cordisPath, 'utf8')) as CordisManifest;
  if (
    cordis.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(cordis.upstream?.commit ?? '') ||
    cordis.upstream?.license !== 'MIT' ||
    !Array.isArray(cordis.packages)
  ) {
    findings.push('Invalid Cordis provenance manifest header');
    return {
      valid: false,
      fileCount: manifest.files.length,
      findings,
    };
  }

  let cordisFiles = 0;
  for (const packageEntry of cordis.packages) {
    const packageRoot = path.join(productRoot, packageEntry.target);
    const expected = packageEntry.files.map((entry) => entry.path).sort();
    const actual = await listFiles(packageRoot);
    for (const missing of expected.filter((file) => !actual.includes(file))) {
      findings.push(`Missing Cordis file: ${packageEntry.target}/${missing}`);
    }
    for (const extra of actual.filter((file) => !expected.includes(file))) {
      findings.push(`Unregistered Cordis file: ${packageEntry.target}/${extra}`);
    }
    for (const entry of packageEntry.files) {
      const contents = await readFile(path.join(packageRoot, entry.path));
      const digest = createHash('sha256').update(contents).digest('hex');
      if (digest !== entry.sha256) {
        findings.push(`Cordis snapshot digest mismatch: ${packageEntry.target}/${entry.path}`);
      }
    }
    const packageJson = JSON.parse(
      await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { name?: string; version?: string };
    if (packageJson.name !== packageEntry.name || packageJson.version !== packageEntry.version) {
      findings.push(
        `Cordis package identity mismatch: ${packageEntry.name}@${packageEntry.version}`,
      );
    }
    cordisFiles += packageEntry.files.length;
  }

  const mattPath = path.join(productRoot, 'third_party', 'matt-skills', 'source-manifest.json');
  const matt = JSON.parse(await readFile(mattPath, 'utf8')) as ProvenanceManifest & {
    upstream?: { commit?: string; license?: string };
  };
  if (
    matt.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(matt.upstream?.commit ?? '') ||
    matt.upstream?.license !== 'MIT' ||
    !Array.isArray(matt.files)
  ) {
    findings.push('Invalid Matt Skill provenance manifest header');
  }
  const mattRoot = path.join(productRoot, 'third_party', 'matt-skills');
  const expectedMattFiles = [
    'source-manifest.json',
    ...(matt.files ?? []).map((entry) =>
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
  for (const entry of matt.files ?? []) {
    const contents = await readFile(path.join(productRoot, entry.target));
    const digest = createHash('sha256').update(contents).digest('hex');
    if (digest !== entry.sha256 || digest !== entry.sourceSha256) {
      findings.push(`Matt Skill snapshot digest mismatch: ${entry.target}`);
    }
  }

  const dshPath = path.join(productRoot, 'third_party', 'dsh-adoption.json');
  const dsh = JSON.parse(await readFile(dshPath, 'utf8')) as DshAdoptionManifest;
  if (
    dsh.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(dsh.upstream?.commit ?? '') ||
    dsh.upstream?.license !== 'MIT' ||
    !Array.isArray(dsh.npmPackages) ||
    !Array.isArray(dsh.forbiddenRuntimePackages) ||
    !Array.isArray(dsh.components)
  ) {
    findings.push('Invalid DSH adoption manifest header');
  }
  const packageJson = JSON.parse(
    await readFile(path.join(productRoot, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  const packageLock = JSON.parse(
    await readFile(path.join(productRoot, 'package-lock.json'), 'utf8'),
  ) as {
    packages?: Record<string, { version?: string; integrity?: string }>;
  };
  for (const packageEntry of dsh.npmPackages ?? []) {
    if (packageJson.dependencies?.[packageEntry.name] !== packageEntry.version) {
      findings.push(
        `DSH package is not an exact direct dependency: ${packageEntry.name}@${packageEntry.version}`,
      );
    }
    if (packageJson.overrides?.[packageEntry.name] !== packageEntry.version) {
      findings.push(
        `DSH package override is not fixed: ${packageEntry.name}@${packageEntry.version}`,
      );
    }
    const locked = packageLock.packages?.[`node_modules/${packageEntry.name}`];
    if (locked?.version !== packageEntry.version || !/^sha512-/.test(locked.integrity ?? '')) {
      findings.push(`DSH package lock mismatch: ${packageEntry.name}@${packageEntry.version}`);
    }
  }
  for (const packageName of dsh.forbiddenRuntimePackages ?? []) {
    if (packageLock.packages?.[`node_modules/${packageName}`]) {
      findings.push(`Forbidden DSH runtime package installed: ${packageName}`);
    }
  }
  for (const component of dsh.components ?? []) {
    if (!component.target) continue;
    if (
      !/^[a-f0-9]{64}$/.test(component.sourceSha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(component.targetSha256 ?? '')
    ) {
      findings.push(`Invalid DSH adapted component digest: ${component.id ?? '(missing id)'}`);
      continue;
    }
    const contents = await readFile(path.join(productRoot, component.target));
    if (createHash('sha256').update(contents).digest('hex') !== component.targetSha256) {
      findings.push(`DSH adapted target digest mismatch: ${component.target}`);
    }
  }

  return {
    valid: findings.length === 0,
    fileCount: manifest.files.length + cordisFiles + (matt.files?.length ?? 0),
    findings,
  };
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listFiles(absolute, relative)));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}
