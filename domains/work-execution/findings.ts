import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type { WorkExecutionFindingKind, WorkExecutionHostOutcome } from './types.js';

const FINDING_KINDS = new Set([
  'implementation_failure',
  'authority_conflict',
  'plan_constraint',
  'evidence_mismatch',
  'evidence_unavailable',
  'external_result_unknown',
]);

const FINDING_FIELDS = new Set([
  'kind',
  'code',
  'summary',
  'requirementIds',
  'taskIds',
  'packageIds',
  'evidenceIds',
]);
const REFERENCE_FIELDS = ['requirementIds', 'taskIds', 'packageIds', 'evidenceIds'] as const;
const FINDING_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export interface NormalizedWorkExecutionFinding {
  identity: `finding:sha256:${string}`;
  kind: WorkExecutionFindingKind;
  code: string;
  summary: string;
  requirementIds: readonly string[];
  taskIds: readonly string[];
  packageIds: readonly string[];
  evidenceIds: readonly string[];
}

export interface WorkExecutionFindingReferenceAuthority {
  requirementIds: readonly string[];
  taskIds: readonly string[];
  packageIds: readonly string[];
  evidenceIds: readonly string[];
}

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
      typeof finding.code !== 'string' ||
      finding.code.length > 64 ||
      !FINDING_CODE.test(finding.code) ||
      typeof finding.summary !== 'string' ||
      !finding.summary.trim() ||
      finding.summary.length > 512
    ) {
      throw new Error('Work Execution Host returned an invalid bounded finding');
    }
    for (const field of REFERENCE_FIELDS) {
      const values = finding[field];
      if (values === undefined) continue;
      if (
        !Array.isArray(values) ||
        values.length > 64 ||
        values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 256)
      ) {
        throw new Error('Work Execution Host finding identities exceed the bound');
      }
    }
  }
}

function normalizedReferences(
  finding: Record<string, unknown>,
  field: (typeof REFERENCE_FIELDS)[number],
): readonly string[] {
  return Object.freeze([...new Set((finding[field] ?? []) as string[])].sort());
}

export function assertWorkExecutionFindingReferences(
  findings: readonly NormalizedWorkExecutionFinding[],
  authority: WorkExecutionFindingReferenceAuthority,
): void {
  const references = [
    ['Requirement', 'requirementIds'],
    ['Task', 'taskIds'],
    ['Package', 'packageIds'],
    ['Evidence', 'evidenceIds'],
  ] as const;
  for (const [label, field] of references) {
    const known = new Set(authority[field]);
    if (findings.some((finding) => finding[field].some((identity) => !known.has(identity)))) {
      throw new Error(`Work Execution finding references an unknown ${label}`);
    }
  }
}

export function normalizeWorkExecutionFindings(
  outcome: WorkExecutionHostOutcome,
): NormalizedWorkExecutionFinding[] {
  assertBoundedWorkExecutionFindings(outcome);
  return (outcome.findings ?? []).map((finding) => {
    const normalized = {
      kind: finding.kind,
      code: finding.code,
      requirementIds: normalizedReferences(
        finding as unknown as Record<string, unknown>,
        'requirementIds',
      ),
      taskIds: normalizedReferences(finding as unknown as Record<string, unknown>, 'taskIds'),
      packageIds: normalizedReferences(finding as unknown as Record<string, unknown>, 'packageIds'),
      evidenceIds: normalizedReferences(
        finding as unknown as Record<string, unknown>,
        'evidenceIds',
      ),
    };
    const digest = createHash('sha256').update(canonicalJson(normalized)).digest('hex');
    return Object.freeze({
      identity: `finding:sha256:${digest}` as const,
      ...normalized,
      summary: finding.summary,
    });
  });
}
