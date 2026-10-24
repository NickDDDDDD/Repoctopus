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
import { safeEventAttributes } from '../platform/telemetry/opentelemetry/mapping.js';
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
        generation: 1,
        runId: baseRun.runId,
      },
    });
    const run = { ...baseRun, status: 'waiting' as const, changeLifecycle: initial };
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 9,
      eventId: 'accepted-archive-wait',
      timestamp: '2026-01-01T00:09:00.000Z',
      type: 'change.lifecycle.transitioned',
      runId: run.runId,
      stateVersion: 9,
      compositionDigest: run.composition.compositionDigest,
      data: {
        changeLifecycleTransition: {
          schemaVersion: 1,
          transitionId: 'archive.await-merges',
          definition: initial.definition,
          revision: 9,
          from: { phase: 'archive', status: 'running' },
          to: { phase: 'archive', status: 'waiting' },
          workId: 'archive:await-merge:0123456789abcdef',
          waitId: 'wait:platform:0123456789abcdef',
          work: {
            workId: 'archive:await-merge:0123456789abcdef',
            kind: 'delivery.await-merge',
            validatorProfile: {
              id: 'archive.await-merge',
              version: '1.0.0',
              digest: `sha256:${'a'.repeat(64)}`,
            },
          },
          wait: { waitId: 'wait:platform:0123456789abcdef', kind: 'platform-event' },
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
      new Set(['accepted-archive-wait']),
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
    expect(JSON.stringify(records)).not.toMatch(
      /post_merge|ghp_|C:\/private|specification body|authorization|credential/u,
    );
  });
});
