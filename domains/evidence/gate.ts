import type {
  EvidenceBundle,
  EvidenceCheck,
  EvidenceFinding,
  EvidenceGateProjection,
  GateOutcome,
} from './types.js';
import { createEvidenceDependencyRecord } from './dependencies.js';
import { evidenceInputDigest } from './input-snapshot.js';

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
  input: Omit<
    EvidenceBundle,
    'schemaVersion' | 'apiVersion' | 'kind' | 'outcome' | 'acceptanceTrace' | 'dependencies'
  > &
    Partial<Pick<EvidenceBundle, 'acceptanceTrace'>>,
): EvidenceBundle {
  const acceptanceTrace = input.acceptanceTrace ?? null;
  const aggregate = aggregateGateOutcome(input.checks, input.findings);
  const outcome =
    acceptanceTrace && acceptanceTrace.passed !== acceptanceTrace.total
      ? acceptanceTrace.failed > 0
        ? 'failed'
        : 'incomplete'
      : aggregate;
  return {
    schemaVersion: 3,
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'EvidenceBundle',
    ...input,
    acceptanceTrace,
    outcome,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'bundle',
      subjectId: input.bundleId,
      dependencies: [
        {
          partition: 'implementation-content',
          identity: evidenceInputDigest(input.inputFingerprint),
        },
      ],
      dependsOnEvidenceIds: input.receiptIds,
    }),
  };
}

export function projectEvidenceGate(
  bundle: EvidenceBundle,
  binding: {
    workflowRunId: string;
    workflowActionId: string;
    workflowStepId: string;
    workflowStateVersion?: number;
    checkEpoch?: number;
    workflowInputDigest?: `sha256:${string}`;
    acceptanceContext?: {
      verificationInputDigest: `sha256:${string}`;
      acceptanceSetHash: `sha256:${string}`;
    };
  } | null = null,
): EvidenceGateProjection {
  const satisfied = bundle.outcome === 'passed' || bundle.outcome === 'passed_with_warnings';
  const traceMatchesBinding =
    !binding ||
    binding.workflowInputDigest === undefined ||
    (bundle.acceptanceTrace !== null &&
      bundle.acceptanceTrace.verificationInputDigest === binding.workflowInputDigest &&
      (!binding.acceptanceContext ||
        (bundle.acceptanceTrace.verificationInputDigest ===
          binding.acceptanceContext.verificationInputDigest &&
          bundle.acceptanceTrace.acceptanceSetHash ===
            binding.acceptanceContext.acceptanceSetHash)));
  const gateSatisfied = satisfied && traceMatchesBinding;
  return {
    schemaVersion: 3,
    kind: 'EvidenceGateProjection',
    workflowRunId: binding?.workflowRunId ?? null,
    workflowActionId: binding?.workflowActionId ?? null,
    workflowStepId: binding?.workflowStepId ?? null,
    workflowStateVersion: binding?.workflowStateVersion ?? null,
    checkEpoch: binding?.checkEpoch ?? null,
    compositionDigest: bundle.compositionDigest,
    profileId: bundle.profileId,
    bundleId: bundle.bundleId,
    inputFingerprint: bundle.inputFingerprint,
    verificationInputDigest: bundle.acceptanceTrace?.verificationInputDigest ?? null,
    acceptanceSetHash: bundle.acceptanceTrace?.acceptanceSetHash ?? null,
    outcome: bundle.outcome,
    status: gateSatisfied ? 'satisfied' : 'blocked',
    failureKind: gateSatisfied
      ? 'none'
      : !traceMatchesBinding ||
          bundle.findings.some((finding) =>
            ['evidence-not-collected', 'recovery-uncertain-side-effect'].includes(finding.code),
          )
        ? 'unavailable'
        : bundle.checks.some((check) => check.freshness === 'superseded')
          ? 'input-drift'
          : 'implementation',
    reason: gateSatisfied
      ? `Evidence profile ${bundle.profileId} satisfied the current input fingerprint`
      : traceMatchesBinding
        ? `Evidence profile ${bundle.profileId} is ${bundle.outcome}`
        : `Evidence profile ${bundle.profileId} has no matching Acceptance Trace`,
    dependencies: createEvidenceDependencyRecord({
      subjectKind: 'gate',
      subjectId: evidenceInputDigest({ bundleId: bundle.bundleId, binding }),
      dependencies: bundle.dependencies.dependencies,
      dependsOnEvidenceIds: [bundle.bundleId],
    }),
  };
}
