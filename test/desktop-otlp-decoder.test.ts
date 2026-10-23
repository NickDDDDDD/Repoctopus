import { describe, expect, it } from 'vitest';

import { dashboardModelFromShell } from '../app/desktop/renderer/src/dashboard-model.js';
import { ChangeProjectionReducer } from '../domains/telemetry/change-projection.js';
import { mapObservationEnvelope } from '../domains/telemetry/observation-envelope.js';
import { decodeDesktopOtlpBatch } from '../platform/telemetry/desktop-otlp-decoder.js';
import { encodeObservationOtlpJson } from '../platform/telemetry/observation-otlp-json.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

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
});
