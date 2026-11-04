import type { RecoveryDecision } from './recovery.js';

export interface RecoveryDecisionCheckpoint {
  runId: string;
  revision: number;
  checkEpoch: number;
  appliedDecisionIds: string[];
}

export interface RecoveryDecisionStorePort {
  read(runId: string): Promise<RecoveryDecisionCheckpoint>;
  compareAndSwap(input: {
    runId: string;
    expectedRevision: number;
    expectedCheckEpoch: number;
    decisionId: string;
  }): Promise<boolean>;
}

export type RecoveryDecisionApplication =
  | {
      status: 'applied' | 'already-applied';
      decisionId: string;
      currentRevision: number;
      currentCheckEpoch: number;
    }
  | {
      status: 'revision-conflict';
      decisionId: string;
      currentRevision: number;
      currentCheckEpoch: number;
    };

function result(
  status: RecoveryDecisionApplication['status'],
  decision: RecoveryDecision,
  checkpoint: RecoveryDecisionCheckpoint,
): RecoveryDecisionApplication {
  return {
    status,
    decisionId: decision.decisionId,
    currentRevision: checkpoint.revision,
    currentCheckEpoch: checkpoint.checkEpoch,
  };
}

function matchesExpected(
  checkpoint: RecoveryDecisionCheckpoint,
  decision: RecoveryDecision,
): boolean {
  return (
    checkpoint.runId === decision.runId &&
    checkpoint.revision === decision.expectedRevision &&
    checkpoint.checkEpoch === decision.checkEpoch
  );
}

export async function applyRecoveryDecision(
  store: RecoveryDecisionStorePort,
  decision: RecoveryDecision,
): Promise<RecoveryDecisionApplication> {
  const current = await store.read(decision.runId);
  if (current.appliedDecisionIds.includes(decision.decisionId)) {
    return result('already-applied', decision, current);
  }
  if (!matchesExpected(current, decision)) {
    return result('revision-conflict', decision, current);
  }

  const applied = await store.compareAndSwap({
    runId: decision.runId,
    expectedRevision: decision.expectedRevision,
    expectedCheckEpoch: decision.checkEpoch,
    decisionId: decision.decisionId,
  });
  const settled = await store.read(decision.runId);
  if (applied) return result('applied', decision, settled);
  if (settled.appliedDecisionIds.includes(decision.decisionId)) {
    return result('already-applied', decision, settled);
  }
  return result('revision-conflict', decision, settled);
}
