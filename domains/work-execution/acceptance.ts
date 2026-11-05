import { createHash } from 'node:crypto';

import type { WorkDescriptor } from '../change-lifecycle/transition.js';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type {
  WorkExecutionResult,
  WorkExecutionSubmissionRejectionCode,
  WorkExecutionSubmission,
  WorkOutcomeValidationRecord,
} from './types.js';

export const BUILD_WORK_KINDS = [
  'build.configure',
  'build.plan',
  'build.execute',
  'build.check',
] as const;

export type BuildWorkKind = (typeof BUILD_WORK_KINDS)[number];
export type BuildWorkResultKind = WorkExecutionResult['kind'];

export interface BuildWorkOutcomeProcessor {
  workKind: BuildWorkKind;
  resultKind: BuildWorkResultKind;
}

const PROCESSORS = new Map<BuildWorkKind, BuildWorkOutcomeProcessor>([
  ['build.configure', { workKind: 'build.configure', resultKind: 'execution-binding-candidate' }],
  ['build.plan', { workKind: 'build.plan', resultKind: 'build-plan-candidate' }],
  ['build.execute', { workKind: 'build.execute', resultKind: 'build-package-completion' }],
  ['build.check', { workKind: 'build.check', resultKind: 'build-check-candidate' }],
]);

export type BuildWorkOutcomeDisposition =
  | {
      kind: 'accepted';
      validation: WorkOutcomeValidationRecord;
    }
  | {
      kind: 'correctable-rejection';
      reasonCode: Exclude<WorkExecutionSubmissionRejectionCode, 'outcome-processing-error'>;
      diagnostic: string;
    }
  | {
      kind: 'processing-error';
      reasonCode: 'outcome-processing-error';
      diagnostic: string;
    };

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function isBuildWorkKind(kind: string): kind is BuildWorkKind {
  return BUILD_WORK_KINDS.includes(kind as BuildWorkKind);
}

export function resolveBuildWorkOutcomeProcessor(kind: string): BuildWorkOutcomeProcessor {
  const processor = PROCESSORS.get(kind as BuildWorkKind);
  if (!processor) {
    throw new Error(`No Build Work Outcome processor is registered for ${kind}`);
  }
  return processor;
}

export function validateBuildWorkResultShape(input: {
  workKind: string;
  result: WorkExecutionResult | undefined;
}): BuildWorkOutcomeDisposition | null {
  const processor = resolveBuildWorkOutcomeProcessor(input.workKind);
  if (input.result?.kind === processor.resultKind) return null;
  return {
    kind: 'correctable-rejection',
    reasonCode: 'output-invalid',
    diagnostic: `${processor.workKind} Host must return ${processor.resultKind}`,
  };
}

export function processingError(diagnostic: string): BuildWorkOutcomeDisposition {
  return {
    kind: 'processing-error',
    reasonCode: 'outcome-processing-error',
    diagnostic,
  };
}

export function correctableRejection(
  diagnostic: string,
  reasonCode: Exclude<
    WorkExecutionSubmissionRejectionCode,
    'outcome-processing-error'
  > = 'outcome-rejected',
): BuildWorkOutcomeDisposition {
  return { kind: 'correctable-rejection', reasonCode, diagnostic };
}

export function createAcceptedBuildWorkOutcome(input: {
  work: WorkDescriptor;
  submission: WorkExecutionSubmission;
  validatorId: string;
  stableInputDigest?: `sha256:${string}`;
}): BuildWorkOutcomeDisposition {
  const processor = resolveBuildWorkOutcomeProcessor(input.work.kind);
  const shapeFailure = validateBuildWorkResultShape({
    workKind: processor.workKind,
    result: input.submission.outcome.result,
  });
  if (shapeFailure) return shapeFailure;
  const candidateDigest = sha256(input.submission.outcome.result);
  const recordWithoutDigest = {
    schemaVersion: 1 as const,
    workKind: processor.workKind,
    validatorId: input.validatorId,
    submissionId: input.submission.submissionId,
    submissionDigest: input.submission.payloadDigest,
    candidateDigest,
    stableInputDigest: input.stableInputDigest ?? input.work.inputDigest,
    decision: 'accepted' as const,
  };
  return {
    kind: 'accepted',
    validation: {
      ...recordWithoutDigest,
      validationDigest: sha256(recordWithoutDigest),
    },
  };
}

export function buildWorkCandidateDigest(
  result: WorkExecutionResult | undefined,
): `sha256:${string}` {
  return sha256(result);
}
