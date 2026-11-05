import type { WorkOutcomeAcceptance } from '../domains/action/types.js';
import type { WorkDescriptor } from '../domains/change-lifecycle/transition.js';
import {
  createAcceptedBuildWorkOutcome,
  type BuildWorkOutcomeDisposition,
  validateBuildWorkResultShape,
} from '../domains/work-execution/acceptance.js';
import type {
  WorkExecutionCheckpoint,
  WorkExecutionHostOutcome,
  WorkExecutionSubmission,
} from '../domains/work-execution/types.js';
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
    stableInputDigest?: `sha256:${string}`;
    assertTransitionFeasible: () => void;
  }): Promise<WorkOutcomeAcceptance> {
    if (input.candidate.terminalized) {
      throw new Error('Build Work Outcome candidate is already terminalized');
    }
    input.assertTransitionFeasible();
    const disposition = createAcceptedBuildWorkOutcome({
      work: input.candidate.work,
      submission: input.candidate.submission,
      validatorId: input.validatorId,
      ...(input.stableInputDigest ? { stableInputDigest: input.stableInputDigest } : {}),
    });
    if (disposition.kind !== 'accepted') {
      throw new Error(`Build Work Outcome cannot be accepted: ${disposition.diagnostic}`);
    }
    const intent = await this.dependencies.workExecutionAuthority.loadIntent(input.runId);
    return this.dependencies.workDispatcher.acceptValidatedOutcome({
      outcome: this.dependencies.workDispatcher.outcome(
        intent,
        'succeeded',
        input.candidate.outcome.summary,
      ),
      validation: disposition.validation,
    });
  }
}
