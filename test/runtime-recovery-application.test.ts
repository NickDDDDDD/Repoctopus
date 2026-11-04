import { describe, expect, it } from 'vitest';

import {
  applyRecoveryDecision,
  type RecoveryDecisionCheckpoint,
  type RecoveryDecisionStorePort,
} from '../domains/runtime/recovery-application.js';
import { classifyRecoveryObservation, type RecoveryDecision } from '../domains/runtime/recovery.js';

class InMemoryRecoveryDecisionStore implements RecoveryDecisionStorePort {
  checkpoint: RecoveryDecisionCheckpoint = {
    runId: 'run-1',
    revision: 7,
    checkEpoch: 3,
    appliedDecisionIds: [],
  };

  read(): Promise<RecoveryDecisionCheckpoint> {
    return Promise.resolve(structuredClone(this.checkpoint));
  }

  async compareAndSwap(input: {
    runId: string;
    expectedRevision: number;
    expectedCheckEpoch: number;
    decisionId: string;
  }): Promise<boolean> {
    await Promise.resolve();
    if (
      input.runId !== this.checkpoint.runId ||
      input.expectedRevision !== this.checkpoint.revision ||
      input.expectedCheckEpoch !== this.checkpoint.checkEpoch
    ) {
      return false;
    }
    this.checkpoint = {
      ...this.checkpoint,
      revision: this.checkpoint.revision + 1,
      appliedDecisionIds: [...this.checkpoint.appliedDecisionIds, input.decisionId],
    };
    return true;
  }
}

function decision(expectedRevision = 7, observationId = 'observation-1'): RecoveryDecision {
  const result = classifyRecoveryObservation({
    schemaVersion: 1,
    runId: 'run-1',
    expectedRevision,
    checkEpoch: 3,
    observationId,
    planning: {
      status: 'drift',
      reasonCode: 'requirements-changed',
      changedIdentities: ['planning-semantic'],
    },
    plan: { status: 'current', changedIdentities: [] },
    work: { status: 'current', changedIdentities: [] },
    evidence: { status: 'current', changedIdentities: [] },
  });
  if (!result) throw new Error('expected a recovery decision');
  return result;
}

describe('Recovery decision application', () => {
  it('converges concurrent duplicate submissions to one checkpoint', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    const recoveryDecision = decision();

    const results = await Promise.all([
      applyRecoveryDecision(store, recoveryDecision),
      applyRecoveryDecision(store, recoveryDecision),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['already-applied', 'applied']);
    expect(store.checkpoint).toMatchObject({
      revision: 8,
      appliedDecisionIds: [recoveryDecision.decisionId],
    });
  });

  it('returns a revision conflict for a different stale decision', async () => {
    const store = new InMemoryRecoveryDecisionStore();
    await applyRecoveryDecision(store, decision());

    await expect(
      applyRecoveryDecision(store, decision(7, 'different-observation')),
    ).resolves.toMatchObject({
      status: 'revision-conflict',
      currentRevision: 8,
      currentCheckEpoch: 3,
    });
  });
});
