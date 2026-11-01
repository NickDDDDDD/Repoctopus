import { describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import {
  runtimeStabilityFacts,
  runtimeStabilityMeasurements,
} from '../domains/runtime/stability.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { runtimeStabilityMetricAttributes } from '../platform/telemetry/opentelemetry/mapping.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

function telemetryBatch(events: TrajectoryEvent[]): TelemetryBatch {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  return {
    run: startRun({
      workflow,
      runId: 'runtime-stability',
      projectSnapshotDigest: projectSnapshot.digest,
      composition: compositionFixture(),
      timestamp: '2026-11-01T00:00:00.000Z',
      traceId: '1'.repeat(32),
    }),
    workflow,
    projectSnapshot,
    events,
    trajectory: events,
  };
}

function event(
  sequence: number,
  type: TrajectoryEvent['type'],
  data: TrajectoryEvent['data'],
): TrajectoryEvent {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `event-${sequence}`,
    timestamp: `2026-11-01T00:00:0${sequence}.000Z`,
    type,
    runId: 'runtime-stability',
    stateVersion: sequence,
    compositionDigest: compositionFixture().compositionDigest,
    data,
  };
}

describe('Runtime stability facts', () => {
  it('projects invalidation and Build revalidation counts without using counts as labels', () => {
    const transition = event(1, 'change.lifecycle.transitioned', {
      changeLifecycleTransition: {
        schemaVersion: 2,
        transitionId: 'design.approved',
        definition: {
          id: 'builtin.change-lifecycle',
          version: '1',
          digest: `sha256:${'a'.repeat(64)}`,
        },
        revision: 1,
        from: { phase: 'design', status: 'waiting', checkEpoch: 1 },
        to: { phase: 'build', status: 'running', checkEpoch: 2 },
        workId: 'build.plan:stable',
        waitId: null,
        invalidation: {
          kind: 'planning-authority-invalidated',
          invalidationKind: 'semantic',
          classification: 'semantic',
          disposition: 'invalidate',
          scope: 'exact',
          continuation: 'design',
          retainedCount: 3,
          invalidatedCount: 6,
          protocolDisposition: 'suspended',
          completionBeforeCount: 2,
          supersededPlanningDigest: `sha256:${'b'.repeat(64)}`,
          observedPlanningDigest: `sha256:${'c'.repeat(64)}`,
          supersededWorkId: 'build.execute:old',
          supersededTaskRevisions: [],
          evidenceIds: [],
        },
        buildRevalidation: {
          protocolDisposition: 'retained-binding',
          completionBeforeCount: 2,
          completionRetainedCount: 1,
        },
      },
    });
    const batch = telemetryBatch([transition]);
    const facts = runtimeStabilityFacts(batch, transition);

    expect(facts).toMatchObject([
      { kind: 'invalidation', result: 'exact', retainedCount: 3, invalidatedCount: 6 },
      {
        kind: 'protocol-revalidation',
        result: 'retained-binding',
        completionBeforeCount: 2,
        completionRetainedCount: 1,
      },
    ]);
    expect(facts.flatMap(runtimeStabilityMeasurements)).toEqual([
      { measure: 'retained-identities', value: 3 },
      { measure: 'invalidated-identities', value: 6 },
      { measure: 'completion-before', value: 2 },
      { measure: 'completion-retained', value: 1 },
    ]);
    for (const fact of facts) {
      expect(JSON.stringify(runtimeStabilityMetricAttributes(fact))).not.toMatch(
        /retainedCount|invalidatedCount|completionBeforeCount|completionRetainedCount|sha256:|C:\\/u,
      );
    }
  });

  it('classifies duplicate approvals, checkpoint recovery, dispatch suppression, and reconciliation', () => {
    const firstApproval = event(1, 'change.lifecycle.transitioned', {
      observation: {
        kind: 'design-gate',
        result: 'waiting',
        requestId: 'request-1',
        proposalDigest: `sha256:${'a'.repeat(64)}`,
      },
    });
    const duplicateApproval = event(2, 'change.lifecycle.transitioned', {
      observation: {
        kind: 'design-gate',
        result: 'waiting',
        requestId: 'request-2',
        proposalDigest: `sha256:${'a'.repeat(64)}`,
      },
    });
    const recovery = event(3, 'work.packet-recovered', { result: 'recovered' });
    const dispatch = event(4, 'continuation.selected', {
      continuation: 'execute',
      dispatchSuppressed: true,
      result: 'suppressed',
    });
    const unknown = event(5, 'reconcile.started', {});
    const notExecuted = event(6, 'reconcile.completed', { result: 'not-executed' });
    const executed = event(7, 'work.outcome-submitted', { submissionId: 'reconcile:invocation-1' });
    const events = [
      firstApproval,
      duplicateApproval,
      recovery,
      dispatch,
      unknown,
      notExecuted,
      executed,
    ];
    const batch = telemetryBatch(events);

    expect(events.flatMap((item) => runtimeStabilityFacts(batch, item))).toMatchObject([
      { kind: 'approval-request', result: 'created' },
      { kind: 'approval-request', result: 'duplicate' },
      { kind: 'checkpoint-recovery', result: 'recovered' },
      { kind: 'dispatch', result: 'suppressed', continuation: 'execute' },
      { kind: 'reconciliation', result: 'unknown' },
      { kind: 'reconciliation', result: 'not-executed' },
      { kind: 'reconciliation', result: 'executed' },
    ]);
  });
});
