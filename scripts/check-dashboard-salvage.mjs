import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'scripts', 'dashboard-salvage-ledger.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const packageManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const dshAdoption = JSON.parse(
  await readFile(path.join(root, 'third_party', 'dsh-adoption.json'), 'utf8'),
);

const findings = [];
const sha = /^[a-f0-9]{40}$/u;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const stringList = (value) => Array.isArray(value) && value.length > 0 && value.every(text);

if (manifest.schemaVersion !== 1) findings.push('Ledger schemaVersion must be 1');
if (!sha.test(manifest.baseline?.mainCommit ?? ''))
  findings.push('Baseline main commit is invalid');
if (manifest.baseline?.workflowVersion !== '4.0.0') {
  findings.push('Baseline workflow version must be 4.0.0');
}
if (manifest.baseline?.platform !== 'win32-x64')
  findings.push('Baseline platform must be win32-x64');
const requiredValidationCommands = new Set([
  'npm ci',
  'npm run check:upstream',
  'npm run check:provenance',
  'npm audit --audit-level=high',
  'npm run verify',
  'npm run test:tracer-e2e',
]);
for (const validation of manifest.baseline?.validation ?? []) {
  requiredValidationCommands.delete(validation.command);
  const acceptedStatus =
    validation.status === 'passed' ||
    (validation.command === 'npm run check:upstream' &&
      validation.status === 'drift-detected-audited') ||
    (validation.command === 'npm run verify' && validation.status === 'blocked-plan-scope');
  if (!acceptedStatus || !text(validation.evidence)) {
    findings.push(`Baseline validation is not passed: ${validation.command ?? '(missing)'}`);
  }
}
for (const command of requiredValidationCommands) {
  findings.push(`Missing baseline validation command: ${command}`);
}

const expectedSources = new Map([
  ['revise-dashboard-telemetry', '42e7c669be2ceed99b83ca5d2bd2028ec39d4779'],
  ['windows-desktop-dashboard-telemetry', '4e0b9df14679d5dcf5026fbac5fc5a1192c617e9'],
]);
for (const source of manifest.sources ?? []) {
  if (expectedSources.get(source.id) !== source.commit) {
    findings.push(`Unexpected source identity: ${source.id ?? '(missing)'}`);
  }
}
for (const sourceId of expectedSources.keys()) {
  if (!(manifest.sources ?? []).some((source) => source.id === sourceId)) {
    findings.push(`Missing source branch: ${sourceId}`);
  }
}

const allowedDecisions = new Set(['adopt', 'rewrite', 'reject']);
for (const slice of manifest.slices ?? []) {
  if (
    !text(slice.id) ||
    !expectedSources.has(slice.sourceId) ||
    !stringList(slice.files) ||
    !stringList(slice.requirementRefs) ||
    !stringList(slice.externalPrerequisites) ||
    !stringList(slice.outdatedSemantics) ||
    !stringList(slice.rewriteScope) ||
    !stringList(slice.verification) ||
    !allowedDecisions.has(slice.decision)
  ) {
    findings.push(`Incomplete salvage slice: ${slice.id ?? '(missing)'}`);
  }
  if (slice.decision === 'adopt' && slice.files.some((file) => file === '**')) {
    findings.push(`Whole-branch adoption is forbidden: ${slice.id}`);
  }
}
if (!Array.isArray(manifest.slices) || manifest.slices.length < 8) {
  findings.push('Ledger must contain bounded behavioral slices');
}

const requiredNegativeFindings = new Set([
  'independent-repair-phase',
  'post-merge-automation',
  'completed-task-rollback',
  'legacy-task-action',
  'legacy-run-schema',
  'legacy-data-reader',
]);
for (const entry of manifest.negativeScan ?? []) {
  requiredNegativeFindings.delete(entry.id);
  if (
    !text(entry.id) ||
    !stringList(entry.evidence) ||
    !['reject', 'rewrite'].includes(entry.disposition) ||
    !text(entry.reason)
  ) {
    findings.push(`Incomplete negative-scan entry: ${entry.id ?? '(missing)'}`);
  }
}
for (const missing of requiredNegativeFindings) findings.push(`Missing negative scan: ${missing}`);

const lockedDesktopDependencies = new Map(
  (dshAdoption.desktopDependencies ?? []).map((dependency) => [
    dependency.name,
    dependency.version,
  ]),
);
for (const dependency of ['electron', 'electron-builder', 'vite', 'react']) {
  const installed =
    packageManifest.dependencies?.[dependency] ?? packageManifest.devDependencies?.[dependency];
  if (!installed || installed !== lockedDesktopDependencies.get(dependency)) {
    findings.push(`Desktop dependency does not match DSH adoption ledger: ${dependency}`);
  }
  if (/^[~^><=*]/u.test(installed ?? '')) {
    findings.push(`Desktop dependency is not exactly pinned: ${dependency}`);
  }
}
if (manifest.dsh?.commit !== dshAdoption.upstream?.commit) {
  findings.push('DSH commit does not match the governed adoption baseline');
}
if (manifest.dsh?.license !== 'MIT' || !stringList(manifest.dsh?.includedBehaviors)) {
  findings.push('DSH desktop behavior boundary is incomplete');
}
if (!stringList(manifest.dsh?.excludedBehaviors)) {
  findings.push('DSH excluded behavior boundary is incomplete');
}
if (
  !Array.isArray(manifest.upstreamDrift) ||
  manifest.upstreamDrift.length !== 2 ||
  manifest.upstreamDrift.some(
    (entry) =>
      !['dsh', 'comet'].includes(entry.id) ||
      !sha.test(entry.observedHead ?? '') ||
      !sha.test(entry.latestStableCommit ?? '') ||
      !stringList(entry.relevantChanges) ||
      entry.disposition !== 'separate-upstream-alignment-change',
  )
) {
  findings.push('Audited upstream drift disposition is incomplete');
}

if (findings.length > 0) {
  throw new Error(`Dashboard salvage ledger check failed:\n- ${findings.join('\n- ')}`);
}

process.stdout.write(
  `Dashboard salvage ledger valid: ${manifest.slices.length} slices, ${manifest.negativeScan.length} negative findings\n`,
);
