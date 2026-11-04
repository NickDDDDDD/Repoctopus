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
  workflowEventMetricAttributes,
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

  it('exports bounded Strategy and Binding lifecycle facts without raw digests or paths', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-binding-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-11-01T00:00:00.000Z',
      traceId: '8'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 2,
      eventId: 'binding-drifted',
      timestamp: run.createdAt,
      type: 'change.lifecycle.transitioned',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
      data: {
        observationKind: 'build-binding-revalidation-required',
        observation: {
          kind: 'build-binding-revalidation-required',
          reasonCode: 'path',
          reason: 'private C:/workspace/path',
          buildProtocol: {
            strategy: {
              strategyId: 'build-strategy:stable',
              revision: 1,
              executionMode: 'autonomous',
              tddMode: 'tdd',
              reviewMode: 'standard',
              isolationIntent: 'worktree',
              semanticDigest: `sha256:${'a'.repeat(64)}`,
            },
            binding: {
              bindingId: 'execution-binding:previous',
              revision: 4,
              stateDigest: `sha256:${'b'.repeat(64)}`,
              localOverlayRef: 'execution-workspace:private',
            },
          },
        },
      },
    };
    const attributes = safeEventAttributes(
      { run, workflow, projectSnapshot: project, events: [event], trajectory: [event] },
      event,
    );
    expect(attributes).toMatchObject({
      'repoctopus.build.event': 'build.binding.drifted',
      'repoctopus.build.reason.class': 'path',
      'repoctopus.build.strategy.id': 'build-strategy:stable',
      'repoctopus.build.strategy.revision': 1,
      'repoctopus.build.binding.id': 'execution-binding:previous',
      'repoctopus.build.binding.revision': 4,
      'repoctopus.build.executionMode': 'autonomous',
      'repoctopus.build.tddMode': 'tdd',
      'repoctopus.build.reviewMode': 'standard',
      'repoctopus.build.isolation': 'worktree',
    });
    expect(JSON.stringify(attributes)).not.toMatch(
      /C:\/workspace|semanticDigest|stateDigest|localOverlayRef|sha256:[ab]/u,
    );
  });

  it('projects authorized branch rebind telemetry without high-cardinality Metric labels', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-authorized-rebind',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-11-04T00:00:00.000Z',
      traceId: '7'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 3,
      eventId: 'authorized-rebind',
      timestamp: run.createdAt,
      type: 'change.lifecycle.transitioned',
      runId: run.runId,
      stateVersion: 3,
      compositionDigest: run.composition.compositionDigest,
      data: {
        authorizedBranchRebind: {
          schemaVersion: 1,
          entrypoint: 'resume',
          classification: 'authorized-protected-branch-rebind',
          result: 'dispatched',
          poisonRecovery: true,
          repositoryCount: 2,
          authorizationDigest: `sha256:${'c'.repeat(64)}`,
          projectReconciliationDigest: `sha256:${'d'.repeat(64)}`,
          branch: 'private/feature-name',
          repositoryId: 'private-repository-id',
          path: 'C:/private/checkout',
        },
      },
    };
    const batch = { run, workflow, projectSnapshot: project, events: [event], trajectory: [event] };
    const trace = safeEventAttributes(batch, event);
    expect(trace).toMatchObject({
      'repoctopus.build.rebind.entrypoint': 'resume',
      'repoctopus.build.rebind.classification': 'authorized-protected-branch-rebind',
      'repoctopus.build.rebind.result': 'dispatched',
      'repoctopus.build.rebind.poison_recovery': true,
      'repoctopus.build.rebind.repository_count': 2,
      'repoctopus.build.rebind.authorization_digest': `sha256:${'c'.repeat(64)}`,
    });
    const metric = workflowEventMetricAttributes(batch, event);
    expect(metric).toMatchObject({
      'repoctopus.build.rebind.entrypoint': 'resume',
      'repoctopus.build.rebind.result': 'dispatched',
      'repoctopus.build.rebind.poison_recovery': true,
    });
    expect(JSON.stringify(metric)).not.toMatch(
      /private|repository_count|authorization_digest|projectReconciliationDigest|sha256:/u,
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

  it('exports bounded Open repair facts without evidence or identity labels in Metrics', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const baseRun = startRun({
      workflow,
      runId: 'run-open-repair-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-11-01T00:00:00.000Z',
      traceId: '3'.repeat(32),
    });
    const initial = createChangeLifecycleSnapshot({
      identity: {
        workspaceId: project.projectId,
        changeId: 'open-repair-telemetry',
        runId: baseRun.runId,
      },
    });
    const run = { ...baseRun, changeLifecycle: initial };
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 3,
      eventId: 'open-repair-dispatched',
      timestamp: '2026-11-01T00:01:00.000Z',
      type: 'change.lifecycle.transitioned',
      runId: run.runId,
      stateVersion: 3,
      compositionDigest: run.composition.compositionDigest,
      data: {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: 'open.repair-required',
          definition: initial.definition,
          revision: 1,
          from: { phase: 'open', status: 'blocked', checkEpoch: 0 },
          to: { phase: 'open', status: 'running', checkEpoch: 1 },
          workId: 'private-work-id',
          waitId: null,
          work: null,
          wait: null,
          openRepair: {
            source: 'strict-validation',
            reasonCode: 'strict-validation-invalid',
            previousCheckEpoch: 0,
            nextCheckEpoch: 1,
            evidenceIds: ['private-evidence-digest'],
          },
        },
        observationKind: 'open-repair-required',
        executionRetirement: {
          reason: 'lifecycle-work-changed',
          retiredWorkId: 'private-old-work-id',
          retiredCheckEpoch: 0,
          nextWorkId: 'private-work-id',
          nextCheckEpoch: 1,
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
    expect(records[0]?.attributes).toMatchObject({
      'repoctopus.open.repair.source': 'strict-validation',
      'repoctopus.open.repair.reason_code': 'strict-validation-invalid',
      'repoctopus.open.repair.result': 'dispatched',
      'repoctopus.open.repair.execution_retired': true,
    });
    expect(JSON.stringify(records)).not.toContain('private-evidence-digest');
    expect(workflowEventMetricAttributes(batch, event)).toMatchObject({
      'repoctopus.open.repair.source': 'strict-validation',
      'repoctopus.open.repair.reason_code': 'strict-validation-invalid',
      'repoctopus.open.repair.result': 'dispatched',
      'repoctopus.open.repair.execution_retired': true,
    });
    expect(JSON.stringify(workflowEventMetricAttributes(batch, event))).not.toMatch(
      /run-open-repair-telemetry|open-repair-telemetry|private-work|private-evidence/u,
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

  it('maps unavailable Open continuation as reobservation without Host replay', () => {
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 3,
      eventId: 'open-provider-unavailable',
      timestamp: '2026-01-01T00:00:02.000Z',
      type: 'continuation.selected',
      runId: 'run-open-provider-unavailable',
      stateVersion: 3,
      compositionDigest: `sha256:${'a'.repeat(64)}`,
      data: {
        continuation: 'reobserve',
        reason: 'open-observation-unavailable',
        result: 'unavailable',
        reasonCode: 'open-observation-unavailable',
        hostReplayed: false,
        observationStage: 'planning-gate',
      },
    };

    expect(executionMetricAttributes(event)).toMatchObject({
      'repoctopus.execution.result': 'unavailable',
      'repoctopus.execution.continuation': 'reobserve',
      'repoctopus.execution.reason.code': 'open-observation-unavailable',
      'repoctopus.execution.host.replayed': false,
      'repoctopus.open.observation.stage': 'planning-gate',
    });
  });

  it('maps bounded project reconciliation classes without repository details', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-project-content-resumed',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '9'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 4,
      eventId: 'project-content-resumed',
      timestamp: '2026-01-01T00:00:03.000Z',
      type: 'run.resumed',
      runId: run.runId,
      stateVersion: 4,
      compositionDigest: run.composition.compositionDigest,
      data: {
        reconciliation: {
          changeClass: 'content',
          requiresReconciliation: false,
          changedRepositories: [{ repositoryName: 'private-name' }],
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

    expect(workflowEventMetricAttributes(batch, event)).toMatchObject({
      'repoctopus.project.reconciliation.class': 'content',
      'repoctopus.project.reconciliation.required': false,
    });
    expect(safeEventAttributes(batch, event)).toMatchObject({
      'repoctopus.project.reconciliation.class': 'content',
      'repoctopus.project.reconciliation.required': false,
    });
    expect(JSON.stringify(safeEventAttributes(batch, event))).not.toContain('private-name');
  });

  it('exports only bounded packet and Specification reliability dimensions', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-reliability-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '8'.repeat(32),
    });
    const base: Omit<TrajectoryEvent, 'type' | 'data' | 'eventId'> = {
      schemaVersion: 1,
      sequence: 2,
      timestamp: '2026-01-01T00:00:01.000Z',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
    };
    const packet: TrajectoryEvent = {
      ...base,
      eventId: 'packet-recovered',
      type: 'work.packet-recovered',
      data: {
        result: 'corrupt',
        packetDigest: `sha256:${'a'.repeat(64)}`,
        error: 'private C:/packet/path',
      },
    };
    const specification: TrajectoryEvent = {
      ...base,
      eventId: 'specification-observed',
      type: 'specification.validation-observed',
      data: {
        valid: false,
        highestSeverity: 'error',
        infoCount: 1,
        warningCount: 2,
        errorCount: 3,
        contractConflict: true,
        diagnostic: 'private provider message',
      },
    };
    const batch: TelemetryBatch = {
      run,
      workflow,
      projectSnapshot: project,
      events: [packet, specification],
      trajectory: [packet, specification],
    };
    expect(workflowEventMetricAttributes(batch, packet)).toMatchObject({
      'repoctopus.packet.result': 'corrupt',
    });
    expect(workflowEventMetricAttributes(batch, specification)).toMatchObject({
      'repoctopus.specification.validation.valid': false,
      'repoctopus.specification.validation.highest_severity': 'error',
      'repoctopus.specification.validation.contract_conflict': true,
    });
    expect(safeEventAttributes(batch, specification)).toMatchObject({
      'repoctopus.execution.highestSeverity': 'error',
      'repoctopus.execution.errorCount': 3,
    });
    expect(
      JSON.stringify([
        workflowEventMetricAttributes(batch, packet),
        workflowEventMetricAttributes(batch, specification),
        safeEventAttributes(batch, packet),
        safeEventAttributes(batch, specification),
      ]),
    ).not.toMatch(/private|C:\//u);
  });

  it('keeps team Skill correlation in Trace attributes and out of Metric labels', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-team-skill-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '9'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 2,
      eventId: 'team-skill-delivered',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'skill.delivered',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
      data: {
        phase: 'design',
        workId: 'specification.plan:1',
        workKind: 'specification.plan',
        skillName: 'company-private-method',
        skillRole: 'team-guidance',
        bindingId: 'team-design-guidance',
        slotId: 'design-method',
        skillOrder: 2,
        replacedSkillName: 'codebase-design',
        skillCompositionDigest: `sha256:${'d'.repeat(64)}`,
        result: 'delivered',
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
      'repoctopus.execution.skillName': 'custom',
      'repoctopus.execution.skillRole': 'team-guidance',
      'repoctopus.execution.bindingId': 'team-design-guidance',
      'repoctopus.execution.slotId': 'design-method',
      'repoctopus.execution.skillOrder': 2,
      'repoctopus.execution.replacedSkillName': 'codebase-design',
      'repoctopus.execution.skillCompositionDigest': `sha256:${'d'.repeat(64)}`,
    });
    expect(JSON.stringify(executionMetricAttributes(event))).not.toMatch(
      /company-private|team-design-guidance|design-method|sha256:/u,
    );
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

  it('distinguishes a capability claim rejection without capability or Host identity labels', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const run = startRun({
      workflow,
      runId: 'run-capability-rejection',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '6'.repeat(32),
    });
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 2,
      eventId: 'claim-rejected-1',
      timestamp: '2026-01-01T00:00:01.000Z',
      type: 'work.claim-rejected',
      runId: run.runId,
      stateVersion: 2,
      compositionDigest: run.composition.compositionDigest,
      data: {
        phase: 'build',
        buildAction: 'execute',
        workId: 'build.execute:private-work-id',
        workKind: 'build.execute',
        attempt: 1,
        result: 'blocked',
        reasonCode: 'capability-required',
        missingCapabilityCount: 2,
        hostId: 'private-host-identity',
        missingCapabilities: ['repository.write', 'process.execute'],
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
      'repoctopus.execution.result': 'blocked',
      'repoctopus.execution.reasonCode': 'capability-required',
      'repoctopus.execution.missingCapabilityCount': 2,
    });
    const metric = executionMetricAttributes(event);
    expect(metric).toMatchObject({
      'repoctopus.execution.event.type': 'work.claim-rejected',
      'repoctopus.execution.result': 'blocked',
      'repoctopus.execution.reason.code': 'capability-required',
    });
    expect(JSON.stringify(metric)).not.toMatch(
      /private-host|private-work-id|repository\.write|process\.execute/u,
    );
  });

  it('exports bounded workspace intent recovery facts without high-cardinality Metric labels', () => {
    const workflow = workflowFixture();
    const project = projectFixture();
    const base = startRun({
      workflow,
      runId: 'run-workspace-intent-telemetry',
      projectSnapshotDigest: project.digest,
      composition: compositionFixture(),
      timestamp: '2026-01-01T00:00:00.000Z',
      traceId: '5'.repeat(32),
    });
    const initial = createChangeLifecycleSnapshot({
      identity: {
        workspaceId: project.projectId,
        changeId: 'change-workspace-intent-telemetry',
        runId: base.runId,
      },
    });
    const run = { ...base, changeLifecycle: initial };
    const event: TrajectoryEvent = {
      schemaVersion: 1,
      sequence: 12,
      eventId: 'workspace-intent-revision-required',
      timestamp: '2026-01-01T00:12:00.000Z',
      type: 'change.lifecycle.transitioned',
      runId: run.runId,
      stateVersion: 12,
      compositionDigest: run.composition.compositionDigest,
      data: {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: 'build.workspace-intent-revision-required',
          definition: initial.definition,
          revision: 12,
          from: { phase: 'build', status: 'running', checkEpoch: 11 },
          to: { phase: 'open', status: 'waiting', checkEpoch: 12 },
          workId: null,
          waitId: 'workspace-intent:request-1',
          work: null,
          wait: { waitId: 'workspace-intent:request-1', kind: 'human-decision' },
          workspaceIntentRevision: {
            errorCode: 'current-linked-worktree',
            previousIsolation: 'current',
          },
        },
        observationKind: 'workspace-intent-revision-required',
        observation: {
          kind: 'workspace-intent-revision-required',
          errorCode: 'current-linked-worktree',
          previousIsolation: 'current',
          reason: 'Private failure at C:/private/repository on branch secret-feature',
          proposalDigest: `sha256:${'c'.repeat(64)}`,
        },
        executionRetirement: {
          reason: 'workspace-intent-revision',
          retiredWorkId: 'build.configure:private-work-identity',
          retiredCheckEpoch: 11,
          nextWorkId: null,
          nextCheckEpoch: 12,
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
    expect(records).toHaveLength(4);
    expect(records[0]?.attributes).toMatchObject({
      'repoctopus.change.phase.before': 'build',
      'repoctopus.change.phase': 'open',
      'repoctopus.workspace.binding.error.code': 'current-linked-worktree',
      'repoctopus.workspace.binding.recovery': 'intent-revision',
      'repoctopus.workspace.isolation.previous': 'current',
      'repoctopus.execution.retired': true,
      'repoctopus.execution.retirement.reason': 'workspace-intent-revision',
      'repoctopus.execution.retirement.work.id': 'build.configure:private-work-identity',
      'repoctopus.execution.retirement.check_epoch': 11,
      'repoctopus.execution.next.check_epoch': 12,
    });
    expect(JSON.stringify(records)).not.toMatch(
      /C:\/private|secret-feature|Private failure|sha256:c/u,
    );

    const metric = workflowEventMetricAttributes(batch, event);
    expect(metric).toEqual({
      'repoctopus.event.type': 'change.lifecycle.transitioned',
      'repoctopus.workflow.name': batch.run.workflowName,
      'repoctopus.change.phase.before': 'build',
      'repoctopus.change.phase': 'open',
      'repoctopus.workspace.binding.error.code': 'current-linked-worktree',
      'repoctopus.workspace.binding.recovery': 'intent-revision',
      'repoctopus.workspace.isolation.previous': 'current',
      'repoctopus.workspace.isolation.current': 'none',
      'repoctopus.execution.retired': true,
      'repoctopus.execution.retirement.reason': 'workspace-intent-revision',
    });
    expect(JSON.stringify(metric)).not.toMatch(
      /run-workspace|change-workspace|private-work|sha256:|C:\/private|secret-feature|Private failure/u,
    );

    const resumed: TrajectoryEvent = {
      ...event,
      sequence: 13,
      eventId: 'workspace-intent-revised',
      stateVersion: 13,
      data: {
        changeLifecycleTransition: {
          schemaVersion: 2,
          transitionId: 'open.workspace-intent-revised',
          definition: initial.definition,
          revision: 13,
          from: { phase: 'open', status: 'waiting', checkEpoch: 12 },
          to: { phase: 'design', status: 'running', checkEpoch: 13 },
          workId: 'specification.plan:next-private-work-identity',
          waitId: null,
          work: null,
          wait: null,
          workspaceIntentRevision: {
            errorCode: 'current-linked-worktree',
            previousIsolation: 'current',
            nextIsolation: 'worktree',
          },
        },
        observationKind: 'workspace-intent-revised',
        observation: {
          kind: 'workspace-intent-revised',
          actorId: 'private-person-identity',
          intent: {
            isolation: 'worktree',
            targetBranch: 'secret-feature',
            semanticDigest: `sha256:${'d'.repeat(64)}`,
          },
        },
        executionRetirement: {
          reason: 'workspace-intent-revision',
          retiredWorkId: 'build.configure:private-work-identity',
          retiredCheckEpoch: 11,
          nextWorkId: 'specification.plan:next-private-work-identity',
          nextCheckEpoch: 13,
        },
      },
    };
    const resumedBatch = { ...batch, events: [resumed], trajectory: [event, resumed] };
    expect(acceptedChangeLifecycleTelemetry(resumedBatch, resumed)[0]?.attributes).toMatchObject({
      'repoctopus.change.phase.before': 'open',
      'repoctopus.change.phase': 'design',
      'repoctopus.workspace.isolation.previous': 'current',
      'repoctopus.workspace.isolation.current': 'worktree',
      'repoctopus.execution.next.work.id': 'specification.plan:next-private-work-identity',
    });
    const resumedMetric = workflowEventMetricAttributes(resumedBatch, resumed);
    expect(resumedMetric['repoctopus.workspace.isolation.current']).toBe('worktree');
    expect(JSON.stringify(resumedMetric)).not.toMatch(
      /private-person|next-private-work|secret-feature|sha256:/u,
    );

    const planningInvalidation: TrajectoryEvent = {
      ...event,
      eventId: 'planning-authority-invalidated',
      data: {
        ...event.data,
        observationKind: 'planning-authority-invalidated',
        changeLifecycleTransition: {
          ...event.data.changeLifecycleTransition!,
          invalidation: {
            kind: 'planning-authority-invalidated',
            invalidationKind: 'approval-authority',
            classification: 'approval-authority',
            disposition: 'invalidate',
            scope: 'exact',
            continuation: 'design',
            retainedCount: 8,
            invalidatedCount: 1,
            protocolDisposition: 'suspended',
            completionBeforeCount: 2,
            supersededPlanningDigest: `sha256:${'a'.repeat(64)}`,
            observedPlanningDigest: `sha256:${'b'.repeat(64)}`,
            supersededWorkId: 'build.plan:private-work',
            supersededTaskRevisions: [`sha256:${'c'.repeat(64)}`],
            evidenceIds: [`sha256:${'d'.repeat(64)}`],
          },
        },
        observation: {
          kind: 'planning-authority-invalidated',
          invalidationKind: 'approval-authority',
          reason: 'private approval reason',
          inputDigest: `sha256:${'f'.repeat(64)}`,
        },
      },
    };
    const planningMetric = workflowEventMetricAttributes(
      { ...batch, events: [planningInvalidation], trajectory: [planningInvalidation] },
      planningInvalidation,
    );
    expect(planningMetric['repoctopus.planning.invalidation.kind']).toBe('approval-authority');
    expect(planningMetric).toMatchObject({
      'repoctopus.runtime.invalidation.classification': 'approval-authority',
      'repoctopus.runtime.invalidation.disposition': 'invalidate',
      'repoctopus.runtime.invalidation.scope': 'exact',
      'repoctopus.runtime.invalidation.continuation': 'design',
    });
    expect(planningMetric).not.toHaveProperty('repoctopus.runtime.invalidation.retained_count');
    expect(planningMetric).not.toHaveProperty('repoctopus.runtime.invalidation.invalidated_count');
    expect(JSON.stringify(planningMetric)).not.toMatch(/private approval|sha256:f/u);
  });
});
