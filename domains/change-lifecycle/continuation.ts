import type { Checkpoint, TrajectoryEvent } from '../trajectory/types.js';
import type { WorkExecutionRecovery } from '../work-execution/types.js';
import type { ChangeLifecycleSnapshot, ChangeNextAction } from './transition.js';

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
  'transition-pending',
  'content-missing-or-corrupt',
  'open-observation-unavailable',
  'migration-required',
  'project-drift',
]);

function isRecoveryReason(value: unknown): value is WorkExecutionRecovery['reason'] {
  return (
    typeof value === 'string' && RECOVERY_REASONS.has(value as WorkExecutionRecovery['reason'])
  );
}

function matchesCurrentCheckpoint(
  event: TrajectoryEvent,
  checkpoint: Checkpoint,
  workId: string | null,
): boolean {
  if (event.type !== 'continuation.selected' || event.stateVersion > checkpoint.stateVersion) {
    return false;
  }
  const selectedWorkId = typeof event.data.workId === 'string' ? event.data.workId : null;
  return selectedWorkId === workId;
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
  const execution = checkpoint.workExecution;
  const executionMatches = Boolean(
    execution &&
    lifecycle.currentWork?.workId === execution.workId &&
    lifecycle.checkEpoch === execution.checkEpoch,
  );
  const current = executionMatches ? execution : undefined;
  const workId = current?.workId ?? lifecycle.currentWork?.workId ?? null;
  const attempt = current?.attempt ?? null;
  const checkEpoch = current?.checkEpoch ?? lifecycle.checkEpoch;
  const result = (
    continuation: WorkExecutionRecovery['continuation'],
    reason: WorkExecutionRecovery['reason'],
  ): WorkExecutionRecovery => ({
    schemaVersion: 2,
    continuation,
    workId,
    attempt,
    checkEpoch,
    reason,
  });

  const selected = [...trajectory]
    .reverse()
    .find((event) => matchesCurrentCheckpoint(event, checkpoint, workId));
  if (
    selected &&
    typeof selected.data.continuation === 'string' &&
    ['execute', 'ask', 'wait', 'reconcile', 'awaiting-correction', 'done'].includes(
      selected.data.continuation,
    ) &&
    isRecoveryReason(selected.data.reason)
  ) {
    return result(
      selected.data.continuation as WorkExecutionRecovery['continuation'],
      selected.data.reason,
    );
  }

  if (checkpoint.runStatus === 'completed') return result('done', 'terminal');
  if (lifecycle.waitCondition?.kind === 'human-decision') {
    return result('ask', 'human-decision');
  }
  if (execution && !executionMatches) {
    return lifecycle.currentWork
      ? result('execute', 'checkpoint-superseded')
      : result('wait', 'checkpoint-superseded');
  }
  if (!current) {
    return lifecycle.currentWork
      ? result('execute', 'work-unclaimed')
      : result('wait', 'transition-pending');
  }
  if (current.schemaVersion !== 3) return result('reconcile', 'migration-required');
  if (current.status === 'claimed' || current.status === 'context-delivered') {
    return result('execute', 'claim-redelivery');
  }
  if (current.status === 'submitted') {
    return current.continuation === 'execute'
      ? result('execute', 'validator-pending')
      : result('execute', 'outcome-processing-error');
  }
  if (current.status === 'invoking') {
    return current.continuation === 'awaiting-correction'
      ? result('awaiting-correction', 'outcome-rejected')
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
  if (current.status === 'not-executed') return result('execute', 'host-not-executed');
  if (current.status === 'outcome') {
    return current.actionOutcome?.status === 'failed'
      ? result('execute', 'work-failed')
      : result('execute', 'validator-pending');
  }
  return result('execute', 'transition-pending');
}

export function projectLifecycleNextActions(
  snapshot: ChangeLifecycleSnapshot,
): readonly ChangeNextAction[] {
  if (['completed', 'failed', 'migration_required'].includes(snapshot.status)) return [];
  if (snapshot.phase === 'open') {
    if (snapshot.currentWork) {
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
