import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
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
  upstream?: { repository?: string; commit?: string; version?: string; license?: string };
  references?: Array<{
    role?: string;
    source?: string;
    sourceSha256?: string;
    adoption?: string;
  }>;
  files?: ProvenanceEntry[];
}

const REQUIRED_COMET_REFERENCES = new Map([
  ['host-design-decision', 'domains/comet-classic/classic-sdk-design.ts'],
  ['host-build-decision', 'domains/comet-classic/classic-sdk-build.ts'],
  ['host-archive-decision', 'domains/comet-classic/classic-sdk-archive-decision.ts'],
  ['revision-readiness', 'domains/comet-classic/classic-sdk-revision-readiness.ts'],
  ['revision-command', 'domains/comet-classic/classic-sdk-revision.ts'],
  ['revision-application', 'domains/comet-classic/classic-sdk-revision-application.ts'],
  ['evidence-invalidation', 'domains/engine/runtime-service.ts'],
  ['action-retry-policy', 'domains/engine/runtime-action.ts'],
  ['command-input-policy', 'domains/comet-classic/classic-check-policy.ts'],
  ['command-content-snapshot', 'domains/comet-classic/classic-check-snapshot.ts'],
  ['archive-evidence-preflight', 'domains/comet-classic/classic-sdk-archive-preflight.ts'],
  ['archive-frozen-publication', 'domains/comet-classic/classic-sdk-archive.ts'],
  ['archive-publication-outcome', 'domains/comet-classic/classic-sdk-application.ts'],
  ['completed-run-boundary', 'domains/engine/runtime-service.ts'],
  ['archived-change-selection', 'domains/comet-classic/classic-current-change.ts'],
  ['verify-repair-classification', 'domains/comet-native/native-sdk-verify-decision.ts'],
  ['classic-verify-plan-continuation', 'domains/comet-classic/classic-application.ts'],
]);

function isCometPackageReference(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return (
    /(^|[/@-])comet($|[/@-])/iu.test(value) ||
    /npm:(?:@[^/]+\/)?comet@/iu.test(value) ||
    /github\.com[/ :]rpamis[/ ]comet(?:\.git)?/iu.test(value)
  );
}

interface MattMethodAdoptionManifest {
  schemaVersion: number;
  upstream?: { repository?: string; commit?: string; license?: string };
  providerRoots?: string[];
  executableSkills?: Array<{
    name?: string;
    source?: string;
    sourceSha256?: string;
    target?: string;
  }>;
  relationships?: Array<{ from?: string; to?: string; kind?: string; trigger?: string }>;
  references?: Array<{
    name?: string;
    status?: string;
    source?: string;
    sourceSha256?: string;
    target?: string;
    targetSha256?: string;
    adoptedRuleIds?: string[];
    rejectedBehaviors?: string[];
  }>;
  rules?: Array<{ id?: string; sources?: string[]; statement?: string }>;
  reviewedMethods?: Array<{
    name?: string;
    source?: string;
    sourceSha256?: string;
    decision?: string;
    condition?: string;
    reason?: string;
  }>;
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
  desktopDependencies?: Array<{ name: string; version: string }>;
  desktopBinaryPreparation?: {
    package?: string;
    version?: string;
    acquisition?: string;
    command?: string;
  };
  desktopReferenceSurface?: Array<{ source?: string; sourceSha256?: string; role?: string }>;
  desktopInstallScripts?: Array<{ name?: string; version?: string; allowed?: boolean }>;
  forbiddenRuntimePackages?: string[];
  components?: Array<{
    id?: string;
    target?: string;
    sourceSha256?: string;
    targetSha256?: string;
  }>;
}

interface UpstreamBaselineManifest {
  schemaVersion: number;
  upstreams?: Array<{
    id?: string;
    auditedBranchCommit?: string;
    pinnedTagCommit?: string;
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
    manifest.schemaVersion !== 2 ||
    manifest.upstream?.repository !== 'https://github.com/rpamis/comet.git' ||
    !/^[a-f0-9]{40}$/u.test(manifest.upstream?.commit ?? '') ||
    manifest.upstream?.version !== '0.5.1' ||
    manifest.upstream?.license !== 'MIT' ||
    !Array.isArray(manifest.references) ||
    !Array.isArray(manifest.files)
  ) {
    return { valid: false, fileCount: 0, findings: ['Invalid provenance manifest header'] };
  }

  const seenCometReferences = new Set<string>();
  for (const reference of manifest.references) {
    if (
      typeof reference.role !== 'string' ||
      !REQUIRED_COMET_REFERENCES.has(reference.role) ||
      seenCometReferences.has(reference.role) ||
      reference.source !== REQUIRED_COMET_REFERENCES.get(reference.role) ||
      !/^[a-f0-9]{64}$/u.test(reference.sourceSha256 ?? '') ||
      reference.adoption !== 'behavioral-reference'
    ) {
      findings.push(
        `Invalid Comet behavioral reference source or digest: ${reference.role ?? '(missing role)'}`,
      );
      continue;
    }
    seenCometReferences.add(reference.role);
  }
  for (const role of REQUIRED_COMET_REFERENCES.keys()) {
    if (!seenCometReferences.has(role))
      findings.push(`Missing Comet behavioral reference: ${role}`);
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
  const matt = JSON.parse(await readFile(mattPath, 'utf8')) as ProvenanceManifest;
  const mattAdoptionPath = path.join(
    productRoot,
    'third_party',
    'matt-skills',
    'method-adoptions.json',
  );
  const mattAdoption = JSON.parse(
    await readFile(mattAdoptionPath, 'utf8'),
  ) as MattMethodAdoptionManifest;
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
    'method-adoptions.json',
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
  if (
    mattAdoption.schemaVersion !== 1 ||
    mattAdoption.upstream?.repository !== matt.upstream?.repository ||
    mattAdoption.upstream?.commit !== matt.upstream?.commit ||
    mattAdoption.upstream?.license !== matt.upstream?.license ||
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
  const mattFilesByTarget = new Map((matt.files ?? []).map((entry) => [entry.target, entry]));
  const isInProviderRoot = (target: string): boolean =>
    providerRoots.some((root) => target === root || target.startsWith(`${root}/`));
  const requiredExecutableSkills = new Set(['codebase-design', 'grilling', 'pr', 'tdd']);
  const executableSkillNames = new Set<string>();
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
      sourceEntry.sourceSha256 !== skill.sourceSha256
    ) {
      findings.push(`Invalid Matt executable Skill adoption: ${skill.name ?? '(missing name)'}`);
    }
    if (typeof skill.name === 'string') executableSkillNames.add(skill.name);
  }
  for (const name of requiredExecutableSkills) {
    findings.push(`Missing Matt executable Skill adoption: ${name}`);
  }
  const hasTddDependency = (mattAdoption.relationships ?? []).some(
    (entry) =>
      entry.from === 'tdd' &&
      entry.to === 'codebase-design' &&
      entry.kind === 'conditional-reference' &&
      typeof entry.trigger === 'string' &&
      entry.trigger.length > 0,
  );
  if (!hasTddDependency) {
    findings.push('Missing Matt Skill relationship: tdd -> codebase-design');
  }
  const rulesById = new Map<string, { sources?: string[] }>();
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
  const referenceNames = new Set<string>();
  const requiredRejectedBehaviors: Record<string, string[]> = {
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
      sourceEntry.sourceSha256 !== reference.sourceSha256 ||
      sourceEntry.sha256 !== reference.targetSha256 ||
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
  for (const name of requiredReferences) {
    findings.push(`Missing Matt behavior reference: ${name}`);
  }
  const requiredReviewedMethods = new Set([
    'research',
    'prototype',
    'domain-modeling',
    'writing-for-agents',
    'retro',
  ]);
  const reviewedMethodNames = new Set<string>();
  const expectedReviewedDecisions: Record<string, string> = {
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
  }
  for (const name of requiredReviewedMethods) {
    findings.push(`Missing Matt reviewed method decision: ${name}`);
  }

  const dshPath = path.join(productRoot, 'third_party', 'dsh-adoption.json');
  const dsh = JSON.parse(await readFile(dshPath, 'utf8')) as DshAdoptionManifest;
  if (
    dsh.schemaVersion !== 1 ||
    !/^[a-f0-9]{40}$/.test(dsh.upstream?.commit ?? '') ||
    dsh.upstream?.license !== 'MIT' ||
    !Array.isArray(dsh.npmPackages) ||
    !Array.isArray(dsh.desktopDependencies) ||
    typeof dsh.desktopBinaryPreparation !== 'object' ||
    !Array.isArray(dsh.desktopReferenceSurface) ||
    !Array.isArray(dsh.desktopInstallScripts) ||
    !Array.isArray(dsh.forbiddenRuntimePackages) ||
    !Array.isArray(dsh.components)
  ) {
    findings.push('Invalid DSH adoption manifest header');
  }
  const packageJson = JSON.parse(
    await readFile(path.join(productRoot, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
    scripts?: Record<string, string>;
    allowScripts?: Record<string, boolean>;
  };
  // Runtime diagnoses the installed product. The CI source audit owns lockfiles,
  // transitive dependency integrity and development preparation resources.
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    for (const [name, spec] of Object.entries(packageJson[field] ?? {})) {
      if (isCometPackageReference(name) || isCometPackageReference(spec)) {
        findings.push(`Comet Runtime dependency is forbidden in ${field}: ${name}`);
      }
    }
  }
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
    try {
      const installed = await installedPackageManifest(productRoot, packageEntry.name);
      if (installed?.name !== packageEntry.name || installed.version !== packageEntry.version) {
        findings.push(
          `Installed DSH package identity mismatch: ${packageEntry.name}@${packageEntry.version}`,
        );
      }
    } catch (error) {
      findings.push(
        `Installed DSH package unavailable: ${packageEntry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const packageName of dsh.forbiddenRuntimePackages ?? []) {
    if (
      [
        packageJson.dependencies,
        packageJson.optionalDependencies,
        packageJson.peerDependencies,
      ].some((dependencies) => Object.hasOwn(dependencies ?? {}, packageName))
    ) {
      findings.push(`Forbidden DSH runtime package declared: ${packageName}`);
    }
  }
  const electronDependency = dsh.desktopDependencies?.find((entry) => entry.name === 'electron');
  const desktopBinary = dsh.desktopBinaryPreparation;
  if (
    desktopBinary?.package !== 'electron' ||
    desktopBinary.version !== electronDependency?.version ||
    desktopBinary.acquisition !== 'lazy-package-resolution' ||
    desktopBinary.command !== 'npm run desktop:prepare' ||
    packageJson.scripts?.['desktop:prepare'] !== 'node scripts/prepare-desktop.mjs'
  ) {
    findings.push('Invalid Electron binary preparation policy');
  }
  const electronScriptKey = `electron@${electronDependency?.version ?? '(missing version)'}`;
  if (Object.hasOwn(packageJson.allowScripts ?? {}, electronScriptKey)) {
    findings.push(
      `Electron binary acquisition must not be modeled as an install script: ${electronScriptKey}`,
    );
  }
  for (const reference of dsh.desktopReferenceSurface ?? []) {
    if (
      typeof reference.source !== 'string' ||
      !/^[a-f0-9]{64}$/.test(reference.sourceSha256 ?? '') ||
      typeof reference.role !== 'string' ||
      reference.role.length === 0
    ) {
      findings.push(`Invalid DSH desktop reference: ${reference.source ?? '(missing source)'}`);
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

  const baselines = JSON.parse(
    await readFile(path.join(productRoot, 'third_party', 'upstream-baselines.json'), 'utf8'),
  ) as UpstreamBaselineManifest;
  if (
    baselines.schemaVersion !== 2 ||
    !Array.isArray(baselines.upstreams) ||
    baselines.upstreams.some(
      (entry) =>
        !/^[a-f0-9]{40}$/u.test(entry.auditedBranchCommit ?? '') ||
        !/^[a-f0-9]{40}$/u.test(entry.pinnedTagCommit ?? ''),
    )
  ) {
    findings.push('Invalid upstream baseline manifest');
  } else {
    const dshBaseline = baselines.upstreams.find((entry) => entry.id === 'dsh');
    const cometBaseline = baselines.upstreams.find((entry) => entry.id === 'comet');
    if (
      dshBaseline?.pinnedTagCommit !== dsh.upstream?.commit ||
      dshBaseline?.pinnedTagCommit !== cordis.upstream?.commit
    ) {
      findings.push('DSH baseline disagrees with DSH or Cordis provenance');
    }
    if (cometBaseline?.pinnedTagCommit !== manifest.upstream?.commit) {
      findings.push('Comet baseline disagrees with Comet provenance');
    }
  }

  return {
    valid: findings.length === 0,
    fileCount: manifest.files.length + cordisFiles + (matt.files?.length ?? 0),
    findings,
  };
}

async function installedPackageManifest(
  productRoot: string,
  name: string,
): Promise<{ name?: string; version?: string } | null> {
  // Match the ESM product's normal ancestor lookup, including npm hoisting and
  // pnpm symlinks. CJS createRequire would additionally accept NODE_PATH/global
  // packages that the ESM entry cannot import, masking an incomplete install.
  let directory = path.resolve(productRoot);
  for (;;) {
    const packageDirectory = path.join(directory, 'node_modules', name);
    let exists = false;
    try {
      exists = (await stat(packageDirectory)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (exists) {
      // An incomplete nearest package must fail locally, not borrow an ancestor
      // manifest. Only absent package directories permit normal hoisting.
      return JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      } | null;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`No installed package manifest found for ${name}`);
    directory = parent;
  }
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
