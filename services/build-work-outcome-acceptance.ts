import { createHash } from 'node:crypto';

import type { WorkOutcomeAcceptance } from '../domains/action/types.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import type { RunState } from '../domains/engine/types.js';
import {
  createAcceptedBuildWorkOutcome,
  StaleWorkOutcomeValidationError,
  type BuildWorkOutcomeDisposition,
  validateBuildWorkResultShape,
} from '../domains/work-execution/acceptance.js';
import type {
  WorkExecutionCheckpoint,
  WorkExecutionHostOutcome,
  WorkExecutionSubmission,
} from '../domains/work-execution/types.js';
import { canonicalJson } from '../domains/workflow-contract/canonical.js';
import type { WorkDispatcher } from './work-dispatcher.js';
import type { WorkExecutionAuthority } from './work-execution-authority.js';

export interface PendingBuildWorkCandidate {
  kind: 'candidate';
  work: WorkDescriptor;
  submission: WorkExecutionSubmission;
  outcome: WorkExecutionHostOutcome;
  terminalized: boolean;
}

export class BuildWorkOutcomeAcceptanceCoordinator {
  constructor(
    private readonly dependencies: {
      workDispatcher: Pick<WorkDispatcher, 'outcome' | 'acceptValidatedOutcome'>;
      workExecutionAuthority: Pick<WorkExecutionAuthority, 'loadIntent' | 'rejectHostSubmission'>;
      loadRun: (runId: string) => Promise<RunState>;
    },
  ) {}

  inspect(input: {
    work: WorkDescriptor;
    execution: WorkExecutionCheckpoint | undefined;
  }): PendingBuildWorkCandidate | BuildWorkOutcomeDisposition | null {
    const { execution, work } = input;
    if (
      !execution ||
      execution.workId !== work.workId ||
      execution.checkEpoch !== work.checkEpoch
    ) {
      return null;
    }
    const submission =
      execution.status === 'submitted'
        ? execution.pendingSubmission
        : execution.status === 'validated'
          ? execution.acceptedSubmission
          : undefined;
    if (!submission || submission.outcome.status !== 'succeeded') return null;
    const shapeFailure = validateBuildWorkResultShape({
      workKind: work.kind,
      result: submission.outcome.result,
    });
    if (shapeFailure) return shapeFailure;
    return {
      kind: 'candidate',
      work,
      submission,
      outcome: submission.outcome,
      terminalized: execution.status === 'validated',
    };
  }

  async reject(
    runId: string,
    disposition: Exclude<BuildWorkOutcomeDisposition, { kind: 'accepted' }>,
  ): Promise<WorkExecutionCheckpoint> {
    const intent = await this.dependencies.workExecutionAuthority.loadIntent(runId);
    return this.dependencies.workExecutionAuthority.rejectHostSubmission({
      intent,
      reasonCode: disposition.reasonCode,
      diagnostic: disposition.diagnostic,
    });
  }

  async accept(input: {
    runId: string;
    candidate: PendingBuildWorkCandidate;
    validatorId: string;
    validationBase: RunState;
    validationInput: unknown;
    reobserveValidationInput: () => Promise<unknown>;
    transition: unknown;
    assertTransitionFeasible: (state: RunState) => void;
  }): Promise<
    | { kind: 'accepted'; acceptance: WorkOutcomeAcceptance }
    | { kind: 'processing-error'; diagnostic: string; checkpoint: WorkExecutionCheckpoint }
  > {
    if (input.candidate.terminalized) {
      throw new Error('Build Work Outcome candidate is already terminalized');
    }
    const baseLifecycleDigest = `sha256:${createHash('sha256')
      .update(canonicalJson(input.validationBase.changeLifecycle ?? null))
      .digest('hex')}` as const;
    const intent = await this.dependencies.workExecutionAuthority.loadIntent(input.runId);
    try {
      const state = await this.dependencies.loadRun(input.runId);
      const currentLifecycleDigest = `sha256:${createHash('sha256')
        .update(canonicalJson(state.changeLifecycle ?? null))
        .digest('hex')}` as const;
      if (
        state.stateVersion !== input.validationBase.stateVersion ||
        state.projectSnapshotDigest !== input.validationBase.projectSnapshotDigest ||
        currentLifecycleDigest !== baseLifecycleDigest
      ) {
        throw new StaleWorkOutcomeValidationError(
          'Build Work validation base changed before final observation',
        );
      }
      input.assertTransitionFeasible(state);
      let observedValidationInput: unknown;
      try {
        observedValidationInput = await input.reobserveValidationInput();
      } catch (error) {
        throw new StaleWorkOutcomeValidationError(
          `Build Work validation facts could not be re-observed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (canonicalJson(observedValidationInput) !== canonicalJson(input.validationInput)) {
        throw new StaleWorkOutcomeValidationError(
          'Build Work validation facts changed before terminal acceptance',
        );
      }
      const disposition = createAcceptedBuildWorkOutcome({
        work: input.candidate.work,
        submission: input.candidate.submission,
        validatorId: input.validatorId,
        expectedStateVersion: input.validationBase.stateVersion,
        lifecycleDigest: baseLifecycleDigest,
        projectSnapshotDigest: input.validationBase.projectSnapshotDigest,
        validationInput: input.validationInput,
        transition: input.transition,
      });
      if (disposition.kind !== 'accepted') {
        throw new Error(`Build Work Outcome cannot be accepted: ${disposition.diagnostic}`);
      }
      return {
        kind: 'accepted',
        acceptance: await this.dependencies.workDispatcher.acceptValidatedOutcome({
          outcome: this.dependencies.workDispatcher.outcome(
            intent,
            'succeeded',
            input.candidate.outcome.summary,
            disposition.validation.outcomeId,
          ),
          validation: disposition.validation,
        }),
      };
    } catch (error) {
      if (!(error instanceof StaleWorkOutcomeValidationError)) throw error;
      const diagnostic = error.message;
      const checkpoint = await this.dependencies.workExecutionAuthority.rejectHostSubmission({
        intent,
        reasonCode: 'outcome-processing-error',
        diagnostic,
      });
      return { kind: 'processing-error', diagnostic, checkpoint };
    }
  }
}
