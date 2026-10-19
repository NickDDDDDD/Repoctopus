import type {
  EvidenceBundle,
  EvidenceCheck,
  EvidenceFinding,
  EvidenceGateProjection,
  GateOutcome,
} from './types.js';

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

export function projectEvidenceGate(
  bundle: EvidenceBundle,
  binding: {
    workflowRunId: string;
    workflowActionId: string;
    workflowStepId: string;
    workflowStateVersion: number;
  } | null = null,
): EvidenceGateProjection {
  const satisfied = bundle.outcome === 'passed' || bundle.outcome === 'passed_with_warnings';
  return {
    schemaVersion: 1,
    kind: 'EvidenceGateProjection',
    workflowRunId: binding?.workflowRunId ?? null,
    workflowActionId: binding?.workflowActionId ?? null,
    workflowStepId: binding?.workflowStepId ?? null,
    workflowStateVersion: binding?.workflowStateVersion ?? null,
    compositionDigest: bundle.compositionDigest,
    profileId: bundle.profileId,
    bundleId: bundle.bundleId,
    inputFingerprint: bundle.inputFingerprint,
    outcome: bundle.outcome,
    status: satisfied ? 'satisfied' : 'blocked',
    reason: satisfied
      ? `Evidence profile ${bundle.profileId} satisfied the current input fingerprint`
      : `Evidence profile ${bundle.profileId} is ${bundle.outcome}`,
  };
}
