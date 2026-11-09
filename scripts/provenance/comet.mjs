const REQUIRED_REFERENCES = new Map([
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

function dependencyEntries(packageJson) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
    Object.entries(packageJson?.[field] ?? {}).map(([name, spec]) => ({ field, name, spec })),
  );
}

function isCometPackageReference(value) {
  return (
    /(^|[/@-])comet($|[/@-])/iu.test(String(value ?? '')) ||
    /npm:(?:@[^/]+\/)?comet@/iu.test(String(value ?? '')) ||
    /github\.com[/ :]rpamis[/ ]comet(?:\.git)?/iu.test(String(value ?? ''))
  );
}

export function validateCometProvenance(manifest, packageJson, packageLock = {}) {
  const findings = [];
  if (manifest?.schemaVersion !== 2) {
    findings.push('Comet provenance schemaVersion must be 2');
  }
  if (!/^[a-f0-9]{40}$/u.test(manifest?.upstream?.commit ?? '')) {
    findings.push('Comet upstream commit must be a pinned 40-character SHA');
  }
  if (manifest?.upstream?.repository !== 'https://github.com/rpamis/comet.git') {
    findings.push('Comet upstream repository must be https://github.com/rpamis/comet.git');
  }
  if (manifest?.upstream?.version !== '0.5.1') {
    findings.push('Comet upstream version must be 0.5.1');
  }
  if (manifest?.upstream?.license !== 'MIT') {
    findings.push('Comet upstream license must be MIT');
  }
  if (!Array.isArray(manifest?.files)) {
    findings.push('Comet provenance files must be an array');
  }

  const seenRoles = new Set();
  if (!Array.isArray(manifest?.references)) {
    findings.push('Comet behavioral references must be an array');
  } else {
    for (const reference of manifest.references) {
      if (
        !REQUIRED_REFERENCES.has(reference?.role) ||
        seenRoles.has(reference.role) ||
        reference.source !== REQUIRED_REFERENCES.get(reference.role) ||
        !/^[a-f0-9]{64}$/u.test(reference.sourceSha256 ?? '') ||
        reference.adoption !== 'behavioral-reference'
      ) {
        findings.push(
          `Invalid Comet behavioral reference source or digest: ${reference?.role ?? '(missing role)'}`,
        );
        continue;
      }
      seenRoles.add(reference.role);
    }
  }
  for (const role of REQUIRED_REFERENCES.keys()) {
    if (!seenRoles.has(role)) findings.push(`Missing Comet behavioral reference: ${role}`);
  }

  for (const dependency of dependencyEntries(packageJson)) {
    if (isCometPackageReference(dependency.name) || isCometPackageReference(dependency.spec)) {
      findings.push(
        `Comet Runtime dependency is forbidden in ${dependency.field}: ${dependency.name}`,
      );
    }
  }
  for (const [location, locked] of Object.entries(packageLock?.packages ?? {})) {
    if (
      location &&
      (isCometPackageReference(location) ||
        isCometPackageReference(locked?.name) ||
        isCometPackageReference(locked?.resolved))
    ) {
      findings.push(`Comet Runtime dependency is forbidden in package lock: ${location}`);
    }
  }
  return findings;
}
