import { describe, expect, it } from 'vitest';

import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import {
  safeEventAttributes,
  workflowEventMetricAttributes,
  workflowStepMetricAttributes,
} from '../platform/telemetry/opentelemetry/mapping.js';
import { compositionFixture, projectFixture, workflowFixture } from './helpers/fixtures.js';

describe('telemetry mapping', () => {
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
    const attributes = safeEventAttributes(batch, event);
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
    expect(safeEventAttributes(batch, completed)).toMatchObject({
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
    const metrics = {
      ...workflowEventMetricAttributes(batch, completed),
      ...workflowStepMetricAttributes(batch, completed),
    };
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
    const attributes = safeEventAttributes(
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
});
