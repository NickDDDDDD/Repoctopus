import { describe, expect, it } from 'vitest';

import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import {
  BUILD_WORK_KINDS,
  createAcceptedBuildWorkOutcome,
  resolveBuildWorkOutcomeProcessor,
  validateBuildWorkResultShape,
} from '../domains/work-execution/acceptance.js';
import { createWorkExecutionSubmission } from '../domains/work-execution/submission.js';
import type { WorkExecutionHostOutcome } from '../domains/work-execution/types.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

describe('Build Work Outcome acceptance domain', () => {
  it('registers exactly one processor for every authoritative Build Work', () => {
    expect(BUILD_WORK_KINDS.map((kind) => resolveBuildWorkOutcomeProcessor(kind))).toEqual([
      { workKind: 'build.configure', resultKind: 'execution-binding-candidate' },
      { workKind: 'build.plan', resultKind: 'build-plan-candidate' },
      { workKind: 'build.execute', resultKind: 'build-package-completion' },
      { workKind: 'build.check', resultKind: 'build-check-candidate' },
    ]);
    expect(() => resolveBuildWorkOutcomeProcessor('build.publish')).toThrow(
      /No Build Work Outcome processor/u,
    );
  });

  it('classifies a mismatched result shape as a correctable rejection', () => {
    expect(
      validateBuildWorkResultShape({
        workKind: 'build.configure',
        result: { schemaVersion: 1, kind: 'build-plan-candidate', packages: [] },
      }),
    ).toMatchObject({
      kind: 'correctable-rejection',
      reasonCode: 'output-invalid',
    });
  });

  it('creates a stable accepted validation record bound to Work and submission', () => {
    const work = {
      kind: 'build.configure',
      inputDigest: digest('1'),
    } as WorkDescriptor;
    const outcome = {
      schemaVersion: 1,
      invocationId: digest('2'),
      hostId: 'host-1',
      packetDigest: digest('3'),
      status: 'succeeded',
      summary: 'candidate',
      consumedLayerDigests: [],
      result: {
        schemaVersion: 1,
        kind: 'execution-binding-candidate',
        strategyDigest: digest('4'),
      },
      completedAt: '2026-11-05T00:00:00.000Z',
    } satisfies WorkExecutionHostOutcome;
    const submission = createWorkExecutionSubmission('submission-1', outcome);

    const first = createAcceptedBuildWorkOutcome({
      work,
      submission,
      validatorId: 'build.binding-valid',
      expectedStateVersion: 7,
      lifecycleDigest: digest('5'),
      projectSnapshotDigest: digest('6'),
      validationInput: { strategyDigest: digest('4') },
      transition: { kind: 'build-binding-accepted' },
    });
    const replay = createAcceptedBuildWorkOutcome({
      work,
      submission,
      validatorId: 'build.binding-valid',
      expectedStateVersion: 7,
      lifecycleDigest: digest('5'),
      projectSnapshotDigest: digest('6'),
      validationInput: { strategyDigest: digest('4') },
      transition: { kind: 'build-binding-accepted' },
    });

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      kind: 'accepted',
      validation: {
        workKind: 'build.configure',
        submissionId: 'submission-1',
        submissionDigest: submission.payloadDigest,
        stableInputDigest: work.inputDigest,
        expectedStateVersion: 7,
        lifecycleDigest: digest('5'),
        projectSnapshotDigest: digest('6'),
        decision: 'accepted',
      },
    });
    if (first.kind !== 'accepted') throw new Error('Expected accepted disposition');
    expect(first.validation.outcomeId).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
