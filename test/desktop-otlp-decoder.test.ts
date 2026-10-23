import { describe, expect, it } from 'vitest';

import { dashboardModelFromShell } from '../app/desktop/renderer/src/dashboard-model.js';
import { ChangeProjectionReducer } from '../domains/telemetry/change-projection.js';
import type { EvidenceTelemetryBatch } from '../domains/evidence/telemetry.js';
import { mapObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import { decodeDesktopOtlpBatch } from '../platform/telemetry/desktop-otlp-decoder.js';
import { mapEvidenceObservationEnvelope } from '../platform/telemetry/observation-evidence-mapping.js';
import { encodeObservationOtlpJson } from '../platform/telemetry/observation-otlp-json.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

const ingress = {
  receiver: {
    status: 'ready' as const,
    acceptedBatches: 1,
    acceptedRecords: 1,
    rejectedRequests: 0,
    lastReceivedAt: '2026-10-23T09:30:10.000Z',
    lastDiagnosticCode: null,
    lastSignal: 'logs' as const,
  },
  destination: {
    id: 'desktop-local' as const,
    health: 'healthy' as const,
    deliveryGuarantee: 'at-least-once' as const,
  },
  replay: {
    status: 'idle' as const,
    receivedRecords: 1,
    totalRecords: 1,
    startedAt: null,
    lastCompletedAt: '2026-10-23T09:30:10.000Z',
  },
};

function dashboardEnvelope(
  sequence: number,
  attributes: Readonly<Record<string, string | number | boolean>>,
) {
  const merged = {
    'repoctopus.workspace.id': 'workspace-dashboard',
    'repoctopus.change.id': 'change-dashboard',
    'repoctopus.run.id': 'run-dashboard',
    ...attributes,
  };
  return mapObservationEnvelope(
    {
      source: {
        domain: 'workflow',
        eventId: `dashboard-event-${sequence}`,
        eventType: sequence === 1 ? 'run.started' : 'action.progressed',
        sequence,
      },
      observedAt: `2026-10-23T09:30:0${sequence}.000Z`,
      attributes: merged,
    },
    {
      allowedAttributes: Object.keys(merged),
      signals: [{ kind: 'log', name: 'repoctopus.workflow.event', severity: 'info' }],
    },
  );
}

function modelFromEnvelopes(envelopes: ReturnType<typeof dashboardEnvelope>[]) {
  const logs = encodeObservationOtlpJson(envelopes).find((request) => request.signal === 'logs');
  if (!logs) throw new Error('Log payload was not encoded');
  const reducer = new ChangeProjectionReducer();
  for (const record of decodeDesktopOtlpBatch({ signal: 'logs', payload: logs.payload })) {
    reducer.accept(record);
  }
  return dashboardModelFromShell({
    phase: 'ready',
    snapshot: {
      apiVersion: DESKTOP_APPLICATION_CONTRACT,
      phase: 'ready',
      ingress,
      projection: reducer.snapshot({
        now: '2026-10-23T09:30:10.000Z',
        staleAfterMs: 30_000,
      }),
    },
  });
}

describe('Desktop OTLP decoder routing', () => {
  it('ignores valid remote-only Workflow telemetry without a trusted Change binding', () => {
    const envelope = mapObservationEnvelope(
      {
        source: {
          domain: 'workflow',
          eventId: 'event-without-change',
          eventType: 'run.started',
          sequence: 1,
        },
        observedAt: '2026-10-23T09:20:00.000Z',
        attributes: {
          'repoctopus.workspace.id': 'workspace',
          'repoctopus.run.id': 'run-without-change',
        },
      },
      {
        allowedAttributes: ['repoctopus.workspace.id', 'repoctopus.run.id'],
        signals: [{ kind: 'log', name: 'repoctopus.run.started', severity: 'info' }],
      },
    );
    const logs = encodeObservationOtlpJson([envelope]).find((request) => request.signal === 'logs');
    if (!logs) throw new Error('Log payload was not encoded');

    expect(decodeDesktopOtlpBatch({ signal: 'logs', payload: logs.payload })).toEqual([]);
  });

  it('projects Run, stage, execution subject and task progress only from OTLP attributes', () => {
    const model = modelFromEnvelopes([
      dashboardEnvelope(1, {
        'repoctopus.change.status': 'active',
        'repoctopus.run.status': 'active',
        'repoctopus.workflow.name': 'self-hosted-development',
        'repoctopus.workflow.version': '1.0.0',
        'repoctopus.stage.name': 'implementation',
      }),
      dashboardEnvelope(2, {
        'repoctopus.stage.name': 'implementation',
        'repoctopus.execution.id': 'task-active',
        'repoctopus.execution.parent.id': 'run-dashboard',
        'repoctopus.execution.kind': 'workflow-action',
        'repoctopus.execution.subject.kind': 'agent',
        'repoctopus.execution.subject.id': 'codex-primary',
        'repoctopus.execution.subject.provider': 'openai',
        'repoctopus.task.id': 'task-active',
        'repoctopus.task.ref': 'desktop.render-run-view',
        'repoctopus.task.type': 'call_tool',
        'repoctopus.task.status': 'pending',
      }),
      dashboardEnvelope(3, {
        'repoctopus.stage.name': 'implementation',
        'repoctopus.task.id': 'task-completed',
        'repoctopus.task.ref': 'desktop.project-run-state',
        'repoctopus.task.type': 'checkpoint',
        'repoctopus.task.status': 'completed',
      }),
      dashboardEnvelope(4, {
        'repoctopus.stage.name': 'implementation',
        'repoctopus.task.id': 'task-without-status',
        'repoctopus.task.ref': 'desktop.review-copy',
      }),
    ]);

    expect(model).toMatchObject({
      state: 'live',
      summary: [
        { label: 'Run', value: 'run-dashboard' },
        { label: 'Run 状态', value: 'active' },
        { label: 'Workflow', value: 'self-hosted-development' },
        { label: '事件序列', value: '4', numeric: true },
      ],
      execution: {
        stageName: 'implementation',
        subjects: [{ kind: 'agent', id: 'codex-primary', provider: 'openai' }],
        taskProgress: { total: 3, completed: 1, failed: 0, unknown: 1, active: 1 },
        activeTasks: [
          {
            id: 'task-active',
            label: 'desktop.render-run-view',
            type: 'call_tool',
            status: 'pending',
            stageName: 'implementation',
            subject: { kind: 'agent', id: 'codex-primary', provider: 'openai' },
          },
        ],
      },
    });
  });

  it('routes change-bound Evidence telemetry through its independent stream', () => {
    const batch: EvidenceTelemetryBatch = {
      schemaVersion: 1,
      runId: 'run-dashboard',
      changeContext: {
        workspaceId: 'workspace-dashboard',
        changeId: 'change-dashboard',
      },
      attemptId: 'attempt-dashboard',
      profileId: 'verify',
      compositionDigest: `sha256:${'c'.repeat(64)}`,
      events: [
        {
          schemaVersion: 1,
          sequence: 1,
          eventId: 'evidence-artifact-dashboard',
          type: 'evidence.artifact.recorded',
          timestamp: '2026-10-23T09:30:02.000Z',
          runId: 'run-dashboard',
          attemptId: 'attempt-dashboard',
          data: {
            artifactDigest: `sha256:${'d'.repeat(64)}`,
            artifactType: 'command-stdout',
            artifactSize: 512,
            mediaType: 'text/plain; charset=utf-8',
            redacted: true,
          },
        },
        {
          schemaVersion: 1,
          sequence: 2,
          eventId: 'evidence-gate-dashboard',
          type: 'evidence.gate.evaluated',
          timestamp: '2026-10-23T09:30:03.000Z',
          runId: 'run-dashboard',
          attemptId: 'attempt-dashboard',
          data: {
            bundleId: 'bundle-dashboard',
            gateStatus: 'satisfied',
            outcome: 'passed',
          },
        },
      ],
    };
    const envelopes = batch.events.map((event) => mapEvidenceObservationEnvelope(batch, event));
    const model = modelFromEnvelopes(envelopes);

    expect(envelopes[0]?.attributes['repoctopus.stream.id']).toMatch(/^evidence:[a-f0-9]{32}$/u);
    expect(model.assurance).toMatchObject({
      verification: {
        id: 'attempt-dashboard',
        bundleId: 'bundle-dashboard',
        gateStatus: 'satisfied',
        outcome: 'passed',
      },
      artifacts: [{ type: 'command-stdout', size: 512, redacted: true }],
      blockers: [],
      nextActions: [],
    });
  });

  it('renders missing OTLP fields as unknown instead of inferring local state', () => {
    const model = modelFromEnvelopes([dashboardEnvelope(1, {})]);

    expect(model).toMatchObject({
      state: 'sparse',
      summary: [
        { label: 'Run', value: 'run-dashboard' },
        { label: 'Run 状态', value: '尚未上报' },
        { label: 'Workflow', value: '尚未上报' },
        { label: '事件序列', value: '1', numeric: true },
      ],
      execution: { stageName: null, subjects: [], taskProgress: null, activeTasks: [] },
    });
  });

  it('projects only safe assurance metadata when OTLP carries private bodies and attributes', () => {
    const envelopes = [
      dashboardEnvelope(1, {
        'repoctopus.change.status': 'active',
        'repoctopus.run.status': 'active',
        'repoctopus.stage.name': 'verification',
      }),
      dashboardEnvelope(2, {
        'repoctopus.verification.id': 'attempt-private-fixture',
        'repoctopus.verification.status': 'running',
        'repoctopus.evidence.attempt.id': 'attempt-private-fixture',
        'repoctopus.evidence.artifactDigest': `sha256:${'a'.repeat(64)}`,
        'repoctopus.evidence.artifactType': 'command-stdout',
        'repoctopus.evidence.mediaType': 'text/plain; charset=utf-8',
        'repoctopus.evidence.artifactSize': 4096,
        'repoctopus.evidence.redacted': true,
      }),
      dashboardEnvelope(3, {
        'repoctopus.verification.id': 'attempt-private-fixture',
        'repoctopus.verification.status': 'blocked',
        'repoctopus.verification.outcome': 'incomplete',
        'repoctopus.evidence.attempt.id': 'attempt-private-fixture',
        'repoctopus.evidence.bundle.id': 'bundle-private-fixture',
        'repoctopus.evidence.gate.status': 'blocked',
        'repoctopus.blocker.category': 'evidence-gate',
        'repoctopus.blocker.request.id': 'bundle-private-fixture',
      }),
      dashboardEnvelope(4, {
        'repoctopus.task.id': 'decision-private-fixture',
        'repoctopus.task.status': 'blocked',
        'repoctopus.blocker.category': 'human-decision',
        'repoctopus.blocker.request.id': 'decision-private-fixture',
        'repoctopus.next_action.id': 'decision-private-fixture',
        'repoctopus.next_action.type': 'ask_user',
        'repoctopus.next_action.ref': 'desktop.review-evidence',
        'repoctopus.next_action.stage': 'verification',
      }),
    ];
    const logs = encodeObservationOtlpJson(envelopes).find((request) => request.signal === 'logs');
    if (!logs) throw new Error('Log payload was not encoded');
    type MutableLogRecord = {
      body?: unknown;
      attributes: Array<{ key: string; value: { stringValue: string } }>;
    };
    const payload = structuredClone(logs.payload) as {
      resourceLogs: Array<{ scopeLogs: Array<{ logRecords: MutableLogRecord[] }> }>;
    };
    const privateRecord = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[1];
    if (!privateRecord) throw new Error('Private OTLP fixture record is missing');
    privateRecord.body = { stringValue: 'PRIVATE_BODY_NEVER_RENDER' };
    privateRecord.attributes.push(
      {
        key: 'repoctopus.prompt',
        value: { stringValue: 'PRIVATE_PROMPT_NEVER_RENDER' },
      },
      {
        key: 'repoctopus.reply',
        value: { stringValue: 'PRIVATE_REPLY_NEVER_RENDER' },
      },
      {
        key: 'repoctopus.command.output',
        value: { stringValue: 'PRIVATE_OUTPUT_NEVER_RENDER' },
      },
      {
        key: 'repoctopus.artifact.path',
        value: { stringValue: 'C:\\Users\\private\\evidence.log' },
      },
    );

    const reducer = new ChangeProjectionReducer();
    for (const record of decodeDesktopOtlpBatch({ signal: 'logs', payload })) {
      reducer.accept(record);
    }
    const model = dashboardModelFromShell({
      phase: 'ready',
      snapshot: {
        apiVersion: DESKTOP_APPLICATION_CONTRACT,
        phase: 'ready',
        ingress,
        projection: reducer.snapshot({
          now: '2026-10-23T09:30:10.000Z',
          staleAfterMs: 30_000,
        }),
      },
    });

    expect(model.assurance).toMatchObject({
      verification: {
        id: 'attempt-private-fixture',
        bundleId: 'bundle-private-fixture',
        gateStatus: 'blocked',
        outcome: 'incomplete',
      },
      artifacts: [
        {
          type: 'command-stdout',
          mediaType: 'text/plain; charset=utf-8',
          size: 4096,
          redacted: true,
        },
      ],
      blockers: [
        { category: 'human-decision', requestId: 'decision-private-fixture' },
        { category: 'evidence-gate', requestId: 'bundle-private-fixture' },
      ],
      nextActions: [
        {
          id: 'decision-private-fixture',
          type: 'ask_user',
          ref: 'desktop.review-evidence',
          stageName: 'verification',
        },
      ],
    });
    expect(JSON.stringify(model)).not.toMatch(
      /PRIVATE_BODY|PRIVATE_PROMPT|PRIVATE_REPLY|PRIVATE_OUTPUT|C:\\Users\\private/iu,
    );
  });
});
