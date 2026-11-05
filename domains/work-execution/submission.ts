import { createHash } from 'node:crypto';

import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  RejectedWorkExecutionSubmission,
  WorkExecutionHostOutcome,
  WorkExecutionSubmission,
  WorkExecutionSubmissionRejectionCode,
} from './types.js';

export const MAX_REJECTED_WORK_EXECUTION_SUBMISSIONS = 16;
const MAX_SUBMISSION_ID_LENGTH = 128;
const MAX_DIAGNOSTIC_LENGTH = 2_048;

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must contain 1-${maximum} characters`);
  }
  return normalized;
}

function payloadDigest(outcome: WorkExecutionHostOutcome, rawPayload?: unknown): `sha256:${string}` {
  if (rawPayload !== undefined) {
    return `sha256:${createHash('sha256').update(canonicalJson(rawPayload)).digest('hex')}`;
  }
  const { completedAt, ...payload } = outcome;
  void completedAt;
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}`;
}

export function createWorkExecutionSubmission(
  submissionId: string,
  outcome: WorkExecutionHostOutcome,
  rawPayload?: unknown,
): WorkExecutionSubmission {
  const submittedAt = new Date(outcome.completedAt);
  if (Number.isNaN(submittedAt.valueOf())) {
    throw new Error('Work submission completion time is invalid');
  }
  return {
    schemaVersion: 1,
    submissionId: boundedText(submissionId, 'Work submission identity', MAX_SUBMISSION_ID_LENGTH),
    payloadDigest: payloadDigest(outcome, rawPayload),
    outcome: structuredClone(outcome),
    ...(rawPayload === undefined ? {} : { rawPayload: structuredClone(rawPayload) }),
    submittedAt: submittedAt.toISOString(),
  };
}

export type WorkExecutionSubmissionDisposition =
  | 'new'
  | 'duplicate-pending'
  | 'duplicate-rejected'
  | 'duplicate-accepted';

export function classifyWorkExecutionSubmission(input: {
  pending?: WorkExecutionSubmission;
  rejected?: readonly RejectedWorkExecutionSubmission[] | readonly WorkExecutionSubmission[];
  accepted?: WorkExecutionSubmission;
  candidate: WorkExecutionSubmission;
}): WorkExecutionSubmissionDisposition {
  const matches = [
    ...(input.pending ? [{ kind: 'duplicate-pending' as const, value: input.pending }] : []),
    ...(input.rejected ?? []).map((value) => ({
      kind: 'duplicate-rejected' as const,
      value,
    })),
    ...(input.accepted ? [{ kind: 'duplicate-accepted' as const, value: input.accepted }] : []),
  ].filter(({ value }) => value.submissionId === input.candidate.submissionId);
  if (matches.length === 0) return 'new';
  const match = matches[0]!;
  if (match.value.payloadDigest !== input.candidate.payloadDigest) {
    throw new Error('Work submission identity conflict: payload content changed');
  }
  return match.kind;
}

export function appendRejectedWorkExecutionSubmission(
  existing: readonly RejectedWorkExecutionSubmission[],
  submission: WorkExecutionSubmission,
  rejection: {
    reasonCode: WorkExecutionSubmissionRejectionCode;
    diagnostic: string;
    rejectedAt: string;
  },
): RejectedWorkExecutionSubmission[] {
  if (existing.length >= MAX_REJECTED_WORK_EXECUTION_SUBMISSIONS) {
    throw new Error('Work rejected submission history is full; Human Decision is required');
  }
  const rejectedAt = new Date(rejection.rejectedAt);
  if (Number.isNaN(rejectedAt.valueOf())) {
    throw new Error('Work submission rejection time is invalid');
  }
  const candidate: RejectedWorkExecutionSubmission = {
    ...structuredClone(submission),
    rejection: {
      reasonCode: rejection.reasonCode,
      diagnostic: boundedText(
        rejection.diagnostic,
        'Work submission rejection diagnostic',
        MAX_DIAGNOSTIC_LENGTH,
      ),
      rejectedAt: rejectedAt.toISOString(),
    },
  };
  return [...existing.map((entry) => structuredClone(entry)), candidate];
}
