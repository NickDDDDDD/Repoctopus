const evidencePrefixes = ['openspec/', 'verification/', 'docs/superpowers/'];

const evidenceInfrastructure = new Set([
  'scripts/check-managed-execution-report.mjs',
  'scripts/managed-execution-report-boundary.d.mts',
  'scripts/managed-execution-report-boundary.mjs',
  'test/managed-execution-report-boundary.test.ts',
]);

export function isLifecycleEvidenceOnlyChange(file) {
  return (
    evidencePrefixes.some((prefix) => file.startsWith(prefix)) || evidenceInfrastructure.has(file)
  );
}
