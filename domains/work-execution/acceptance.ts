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

export class StaleWorkOutcomeValidationError extends Error {
  constructor(message = 'Validated Work acceptance inputs changed before terminal commit') {
    super(message);
    this.name = 'StaleWorkOutcomeValidationError';
  }
}

export class UnregisteredBuildWorkOutcomeProcessorError extends Error {
  constructor(kind: string) {
    super(`No Build Work Outcome processor is registered for ${kind}`);
    this.name = 'UnregisteredBuildWorkOutcomeProcessorError';
  }
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

export function buildWorkValidationDigest(
  record: Omit<WorkOutcomeValidationRecord, 'validationDigest' | 'outcomeId'>,
): `sha256:${string}` {
  return sha256(record);
}

export function buildValidatedOutcomeId(
  validationDigest: WorkOutcomeValidationRecord['validationDigest'],
): `sha256:${string}` {
  return sha256({ kind: 'validated-build-work-outcome', validationDigest });
}

export function resolveBuildWorkOutcomeProcessor(kind: string): BuildWorkOutcomeProcessor {
  const processor = PROCESSORS.get(kind as BuildWorkKind);
  if (!processor) {
    throw new UnregisteredBuildWorkOutcomeProcessorError(kind);
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
  expectedStateVersion: number;
  lifecycleDigest: `sha256:${string}`;
  projectSnapshotDigest: string;
  validationInput: unknown;
  transition: unknown;
}): BuildWorkOutcomeDisposition {
  const processor = resolveBuildWorkOutcomeProcessor(input.work.kind);
  const shapeFailure = validateBuildWorkResultShape({
    workKind: processor.workKind,
    result: input.submission.outcome.result,
  });
  if (shapeFailure) return shapeFailure;
  const candidateDigest = sha256(input.submission.outcome.result);
  const recordWithoutDigest = {
    schemaVersion: 2 as const,
    workKind: processor.workKind,
    validatorId: input.validatorId,
    submissionId: input.submission.submissionId,
    submissionDigest: input.submission.payloadDigest,
    candidateDigest,
    stableInputDigest: input.work.inputDigest,
    validationInputDigest: sha256(input.validationInput),
    transitionDigest: sha256(input.transition),
    lifecycleDigest: input.lifecycleDigest,
    projectSnapshotDigest: input.projectSnapshotDigest,
    expectedStateVersion: input.expectedStateVersion,
    decision: 'accepted' as const,
  };
  const validationDigest = buildWorkValidationDigest(recordWithoutDigest);
  return {
    kind: 'accepted',
    validation: {
      ...recordWithoutDigest,
      validationDigest,
      outcomeId: buildValidatedOutcomeId(validationDigest),
    },
  };
}

export function buildWorkCandidateDigest(
  result: WorkExecutionResult | undefined,
): `sha256:${string}` {
  return sha256(result);
}
