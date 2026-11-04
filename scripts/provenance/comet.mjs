const REQUIRED_REFERENCE_ROLES = new Set([
  'revision-readiness',
  'revision-command',
  'revision-application',
  'evidence-invalidation',
]);

function dependencyEntries(packageJson) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
    Object.keys(packageJson?.[field] ?? {}).map((name) => ({ field, name })),
  );
}

export function validateCometProvenance(manifest, packageJson) {
  const findings = [];
  if (manifest?.schemaVersion !== 2) {
    findings.push('Comet provenance schemaVersion must be 2');
  }
  if (!/^[a-f0-9]{40}$/u.test(manifest?.upstream?.commit ?? '')) {
    findings.push('Comet upstream commit must be a pinned 40-character SHA');
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
        !REQUIRED_REFERENCE_ROLES.has(reference?.role) ||
        seenRoles.has(reference.role) ||
        typeof reference.source !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(reference.sourceSha256 ?? '') ||
        reference.adoption !== 'behavioral-reference'
      ) {
        findings.push(`Invalid Comet behavioral reference: ${reference?.role ?? '(missing role)'}`);
        continue;
      }
      seenRoles.add(reference.role);
    }
  }
  for (const role of REQUIRED_REFERENCE_ROLES) {
    if (!seenRoles.has(role)) findings.push(`Missing Comet behavioral reference: ${role}`);
  }

  for (const dependency of dependencyEntries(packageJson)) {
    if (/(^|[/@-])comet($|[/@-])/iu.test(dependency.name)) {
      findings.push(
        `Comet Runtime dependency is forbidden in ${dependency.field}: ${dependency.name}`,
      );
    }
  }
  return findings;
}
