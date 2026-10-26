import type { WorkExecutionHostOutcome } from './types.js';

const FINDING_KINDS = new Set([
  'implementation_failure',
  'design_assumption_invalid',
  'planning_semantics_changed',
  'evidence_unavailable',
  'external_result_unknown',
]);

const FINDING_FIELDS = new Set(['kind', 'summary', 'requirementIds', 'taskIds']);

export function assertBoundedWorkExecutionFindings(outcome: WorkExecutionHostOutcome): void {
  const rawOutcome = outcome as unknown as Record<string, unknown>;
  if ('targetPhase' in rawOutcome) {
    throw new Error('Work Execution Host cannot select a target phase');
  }
  const rawFindings = rawOutcome.findings;
  if (rawFindings !== undefined && !Array.isArray(rawFindings)) {
    throw new Error('Work Execution Host findings must be an array');
  }
  const findings = (rawFindings ?? []) as unknown[];
  if (findings.length > 16) throw new Error('Work Execution Host findings exceed the bound');
  for (const rawFinding of findings) {
    if (!rawFinding || typeof rawFinding !== 'object' || Array.isArray(rawFinding)) {
      throw new Error('Work Execution Host returned an invalid bounded finding');
    }
    const finding = rawFinding as Record<string, unknown>;
    if ([...Object.keys(finding)].some((field) => !FINDING_FIELDS.has(field))) {
      throw new Error('Work Execution Host finding contains an unsupported field');
    }
    if (
      typeof finding.kind !== 'string' ||
      !FINDING_KINDS.has(finding.kind) ||
      typeof finding.summary !== 'string' ||
      !finding.summary.trim() ||
      finding.summary.length > 512
    ) {
      throw new Error('Work Execution Host returned an invalid bounded finding');
    }
    for (const field of ['requirementIds', 'taskIds'] as const) {
      const values = finding[field];
      if (values === undefined) continue;
      if (
        !Array.isArray(values) ||
        values.length > 64 ||
        values.some(
          (value) => typeof value !== 'string' || !value.trim() || value.length > 256,
        )
      ) {
        throw new Error('Work Execution Host finding identities exceed the bound');
      }
    }
  }
}
