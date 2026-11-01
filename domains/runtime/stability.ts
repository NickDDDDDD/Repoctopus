import type { TelemetryBatch } from './types.js';
import type { TrajectoryEvent } from '../trajectory/types.js';

export type RuntimeStabilityFact =
  | {
      schemaVersion: 1;
      kind: 'approval-request';
      authority: 'specification';
      result: 'created' | 'duplicate';
    }
  | {
      schemaVersion: 1;
      kind: 'invalidation';
      authority: 'runtime';
      result: 'exact' | 'conservative';
      classification: 'semantic' | 'approval-authority' | 'unknown';
      continuation: 'design' | 'human-decision';
      retainedCount: number;
      invalidatedCount: number;
    }
  | {
      schemaVersion: 1;
      kind: 'protocol-revalidation';
      authority: 'build-protocol';
      result: 'retained-configuration' | 'rebuilt-configuration';
      completionBeforeCount: number;
      completionRetainedCount: number;
    }
  | {
      schemaVersion: 1;
      kind: 'checkpoint-recovery';
      authority: 'work-execution';
      result: 'recovered' | 'missing' | 'corrupt' | 'legacy';
    }
  | {
      schemaVersion: 1;
      kind: 'dispatch';
      authority: 'runtime';
      result: 'selected' | 'suppressed';
      continuation: 'execute' | 'ask' | 'wait' | 'reconcile' | 'awaiting-correction' | 'done';
    }
  | {
      schemaVersion: 1;
      kind: 'reconciliation';
      authority: 'work-execution';
      result: 'unknown' | 'not-executed' | 'executed';
    };

export interface RuntimeStabilityMeasurement {
  measure:
    | 'retained-identities'
    | 'invalidated-identities'
    | 'completion-before'
    | 'completion-retained';
  value: number;
}

const CONTINUATIONS = new Set([
  'execute',
  'ask',
  'wait',
  'reconcile',
  'awaiting-correction',
  'done',
]);

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function approvalRequestFact(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): RuntimeStabilityFact | null {
  if (event.type !== 'change.lifecycle.transitioned') return null;
  const observation = event.data.observation;
  if (!observation || typeof observation !== 'object') return null;
  const value = observation as Record<string, unknown>;
  if (
    (value.kind !== 'open-gate' && value.kind !== 'design-gate') ||
    value.result !== 'waiting' ||
    typeof value.proposalDigest !== 'string'
  ) {
    return null;
  }
  const duplicate = batch.trajectory.some((candidate) => {
    if (
      candidate.sequence >= event.sequence ||
      candidate.type !== 'change.lifecycle.transitioned'
    ) {
      return false;
    }
    const prior = candidate.data.observation;
    if (!prior || typeof prior !== 'object') return false;
    const record = prior as Record<string, unknown>;
    return (
      (record.kind === 'open-gate' || record.kind === 'design-gate') &&
      record.result === 'waiting' &&
      record.proposalDigest === value.proposalDigest &&
      record.requestId !== value.requestId
    );
  });
  return {
    schemaVersion: 1,
    kind: 'approval-request',
    authority: 'specification',
    result: duplicate ? 'duplicate' : 'created',
  };
}

export function runtimeStabilityFacts(
  batch: TelemetryBatch,
  event: TrajectoryEvent,
): RuntimeStabilityFact[] {
  const facts: RuntimeStabilityFact[] = [];
  const approval = approvalRequestFact(batch, event);
  if (approval) facts.push(approval);

  const transition = event.data.changeLifecycleTransition;
  const invalidation = transition?.invalidation;
  if (invalidation) {
    const retainedCount = nonNegativeInteger(invalidation.retainedCount);
    const invalidatedCount = nonNegativeInteger(invalidation.invalidatedCount);
    if (retainedCount !== null && invalidatedCount !== null) {
      facts.push({
        schemaVersion: 1,
        kind: 'invalidation',
        authority: 'runtime',
        result: invalidation.scope,
        classification: invalidation.classification,
        continuation: invalidation.continuation,
        retainedCount,
        invalidatedCount,
      });
    }
  }
  const revalidation = transition?.buildRevalidation;
  if (revalidation) {
    const completionBeforeCount = nonNegativeInteger(revalidation.completionBeforeCount);
    const completionRetainedCount = nonNegativeInteger(revalidation.completionRetainedCount);
    if (completionBeforeCount !== null && completionRetainedCount !== null) {
      facts.push({
        schemaVersion: 1,
        kind: 'protocol-revalidation',
        authority: 'build-protocol',
        result: revalidation.protocolDisposition,
        completionBeforeCount,
        completionRetainedCount,
      });
    }
  }
  if (event.type === 'work.packet-recovered') {
    const result = event.data.result;
    if (
      result === 'recovered' ||
      result === 'missing' ||
      result === 'corrupt' ||
      result === 'legacy'
    ) {
      facts.push({
        schemaVersion: 1,
        kind: 'checkpoint-recovery',
        authority: 'work-execution',
        result,
      });
    }
  }
  if (event.type === 'continuation.selected') {
    const continuation = event.data.continuation;
    if (typeof continuation === 'string' && CONTINUATIONS.has(continuation)) {
      facts.push({
        schemaVersion: 1,
        kind: 'dispatch',
        authority: 'runtime',
        result: event.data.dispatchSuppressed === true ? 'suppressed' : 'selected',
        continuation: continuation as Extract<
          RuntimeStabilityFact,
          { kind: 'dispatch' }
        >['continuation'],
      });
    }
  }
  if (event.type === 'reconcile.started') {
    facts.push({
      schemaVersion: 1,
      kind: 'reconciliation',
      authority: 'work-execution',
      result: 'unknown',
    });
  } else if (event.type === 'reconcile.completed' && event.data.result === 'not-executed') {
    facts.push({
      schemaVersion: 1,
      kind: 'reconciliation',
      authority: 'work-execution',
      result: 'not-executed',
    });
  } else if (
    event.type === 'work.outcome-submitted' &&
    typeof event.data.submissionId === 'string' &&
    event.data.submissionId.startsWith('reconcile:')
  ) {
    facts.push({
      schemaVersion: 1,
      kind: 'reconciliation',
      authority: 'work-execution',
      result: 'executed',
    });
  }
  return facts;
}

export function runtimeStabilityMeasurements(
  fact: RuntimeStabilityFact,
): RuntimeStabilityMeasurement[] {
  if (fact.kind === 'invalidation') {
    return [
      { measure: 'retained-identities', value: fact.retainedCount },
      { measure: 'invalidated-identities', value: fact.invalidatedCount },
    ];
  }
  if (fact.kind === 'protocol-revalidation') {
    return [
      { measure: 'completion-before', value: fact.completionBeforeCount },
      { measure: 'completion-retained', value: fact.completionRetainedCount },
    ];
  }
  return [];
}
