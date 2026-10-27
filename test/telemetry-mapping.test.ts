import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import { decodeOtlpJsonProjectionObservations } from '../app/desktop/host/otlp-json-projection.js';
import {
  acceptedChangeLifecycleTelemetry,
  projectChangeLifecycleTelemetry,
} from '../platform/telemetry/change-lifecycle-mapping.js';
import { encodeTelemetryBatchOtlpJsonRequests } from '../platform/telemetry/canonical-otlp-json-exporter.js';
import {
  executionMetricAttributes,
  safeEventAttributes,
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
    expect(JSON.stringify(attributes)).not.toMatch(
      /C:\/secret|source code|ghp_|session=secret|DATABASE_PASSWORD|data:image|private learning notes|\.repoctopus\/learning|matt-builtins/u,
    );
  });

  it('projects one accepted Change transition identically for Desktop and remote OTLP', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const baseRun = startRun({
      workflow,
      runId: 'run-change-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '2'.repeat(32),
    });
    const initial = createChangeLifecycleSnapshot({
      identity: {
        workspaceId: project.projectId,
        changeId: 'change-telemetry',
        runId: baseRun.runId,
      },
    });
    const run = { ...baseRun, status: 'completed' as const, changeLifecycle: initial };
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 9,
      eventId: 'accepted-publication-receipt',
      timestamp: '2026-01-01T00:09:00.000Z',
      type: 'change.lifecycle.transitioned',
      runId: run.runId,
      stateVersion: 9,
      compositionDigest: run.composition.compositionDigest,
      data: {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: 'archive.completed',
          definition: initial.definition,
          revision: 9,
          from: { phase: 'archive', status: 'running', checkEpoch: 8 },
          to: { phase: 'archive', status: 'completed', checkEpoch: 9 },
          workId: null,
          waitId: null,
          work: null,
          wait: null,
        },
        observation: {
          summary: 'private specification body',
          path: 'C:/private/repository',
          token: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
        },
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [event],
      trajectory: [event],
    };
    const records = acceptedChangeLifecycleTelemetry(batch, event);
    expect(records.map((record) => record.signal)).toEqual(['phase', 'status', 'work', 'wait']);
    expect(new Set(records.map((record) => record.eventId))).toEqual(
      new Set(['accepted-publication-receipt']),
    );
    const desktop = projectChangeLifecycleTelemetry(records);
    const remote = projectChangeLifecycleTelemetry(
      JSON.parse(JSON.stringify(records)) as typeof records,
    );
    const golden = JSON.parse(
      readFileSync(
        new URL('./fixtures/telemetry/change-lifecycle-projection.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    expect(desktop).toEqual(golden);
    expect(remote).toEqual(golden);
    const older = records.map((record) => ({
      ...record,
      eventId: 'older-transition',
      timestamp: '2026-01-01T00:08:00.000Z',
      attributes: {
        ...record.attributes,
        'repoctopus.event.id': 'older-transition',
        'repoctopus.change.transition.revision': 8,
        'repoctopus.change.check_epoch': 8,
      },
    }));
    expect(
      projectChangeLifecycleTelemetry([
        records[2]!,
        ...older.reverse(),
        records[0]!,
        records[3]!,
        records[1]!,
        records[2]!,
      ]),
    ).toEqual(golden);
    expect(JSON.stringify(records)).not.toMatch(
      /post_merge|ghp_|C:\/private|specification body|authorization|credential/u,
    );
    const requests = encodeTelemetryBatchOtlpJsonRequests(batch);
    expect(
      decodeOtlpJsonProjectionObservations(Buffer.from(JSON.stringify(requests.logs))),
    ).toContainEqual(
      expect.objectContaining({
        eventName: 'change.phase.completed',
        phase: 'archive',
        lifecycleStatus: 'completed',
      }),
    );
  });

  it('exports managed execution identities without content and bounds Metric labels', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const base = startRun({
      workflow,
      runId: 'run-execution-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '3'.repeat(32),
    });
    const run = {
      ...base,
      changeLifecycle: createChangeLifecycleSnapshot({
        identity: {
          workspaceId: project.projectId,
          changeId: 'execution-telemetry',
          runId: base.runId,
        },
      }),
    };
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 2,
      eventId: 'work-event-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'work.host-completed',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
      data: {
        executionContext: {
          schemaVersion: 1,
          phase: 'build',
          work: { id: 'work-1', kind: 'task.implement' },
          attempt: 1,
          checkEpoch: 7,
          task: { id: '2.2', revision: `sha256:${'b'.repeat(64)}` },
        },
        invocationId: 'invocation-1',
        hostId: 'host-1',
        packetDigest: `sha256:${'a'.repeat(64)}`,
        result: 'succeeded',
        prompt: 'private prompt',
        command: 'npm run secret',
        path: 'C:/private/source.ts',
        token: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
        operationId: 'C:/private/operation',
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
    expect(attributes).toMatchObject({
      'repoctopus.execution.context.schema_version': 1,
      'repoctopus.execution.phase': 'build',
      'repoctopus.execution.work.id': 'work-1',
      'repoctopus.execution.work.kind': 'task.implement',
      'repoctopus.execution.attempt': 1,
      'repoctopus.execution.check_epoch': 7,
      'repoctopus.execution.task.id': '2.2',
      'repoctopus.execution.task.revision': `sha256:${'b'.repeat(64)}`,
      'repoctopus.execution.invocationId': 'invocation-1',
      'repoctopus.execution.packetDigest': `sha256:${'a'.repeat(64)}`,
    });
    expect(JSON.stringify(attributes)).not.toMatch(/private|ghp_|npm run|C:\//u);
    expect(executionMetricAttributes(event)).toEqual({
      'repoctopus.execution.event.type': 'work.host-completed',
      'repoctopus.execution.phase': 'build',
      'repoctopus.execution.work.kind': 'task.implement',
      'repoctopus.execution.result': 'succeeded',
      'repoctopus.execution.continuation': 'unknown',
    });
  });

  it('maps shuffled execution events only from their own context and leaves legacy gaps unknown', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const base = startRun({
      workflow,
      runId: 'run-shuffled-context',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '4'.repeat(32),
    });
    const run = {
      ...base,
      changeLifecycle: {
        ...createChangeLifecycleSnapshot({
          identity: {
            workspaceId: project.projectId,
            changeId: 'shuffled-context',
            runId: base.runId,
          },
        }),
        phase: 'archive' as const,
        currentWork: null,
      },
    };
    const context = (id: string, taskId: string) => ({
      schemaVersion: 1,
      phase: 'build',
      work: { id, kind: 'task.implement' },
      attempt: 1,
      checkEpoch: taskId === '2.2' ? 16 : 17,
      task: {
        id: taskId,
        revision: `sha256:${taskId === '2.2' ? 'c' : 'd'}`.padEnd(71, taskId === '2.2' ? 'c' : 'd'),
      },
    });
    const events: TrajectoryEvent[] = [
      {
        schemaVersion: 1,
        sequence: 3,
        eventId: 'second-context',
        timestamp: '2026-01-01T00:00:03.000Z',
        type: 'validator.completed',
        runId: run.runId,
        stateVersion: 3,
        compositionDigest: run.composition.compositionDigest,
        data: { executionContext: context('work-2.3', '2.3'), result: 'accepted' },
      },
      {
        schemaVersion: 1,
        sequence: 1,
        eventId: 'first-context',
        timestamp: '2026-01-01T00:00:01.000Z',
        type: 'work.context-delivered',
        runId: run.runId,
        stateVersion: 1,
        compositionDigest: run.composition.compositionDigest,
        data: { executionContext: context('work-2.2', '2.2') },
      },
    ];
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events,
      trajectory: events,
    };

    expect(
      events.map((item) => {
        const attributes = safeEventAttributes(batch, item);
        return [
          attributes['repoctopus.execution.work.id'],
          attributes['repoctopus.execution.task.id'],
          attributes['repoctopus.execution.check_epoch'],
        ];
      }),
    ).toEqual([
      ['work-2.3', '2.3', 17],
      ['work-2.2', '2.2', 16],
    ]);

    const legacy = {
      ...events[1]!,
      eventId: 'legacy-missing-context',
      data: { phase: 'archive', workId: 'latest-work', workKind: 'specification.close' },
    };
    expect(safeEventAttributes({ ...batch, events: [legacy] }, legacy)).toMatchObject({
      'repoctopus.execution.context.status': 'missing',
    });
    expect(safeEventAttributes({ ...batch, events: [legacy] }, legacy)).not.toHaveProperty(
      'repoctopus.execution.work.id',
    );
  });

  it('exports bounded Task rework correlation without requiring a current execution context', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-task-reopened',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '5'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 1,
      eventId: 'task-reopened-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'task.reopened',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
      data: {
        schemaVersion: 1,
        task: { id: '2.3', revision: `sha256:${'2'.repeat(64)}` },
        result: 'reopened',
        recovery: {
          kind: 'fallback',
          sourcePhase: 'verify',
          evidence: { bundleId: 'bundle-1' },
          continuation: {
            work: { id: 'build:repair:2.3', kind: 'task.implement' },
            checkEpoch: 12,
          },
        },
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [event],
      trajectory: [event],
    };

    expect(safeEventAttributes(batch, event)).toMatchObject({
      'repoctopus.execution.context.status': 'missing',
      'repoctopus.task.id': '2.3',
      'repoctopus.task.revision': `sha256:${'2'.repeat(64)}`,
      'repoctopus.task.result': 'reopened',
      'repoctopus.recovery.kind': 'fallback',
      'repoctopus.recovery.source_phase': 'verify',
      'repoctopus.recovery.next_work.id': 'build:repair:2.3',
      'repoctopus.recovery.next_work.kind': 'task.implement',
      'repoctopus.recovery.next_check_epoch': 12,
    });
    expect(executionMetricAttributes(event)).toEqual({
      'repoctopus.execution.event.type': 'task.reopened',
      'repoctopus.execution.phase': 'verify',
      'repoctopus.execution.work.kind': 'custom',
      'repoctopus.execution.result': 'reopened',
      'repoctopus.execution.continuation': 'unknown',
    });
  });

  it('maps Human Decision and Wait boundaries with bounded kinds and no sensitive identity', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-human-decision',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '6'.repeat(32),
    });
    const decision: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 2,
      eventId: 'decision-resolved-1',
      timestamp: '2026-01-01T00:00:09.000Z',
      type: 'decision.resolved',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
      data: {
        schemaVersion: 1,
        phase: 'design',
        decisionId: 'design-request-1',
        decisionKind: 'design-approval',
        result: 'accepted',
        outcome: 'approve',
        actorId: 'alice@example.internal',
        reply: 'private approval body',
        reason: 'private planning context',
      },
    };
    const wait: TrajectoryEvent = {
      ...decision,
      sequence: 3,
      eventId: 'external-wait-1',
      type: 'wait.started',
      data: {
        schemaVersion: 1,
        phase: 'verify',
        waitId: 'external-1',
        waitKind: 'external-fact',
        reason: 'private provider response',
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [decision, wait],
      trajectory: [decision, wait],
    };

    expect(safeEventAttributes(batch, decision)).toMatchObject({
      'repoctopus.decision.id': 'design-request-1',
      'repoctopus.decision.kind': 'design-approval',
      'repoctopus.execution.phase': 'design',
      'repoctopus.execution.result': 'accepted',
    });
    expect(executionMetricAttributes(decision)).toMatchObject({
      'repoctopus.execution.event.type': 'decision.resolved',
      'repoctopus.execution.phase': 'design',
      'repoctopus.decision.kind': 'design-approval',
      'repoctopus.execution.result': 'accepted',
    });
    expect(executionMetricAttributes(wait)).toMatchObject({
      'repoctopus.execution.event.type': 'wait.started',
      'repoctopus.execution.phase': 'verify',
      'repoctopus.wait.kind': 'external-fact',
    });
    expect(JSON.stringify(safeEventAttributes(batch, decision))).not.toMatch(
      /alice|private|reply|reason/u,
    );
  });
});
