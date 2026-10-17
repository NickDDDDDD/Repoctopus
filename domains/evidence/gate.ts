import type { EvidenceBundle, EvidenceCheck, EvidenceFinding, GateOutcome } from './types.js';

export function aggregateGateOutcome(
  checks: readonly EvidenceCheck[],
  findings: readonly EvidenceFinding[],
): GateOutcome {
  const required = checks.filter((check) => check.required);
  if (required.some((check) => check.status === 'failed')) return 'failed';
  if (
    required.some(
      (check) =>
        check.status === 'blocked' ||
        check.status === 'incomplete' ||
        check.freshness === 'superseded' ||
        (check.status === 'passed' && check.trust !== 'verified'),
    )
  ) {
    return 'incomplete';
  }
  const warnings =
    findings.some((finding) => finding.severity === 'warning') ||
    checks.some((check) => !check.required && check.status !== 'passed');
  return warnings ? 'passed_with_warnings' : 'passed';
}

export function createEvidenceBundle(
  input: Omit<EvidenceBundle, 'apiVersion' | 'kind' | 'outcome'>,
): EvidenceBundle {
  return {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'EvidenceBundle',
    ...input,
    outcome: aggregateGateOutcome(input.checks, input.findings),
  };
}
