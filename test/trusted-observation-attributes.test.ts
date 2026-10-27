import { describe, expect, it } from 'vitest';

import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import { validateObservationMetricAttributes } from '../domains/telemetry/observation-contract.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { encodeObservationEnvelopes } from '../platform/telemetry/opentelemetry/envelope-encoder.js';
import { safeEventAttributes } from '../platform/telemetry/opentelemetry/mapping.js';
import { acceptedChangeLifecycleTelemetry } from '../platform/telemetry/change-lifecycle-mapping.js';
import { mapTrajectoryObservationEnvelope } from '../platform/telemetry/workflow-observation-mapping.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

function fixture() {
  const workflow = workflowFixture();
  const projectSnapshot = projectFixture();
  const base = startRun({
    workflow,
    runId: 'run-trusted-correlation',
    projectSnapshotDigest: projectSnapshot.digest,
    composition: compositionFixture(),
    timestamp: '2026-10-27T08:00:00.000Z',
    traceId: '7'.repeat(32),
  });
  const run = {
    ...base,
    currentStep: 'archive-from-latest-snapshot',
    changeLifecycle: {
      ...createChangeLifecycleSnapshot({
        identity: {
          workspaceId: projectSnapshot.projectId,
          changeId: 'trusted-correlation',
          runId: base.runId,
        },
      }),
      phase: 'archive' as const,
    },
  };
  const context = {
    schemaVersion: 1,
    phase: 'build',
    work: { id: 'build:4.4:trusted', kind: 'task.implement' },
    attempt: 2,
    checkEpoch: 51,
    task: { id: '4.4', revision: `sha256:${'a'.repeat(64)}` },
  } as const;
  const event = (
    sequence: number,
    type: TrajectoryEvent['type'],
    data: TrajectoryEvent['data'],
  ): TrajectoryEvent => ({
    schemaVersion: 1,
    sequence,
    eventId: `trusted-${sequence}`,
    timestamp: `2026-10-27T08:00:0${sequence}.000Z`,
    type,
    runId: run.runId,
    stateVersion: sequence,
    compositionDigest: run.composition.compositionDigest,
    data,
  });
  const events = [
    event(1, 'work.host-completed', {
      executionContext: context,
      invocationId: 'invocation-trusted-1',
      hostId: 'external:cli:codex-root',
      packetDigest: `sha256:${'b'.repeat(64)}`,
      result: 'succeeded',
    }),
    event(2, 'skill.delivered', {
      executionContext: context,
      skillName: 'team-architecture-review',
      skillRole: 'augmentation',
      result: 'delivered',
    }),
    event(3, 'validator.completed', {
      executionContext: context,
      validatorId: 'build.task-valid',
      operationId: 'validator-operation-1',
      result: 'accepted',
    }),
    event(4, 'decision.requested', {
      phase: 'design',
      decisionId: 'design-approval-1',
      decisionKind: 'design-approval',
    }),
    event(5, 'continuation.selected', {
      executionContext: context,
      continuation: 'execute',
    }),
  ];
  const batch: TelemetryBatch = {
    run,
    workflow,
    projectSnapshot,
    events,
    trajectory: events,
  };
  return { batch, context, event };
}

describe('trusted observation attributes', () => {
  it('maps persisted Workspace, change, Run, hierarchy, phase, executor, Task, Skill, validation, blocker, next action, and observed time', () => {
    const { batch } = fixture();
    const [host, skill, validator, decision, continuation] = batch.events.map((event) =>
      safeEventAttributes(batch, event),
    );

    expect(host).toMatchObject({
      'repoctopus.workspace.id': batch.projectSnapshot.projectId,
      'repoctopus.change.id': 'trusted-correlation',
      'repoctopus.run.id': 'run-trusted-correlation',
      'repoctopus.observation.observed_at': '2026-10-27T08:00:01.000Z',
      'repoctopus.execution.phase': 'build',
      'repoctopus.execution.entity.kind': 'host',
      'repoctopus.execution.entity.id': 'invocation-trusted-1',
      'repoctopus.execution.parent.kind': 'work',
      'repoctopus.execution.parent.id': 'build:4.4:trusted',
      'repoctopus.executor.kind': 'host',
      'repoctopus.executor.id': 'external:cli:codex-root',
      'repoctopus.task.id': '4.4',
      'repoctopus.task.revision': `sha256:${'a'.repeat(64)}`,
    });
    expect(host).not.toHaveProperty('repoctopus.stage.name');
    expect(skill).toMatchObject({
      'repoctopus.execution.entity.kind': 'skill',
      'repoctopus.execution.parent.id': 'build:4.4:trusted',
      'repoctopus.skill.name': 'team-architecture-review',
      'repoctopus.skill.role': 'augmentation',
      'repoctopus.skill.state': 'delivered',
    });
    expect(validator).toMatchObject({
      'repoctopus.execution.entity.kind': 'validator',
      'repoctopus.execution.parent.id': 'build:4.4:trusted',
      'repoctopus.validator.id': 'build.task-valid',
      'repoctopus.validator.result': 'accepted',
    });
    expect(decision).toMatchObject({
      'repoctopus.execution.phase': 'design',
      'repoctopus.execution.entity.kind': 'decision',
      'repoctopus.execution.entity.id': 'design-approval-1',
      'repoctopus.execution.parent.kind': 'run',
      'repoctopus.execution.parent.id': 'run-trusted-correlation',
      'repoctopus.blocker.kind': 'human-decision',
      'repoctopus.blocker.id': 'design-approval-1',
    });
    expect(continuation).toMatchObject({
      'repoctopus.next_action.kind': 'execute',
      'repoctopus.execution.parent.id': 'build:4.4:trusted',
    });
  });

  it('does not infer missing execution facts from the latest Run snapshot and keeps identities out of Metrics', () => {
    const { batch, event } = fixture();
    const missing = event(6, 'work.host-completed', {
      result: 'succeeded',
      nextAction: 'invented-from-ui',
      executor: 'invented-agent',
      taskId: 'invented-task',
      validatorId: 'invented-validator',
      blocker: 'invented-blocker',
    });
    const attributes = safeEventAttributes({ ...batch, events: [missing] }, missing);

    expect(attributes).toMatchObject({
      'repoctopus.workspace.id': batch.projectSnapshot.projectId,
      'repoctopus.change.id': 'trusted-correlation',
      'repoctopus.run.id': 'run-trusted-correlation',
      'repoctopus.execution.context.status': 'missing',
    });
    for (const key of [
      'repoctopus.execution.phase',
      'repoctopus.execution.entity.id',
      'repoctopus.execution.parent.id',
      'repoctopus.executor.id',
      'repoctopus.task.id',
      'repoctopus.skill.name',
      'repoctopus.validator.id',
      'repoctopus.blocker.kind',
      'repoctopus.next_action.kind',
      'repoctopus.stage.name',
    ]) {
      expect(attributes).not.toHaveProperty(key);
    }

    const host = batch.events[0]!;
    const envelope = mapTrajectoryObservationEnvelope(batch, host);
    expect(envelope).not.toBeNull();
    const metrics = encodeObservationEnvelopes([envelope!]).metrics;
    expect(JSON.stringify(metrics)).not.toMatch(
      /trusted-correlation|run-trusted|build:4\.4|invocation-trusted|codex-root|build\.task-valid/u,
    );
    for (const identity of [
      'workspace.id',
      'change.id',
      'run.id',
      'work.id',
      'task.id',
      'host.id',
      'validator.id',
    ]) {
      expect(() =>
        validateObservationMetricAttributes('work.host-completed', { [identity]: 'identity-1' }),
      ).toThrow(`Unsafe Metric dimension ${identity}`);
    }
  });

  it('applies the same persisted identity and observation-time correlation to lifecycle records', () => {
    const { batch, event } = fixture();
    const transition = event(6, 'change.lifecycle.transitioned', {
      changeLifecycleTransition: {
        schemaVersion: 2,
        transitionId: 'build.await-host',
        definition: batch.run.changeLifecycle!.definition,
        revision: 1,
        from: { phase: 'build', status: 'running', checkEpoch: 50 },
        to: { phase: 'build', status: 'waiting', checkEpoch: 51 },
        workId: null,
        waitId: null,
        work: null,
        wait: null,
      },
    });

    const records = acceptedChangeLifecycleTelemetry(batch, transition);
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record.attributes).toMatchObject({
        'repoctopus.workspace.id': batch.projectSnapshot.projectId,
        'repoctopus.change.id': 'trusted-correlation',
        'repoctopus.run.id': 'run-trusted-correlation',
        'repoctopus.observation.observed_at': '2026-10-27T08:00:06.000Z',
      });
    }
  });
});
