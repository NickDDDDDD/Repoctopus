import { describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import {
  mapWorkflowObservationEnvelope,
  workflowMetricAttributes,
  workflowObservationAttributes,
} from '../platform/telemetry/observation-workflow-mapping.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

describe('telemetry mapping', () => {
  it('keeps a persisted event envelope stable after the Run advances', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-envelope-replay',
      changeId: 'desktop-dashboard',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'event-envelope-replay',
      timestamp: run.createdAt,
      type: 'run.started',
      runId: run.runId,
      stateVersion: 0,
      compositionDigest: run.composition.compositionDigest,
      data: {},
    };
    const initial = mapWorkflowObservationEnvelope(
      {
        run,
        workflow,
        projectSnapshot: project,
        events: [event],
        trajectory: [event],
      },
      event,
    );
    const replayed = mapWorkflowObservationEnvelope(
      {
        run: { ...run, status: 'completed', currentStep: null, stateVersion: 4 },
        workflow,
        projectSnapshot: project,
        events: [event],
        trajectory: [event],
      },
      event,
    );

    expect(replayed).toEqual(initial);
    expect(initial?.attributes).toMatchObject({
      'repoctopus.change.status': 'active',
      'repoctopus.run.status': 'active',
      'repoctopus.stage.name': 'inspect',
    });
  });

  it('exports allowlisted metadata and drops paths, summaries and credentials', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '1'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'event-telemetry',
      timestamp: run.createdAt,
      type: 'action.completed',
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: run.composition.compositionDigest,
      data: {
        actionId: 'action-1',
        result: 'succeeded',
        summary: 'source code and prompt content',
        path: 'C:/secret/project',
        token: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
        cookie: 'session=secret',
        authorization: 'Bearer abc.def.ghi',
        environment: 'DATABASE_PASSWORD=secret',
        screenshot: 'data:image/png;base64,private',
        log: 'x'.repeat(1_000),
        skillName: 'teach',
        skillProvider: 'matt-builtins',
        skillContent: 'private learning notes',
        learningPath: 'C:/secret/project/.repoctopus/learning/runtime-design/notes.md',
        action: { type: 'checkpoint', ref: 'verified', summary: 'private prompt' },
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [event],
      trajectory: [event],
    };
    const attributes = workflowObservationAttributes(batch, event);
    expect(attributes['repoctopus.action.type']).toBe('checkpoint');
    expect(attributes['repoctopus.composition.digest']).toBe(run.composition.compositionDigest);
    expect(attributes['repoctopus.event.actionId']).toBe('action-1');
    expect(JSON.stringify(attributes)).not.toContain('C:/secret');
    expect(JSON.stringify(attributes)).not.toContain('source code');
    expect(JSON.stringify(attributes)).not.toContain('ghp_');
    expect(JSON.stringify(attributes)).not.toContain('session=secret');
    expect(JSON.stringify(attributes)).not.toContain('DATABASE_PASSWORD');
    expect(JSON.stringify(attributes)).not.toContain('data:image');
    expect(JSON.stringify(attributes)).not.toContain('private learning notes');
    expect(JSON.stringify(attributes)).not.toContain('.repoctopus/learning');
    expect(JSON.stringify(attributes)).not.toContain('matt-builtins');
  });

  it.each([
    ['post-merge.checkout-exact-commits', 'checkout-manifest'],
    ['post-merge.close-specification', 'specification-closure'],
    ['post-merge.audit-paths', 'path-audit'],
    ['post-merge.publish-change', 'publication'],
  ])('correlates %s with stable Post-merge and Evidence receipts', (ref, receiptKind) => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'post-merge-run',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '2'.repeat(32),
      trigger: {
        schemaVersion: 1,
        kind: 'post-merge',
        identityDigest: `sha256:${'a'.repeat(64)}`,
        facts: { changeId: 'enable-self-hosted-development' },
      },
    });
    const proposed: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'proposed',
      timestamp: run.createdAt,
      type: 'action.proposed',
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: run.composition.compositionDigest,
      data: { action: { id: 'action-1', type: 'call_tool', ref } },
    };
    const completed: TrajectoryEvent = {
      ...proposed,
      sequence: 2,
      eventId: 'completed',
      type: 'action.completed',
      data: {
        actionId: 'action-1',
        result: 'succeeded',
        actionReceiptId: 'b'.repeat(64),
        correlationReceiptId: `sha256:${'c'.repeat(64)}`,
        evidenceAttemptId: 'attempt-post-merge',
        evidenceGate: {
          bundleId: 'bundle-post-merge',
          status: 'satisfied',
          outcome: 'passed',
        },
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [completed],
      trajectory: [proposed, completed],
    };
    expect(workflowObservationAttributes(batch, completed)).toMatchObject({
      'repoctopus.post_merge.change.id': 'enable-self-hosted-development',
      'repoctopus.post_merge.merge_facts.digest': `sha256:${'a'.repeat(64)}`,
      'repoctopus.post_merge.receipt.kind': receiptKind,
      'repoctopus.post_merge.receipt.id': `sha256:${'c'.repeat(64)}`,
      'repoctopus.action.receipt.id': 'b'.repeat(64),
      'repoctopus.evidence.attempt.id': 'attempt-post-merge',
      'repoctopus.evidence.bundle.id': 'bundle-post-merge',
      'repoctopus.evidence.gate.status': 'satisfied',
      'repoctopus.evidence.outcome': 'passed',
    });
    const mappedMetrics = workflowMetricAttributes(batch, completed);
    const metrics = { ...mappedMetrics.event, ...mappedMetrics.step };
    expect(metrics).toEqual({
      'repoctopus.event.type': 'action.completed',
      'repoctopus.workflow.name': run.workflowName,
      'repoctopus.event.result': 'succeeded',
    });
    expect(JSON.stringify(metrics)).not.toMatch(/post-merge-run|sha256|receipt|attempt|bundle/u);
  });

  it('drops malformed Post-merge correlation and private event content', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'post-merge-private',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      trigger: {
        schemaVersion: 1,
        kind: 'post-merge',
        identityDigest: `sha256:${'d'.repeat(64)}`,
        facts: { changeId: 'ghp_12345678901234567890' },
      },
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'private-completion',
      timestamp: run.createdAt,
      type: 'action.completed',
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: run.composition.compositionDigest,
      data: {
        actionId: 'action-private',
        result: 'succeeded',
        correlationReceiptId: 'Bearer private-receipt',
        evidenceAttemptId: 'C:/private/attempt',
        evidenceGate: {
          bundleId: 'secret bundle body',
          status: 'satisfied',
          outcome: 'passed',
        },
        summary: 'private specification body',
        token: 'ghp_12345678901234567890',
      },
    };
    const attributes = workflowObservationAttributes(
      {
        run,
        workflow,
        projectSnapshot: project,
        events: [event],
        trajectory: [event],
      },
      event,
    );
    expect(JSON.stringify(attributes)).not.toMatch(
      /ghp_|Bearer private|C:\/private|secret bundle|specification body/u,
    );
  });

  it('maps persisted Run, task, parent execution, blocker and authoritative next action facts', () => {
    const workflow = workflowFixture();
    const project = projectFixture({ projectId: 'workspace-trusted' });
    const run = startRun({
      workflow,
      runId: 'run-trusted',
      changeId: 'change-trusted',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-10-23T11:00:00.000Z',
      trigger: {
        schemaVersion: 1,
        kind: 'untrusted-extension',
        identityDigest: `sha256:${'a'.repeat(64)}`,
        facts: {
          parentRunId: 'fabricated-parent',
          agentId: 'fabricated-agent',
          nextAction: 'fabricated-next-action',
        },
      },
    });
    const proposed: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 2,
      eventId: 'event-trusted-proposed',
      timestamp: '2026-10-23T11:00:01.000Z',
      type: 'action.proposed',
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: run.composition.compositionDigest,
      data: {
        action: {
          id: 'task-human-review',
          stepId: 'inspect',
          type: 'ask_user',
          ref: 'approve-plan',
        },
        executionSubject: 'fabricated-agent',
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [proposed],
      trajectory: [proposed],
    };

    const envelope = mapWorkflowObservationEnvelope(batch, proposed);
    expect(envelope.observedAt).toBe(proposed.timestamp);
    expect(envelope.attributes).toMatchObject({
      'repoctopus.workspace.id': 'workspace-trusted',
      'repoctopus.change.id': 'change-trusted',
      'repoctopus.run.id': 'run-trusted',
      'repoctopus.stage.name': 'inspect',
      'repoctopus.execution.id': 'task-human-review',
      'repoctopus.execution.parent.id': 'run-trusted',
      'repoctopus.execution.kind': 'workflow-action',
      'repoctopus.task.id': 'task-human-review',
      'repoctopus.task.status': 'pending',
      'repoctopus.next_action.id': 'task-human-review',
      'repoctopus.next_action.type': 'ask_user',
      'repoctopus.blocker.category': 'human-decision',
      'repoctopus.blocker.request.id': 'task-human-review',
    });
    expect(envelope.attributes).not.toHaveProperty('repoctopus.execution.subject.id');
    expect(JSON.stringify(envelope.attributes)).not.toMatch(
      /fabricated-parent|fabricated-agent|fabricated-next-action/u,
    );
  });

  it('keeps every workflow Metric free of entity identities', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-metric-cardinality',
      changeId: 'change-metric-cardinality',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-10-23T11:10:00.000Z',
    });
    const proposed: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'event-metric-proposed',
      timestamp: run.createdAt,
      type: 'action.proposed',
      runId: run.runId,
      stateVersion: 1,
      compositionDigest: run.composition.compositionDigest,
      data: {
        action: { id: 'task-metric', stepId: 'inspect', type: 'checkpoint', ref: 'done' },
      },
    };
    const completed: TrajectoryEvent = {
      ...proposed,
      sequence: 2,
      eventId: 'event-metric-completed',
      type: 'action.completed',
      timestamp: '2026-10-23T11:10:00.100Z',
      data: { actionId: 'task-metric', result: 'succeeded' },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [proposed, completed],
      trajectory: [proposed, completed],
    };
    const forbidden =
      /(?:^|\.)(?:workspace|change|run|execution|task|verification|blocker|next_action|evidence|envelope)(?:\.|$)/u;
    for (const event of batch.events) {
      const envelope = mapWorkflowObservationEnvelope(batch, event);
      for (const signal of envelope.signals) {
        if (signal.kind !== 'metric') continue;
        expect(Object.keys(signal.attributes ?? {})).not.toEqual(
          expect.arrayContaining([expect.stringMatching(forbidden)]),
        );
      }
    }
  });
});
