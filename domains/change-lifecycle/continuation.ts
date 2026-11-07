import type { Checkpoint, TrajectoryEvent } from '../trajectory/types.js';
import type { WorkExecutionCheckpoint, WorkExecutionRecovery } from '../work-execution/types.js';
import { workExecutionRetryPolicy } from '../work-execution/retry-policy.js';
import type {
  ChangeLifecycleSnapshot,
  ChangeLifecycleState,
  ChangeNextAction,
  RunStatus,
} from './transition.js';

const RECOVERY_REASONS = new Set<WorkExecutionRecovery['reason']>([
  'terminal',
  'human-decision',
  'work-unclaimed',
  'claim-redelivery',
  'host-active',
  'host-result-unknown',
  'external-result-unknown',
  'host-not-executed',
  'work-failed',
  'outcome-rejected',
  'outcome-processing-error',
  'validator-pending',
  'checkpoint-superseded',
  'checkpoint-superseded-unresolved',
  'retry-policy-blocked',
  'transition-pending',
  'open-gate-pending',
  'content-missing-or-corrupt',
  'open-observation-unavailable',
  'evidence-observation-unavailable',
  'publication-checkpoint-stale',
  'migration-required',
  'project-drift',
]);

function isRecoveryReason(value: unknown): value is WorkExecutionRecovery['reason'] {
  return (
    typeof value === 'string' && RECOVERY_REASONS.has(value as WorkExecutionRecovery['reason'])
  );
}

export function isCompletedChangeRun(state: {
  status: RunStatus;
  changeLifecycle?: ChangeLifecycleState;
}): boolean {
  return state.status === 'completed' && state.changeLifecycle !== undefined;
}

function matchesCurrentCheckpoint(
  event: TrajectoryEvent,
  checkpoint: Checkpoint,
  workId: string | null,
): boolean {
  if (
    event.type !== 'continuation.selected' ||
    event.runId !== checkpoint.runId ||
    event.stateVersion !== checkpoint.stateVersion
  ) {
    return false;
  }
  const selectedWorkId = typeof event.data.workId === 'string' ? event.data.workId : null;
  const selectedAttempt =
    typeof event.data.attempt === 'number' && Number.isSafeInteger(event.data.attempt)
      ? event.data.attempt
      : null;
  const selectedCheckEpoch =
    typeof event.data.checkEpoch === 'number' && Number.isSafeInteger(event.data.checkEpoch)
      ? event.data.checkEpoch
      : null;
  return (
    selectedWorkId === workId &&
    selectedAttempt === (checkpoint.workExecution?.attempt ?? null) &&
    selectedCheckEpoch === (checkpoint.changeLifecycle?.checkEpoch ?? null)
  );
}

export interface WorkContinuationClassificationInput {
  runStatus: RunStatus;
  lifecycle: ChangeLifecycleState;
  execution?: WorkExecutionCheckpoint;
  invokingHostActive?: boolean;
}

/**
 * Classifies the next Runtime-owned continuation from persisted Work identity only.
 *
 * Provider and packet reads happen before this function and may fail closed separately. Keeping
 * this table pure lets `next`, `resume`, recovery and read-only projections share one state model.
 */
export function classifyWorkContinuation(
  input: WorkContinuationClassificationInput,
): WorkExecutionRecovery {
  const executionMatches = Boolean(
    input.execution &&
    input.lifecycle.currentWork?.workId === input.execution.workId &&
    input.lifecycle.checkEpoch === input.execution.checkEpoch,
  );
  const current = executionMatches ? input.execution : undefined;
  const result = (
    continuation: WorkExecutionRecovery['continuation'],
    reason: WorkExecutionRecovery['reason'],
    execution: WorkExecutionCheckpoint | undefined = current,
  ): WorkExecutionRecovery => ({
    schemaVersion: 2,
    continuation,
    workId: execution?.workId ?? input.lifecycle.currentWork?.workId ?? null,
    attempt: execution?.attempt ?? null,
    checkEpoch: execution?.checkEpoch ?? input.lifecycle.checkEpoch,
    reason,
  });

  if (input.runStatus === 'completed') return result('done', 'terminal');
  if (input.lifecycle.waitCondition?.kind === 'human-decision') {
    return result('ask', 'human-decision');
  }
  if (input.execution && !executionMatches) {
    if (['invoking', 'submitted', 'unknown'].includes(input.execution.status)) {
      return result('reconcile', 'checkpoint-superseded-unresolved', input.execution);
    }
    return input.lifecycle.currentWork
      ? result('execute', 'checkpoint-superseded')
      : result('wait', 'checkpoint-superseded');
  }
  if (!current) {
    return input.lifecycle.currentWork
      ? result('execute', 'work-unclaimed')
      : result('wait', 'transition-pending');
  }
  if (
    current.schemaVersion !== 3 ||
    !/^execution-chain:sha256:[a-f0-9]{64}$/u.test(current.executionChainId ?? '') ||
    (current.retryPolicy !== 'idempotent' && current.retryPolicy !== 'reconcile')
  ) {
    return result('reconcile', 'migration-required');
  }
  if (current.status === 'claimed' || current.status === 'context-delivered') {
    return result('execute', 'claim-redelivery');
  }
  if (current.status === 'submitted') {
    return current.continuation === 'execute'
      ? result('execute', 'validator-pending')
      : result('execute', 'outcome-processing-error');
  }
  if (current.status === 'invoking') {
    if (current.continuation === 'awaiting-correction') {
      return result('awaiting-correction', 'outcome-rejected');
    }
    return input.invokingHostActive === false
      ? result('reconcile', 'host-result-unknown')
      : result('wait', 'host-active');
  }
  if (current.status === 'unknown') {
    return result(
      'reconcile',
      current.unknownKind === 'external-side-effect'
        ? 'external-result-unknown'
        : 'host-result-unknown',
    );
  }
  if (current.status === 'not-executed') {
    return current.attempt >= 3 || (current.rejectedSubmissions?.length ?? 0) > 0
      ? result('wait', 'retry-policy-blocked')
      : result('execute', 'host-not-executed');
  }
  if (current.status === 'outcome') {
    if (current.actionOutcome?.status !== 'failed') {
      return result('execute', 'validator-pending');
    }
    if (
      (current.rejectedSubmissions?.length ?? 0) > 0 ||
      workExecutionRetryPolicy(input.lifecycle.currentWork!) === 'reconcile' ||
      current.attempt >= 3
    ) {
      return result('wait', 'retry-policy-blocked');
    }
    return result('execute', 'work-failed');
  }
  if (current.status === 'validated' && input.lifecycle.phase === 'open') {
    return { ...result('reobserve', 'open-gate-pending'), observationStage: 'planning-gate' };
  }
  return result('execute', 'transition-pending');
}

/**
 * Projects the public continuation solely from committed Run evidence.
 *
 * Dynamic packet and Host checks belong to `next`/`resume`. Once those checks select a
 * continuation, the Runtime commits `continuation.selected`; subsequent readers replay that fact
 * instead of repeating I/O or inferring from the working tree.
 */
export function projectCommittedContinuation(
  checkpoint: Checkpoint,
  trajectory: readonly TrajectoryEvent[],
): WorkExecutionRecovery | undefined {
  const lifecycle = checkpoint.changeLifecycle;
  if (!lifecycle) return undefined;
  const classified = classifyWorkContinuation({
    runStatus: checkpoint.runStatus ?? 'running',
    lifecycle,
    ...(checkpoint.workExecution ? { execution: checkpoint.workExecution } : {}),
  });
  if (classified.continuation === 'done' && classified.reason === 'terminal') {
    return classified;
  }
  const workId = classified.workId;
  const result = (
    continuation: WorkExecutionRecovery['continuation'],
    reason: WorkExecutionRecovery['reason'],
  ): WorkExecutionRecovery => ({
    schemaVersion: 2,
    continuation,
    workId,
    attempt: classified.attempt,
    checkEpoch: classified.checkEpoch,
    reason,
  });

  const selected = [...trajectory]
    .reverse()
    .find((event) => matchesCurrentCheckpoint(event, checkpoint, workId));
  if (
    selected &&
    typeof selected.data.continuation === 'string' &&
    ['execute', 'reobserve', 'ask', 'wait', 'reconcile', 'awaiting-correction', 'done'].includes(
      selected.data.continuation,
    ) &&
    isRecoveryReason(selected.data.reason)
  ) {
    const projected = result(
      selected.data.continuation as WorkExecutionRecovery['continuation'],
      selected.data.reason,
    );
    return selected.data.observationStage === 'provider-validation' ||
      selected.data.observationStage === 'planning-gate' ||
      selected.data.observationStage === 'evidence-inputs'
      ? { ...projected, observationStage: selected.data.observationStage }
      : projected;
  }

  return classified;
}

export function projectLifecycleNextActions(
  snapshot: ChangeLifecycleSnapshot,
  continuation?: WorkExecutionRecovery,
): readonly ChangeNextAction[] {
  if (['completed', 'failed', 'migration_required'].includes(snapshot.status)) return [];
  if (snapshot.phase === 'archive' && continuation?.reason === 'publication-checkpoint-stale')
    return [
      {
        id: 'archive.preflight',
        kind: 'repair',
        label: 'Refresh the authorized Archive publication preflight',
      },
    ];
  if (snapshot.phase === 'open') {
    if (snapshot.currentWork) {
      if (
        continuation?.continuation === 'reobserve' &&
        continuation.reason === 'open-gate-pending'
      ) {
        return [
          {
            id: snapshot.currentWork.workId,
            kind: 'work',
            label: 'Reobserve Open planning gate',
          },
        ];
      }
      return [
        {
          id: snapshot.currentWork.workId,
          kind: 'work',
          label: `Run ${snapshot.currentWork.kind}`,
        },
      ];
    }
    return snapshot.status === 'waiting'
      ? [{ id: 'open.review', kind: 'decision', label: 'Review Open baseline' }]
      : [];
  }
  if (snapshot.phase === 'design') {
    if (snapshot.status === 'waiting') {
      return [{ id: 'design.review', kind: 'decision', label: 'Review planning decision' }];
    }
    if (snapshot.status === 'blocked') {
      return [{ id: 'design.repair', kind: 'repair', label: 'Repair planning artifacts' }];
    }
    return [{ id: 'design.evaluate', kind: 'work', label: 'Evaluate Design gate' }];
  }
  if (snapshot.phase === 'build') {
    if (snapshot.currentWork) {
      return [
        {
          id: snapshot.currentWork.workId,
          kind: 'work',
          label: `Run ${snapshot.currentWork.kind}`,
        },
      ];
    }
    if (snapshot.status === 'waiting') {
      return [{ id: 'build.review', kind: 'decision', label: 'Review Build decision' }];
    }
    if (snapshot.status === 'blocked') {
      return [{ id: 'build.blocked', kind: 'wait', label: 'Resolve Build blocker' }];
    }
    return [
      {
        id: 'build.prepare-verification',
        kind: 'work',
        label: 'Prepare immutable verification input',
      },
    ];
  }
  if (snapshot.phase === 'verify' && snapshot.currentWork?.kind === 'evidence.verify') {
    return [
      {
        id: snapshot.currentWork.workId,
        kind: 'work',
        label: 'Run the required Evidence profile',
      },
    ];
  }
  if (snapshot.phase === 'archive' && snapshot.currentWork?.kind === 'specification.close') {
    return [
      {
        id: snapshot.currentWork.workId,
        kind: 'work',
        label: 'Close the verified Specification change',
      },
    ];
  }
  if (snapshot.phase === 'archive' && snapshot.currentWork?.kind === 'delivery.publish') {
    return [
      {
        id: snapshot.currentWork.workId,
        kind: 'work',
        label: 'Publish all merge requests and accept the Publication Receipt',
      },
    ];
  }
  if (snapshot.phase === 'archive' && snapshot.currentWork === null) {
    return [{ id: 'archive.prepare', kind: 'work', label: 'Prepare Archive Delivery input' }];
  }
  return [];
}
