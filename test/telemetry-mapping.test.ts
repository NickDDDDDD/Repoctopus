import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { startRun } from '../domains/engine/loop.js';
import type { TelemetryBatch } from '../domains/runtime/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import {
  acceptedChangeLifecycleTelemetry,
  projectChangeLifecycleTelemetry,
} from '../platform/telemetry/change-lifecycle-mapping.js';
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
        phase: 'custom-phase',
        workId: 'work-1',
        workKind: 'team.private-work',
        attempt: 1,
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
      'repoctopus.execution.workId': 'work-1',
      'repoctopus.execution.invocationId': 'invocation-1',
      'repoctopus.execution.packetDigest': `sha256:${'a'.repeat(64)}`,
    });
    expect(JSON.stringify(attributes)).not.toMatch(/private|ghp_|npm run|C:\//u);
    expect(executionMetricAttributes(event)).toEqual({
      'repoctopus.execution.event.type': 'work.host-completed',
      'repoctopus.execution.phase': 'unknown',
      'repoctopus.execution.work.kind': 'custom',
      'repoctopus.execution.result': 'succeeded',
      'repoctopus.execution.continuation': 'unknown',
      'repoctopus.execution.reason.code': 'none',
      'repoctopus.build.action': 'none',
      'repoctopus.build.execution.mode': 'none',
      'repoctopus.build.tdd.mode': 'none',
      'repoctopus.build.isolation': 'none',
    });
    const buildEvent: TrajectoryEvent = {
      ...event,
      eventId: 'build-work-event-1',
      data: {
        ...event.data,
        phase: 'build',
        workKind: 'build.execute',
        buildAction: 'execute',
        executionMode: 'subagent-driven-development',
        tddMode: 'tdd',
        isolation: 'worktree',
        packageId: 'work-package:high-cardinality-identity',
        repositoryId: 'private-repository-identity',
      },
    };
    const metric = executionMetricAttributes(buildEvent);
    expect(metric).toEqual({
      'repoctopus.execution.event.type': 'work.host-completed',
      'repoctopus.execution.phase': 'build',
      'repoctopus.execution.work.kind': 'build.execute',
      'repoctopus.execution.result': 'succeeded',
      'repoctopus.execution.continuation': 'unknown',
      'repoctopus.execution.reason.code': 'none',
      'repoctopus.build.action': 'execute',
      'repoctopus.build.execution.mode': 'subagent-driven-development',
      'repoctopus.build.tdd.mode': 'tdd',
      'repoctopus.build.isolation': 'worktree',
    });
    expect(JSON.stringify(metric)).not.toMatch(/work-package|repository/u);
  });

  it('exports correction facts while keeping identity and diagnostics out of Metric labels', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-correction-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '4'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 3,
      eventId: 'work-rejected-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      type: 'work.outcome-rejected',
      runId: run.runId,
      stateVersion: 3,
      compositionDigest: run.composition.compositionDigest,
      data: {
        phase: 'build',
        workId: 'build.plan:1',
        workKind: 'build.plan',
        attempt: 1,
        checkEpoch: 8,
        submissionId: 'submission-private-identity',
        submissionDigest: `sha256:${'b'.repeat(64)}`,
        reasonCode: 'outcome-rejected',
        diagnostic: 'Private Task title and source path C:/private/source.ts',
        continuation: 'awaiting-correction',
        rejectedSubmissionCount: 1,
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
      'repoctopus.execution.submissionId': 'submission-private-identity',
      'repoctopus.execution.reasonCode': 'outcome-rejected',
      'repoctopus.execution.continuation': 'awaiting-correction',
      'repoctopus.execution.rejectedSubmissionCount': 1,
    });
    expect(JSON.stringify(attributes)).not.toMatch(/Private Task|C:\/private/u);

    const metric = executionMetricAttributes(event);
    expect(metric).toMatchObject({
      'repoctopus.execution.event.type': 'work.outcome-rejected',
      'repoctopus.execution.continuation': 'awaiting-correction',
      'repoctopus.execution.reason.code': 'outcome-rejected',
    });
    expect(JSON.stringify(metric)).not.toMatch(/submission-private|sha256:|Private Task|C:\//u);
  });
});
