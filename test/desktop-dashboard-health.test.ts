import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { decodeOtlpJsonProjectionObservations } from '../app/desktop/host/otlp-json-projection.js';
import { dashboardModelFromShell } from '../app/desktop/renderer/src/dashboard-model.js';
import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import type { DesktopShellState } from '../app/desktop/shared/renderer-contract.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionObservation,
} from '../domains/telemetry/change-projection.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

type HealthObservation = ChangeProjectionObservation & {
  telemetry?: {
    destinationId: string;
    destinationKind: 'remote' | 'desktop';
    result: 'accepted' | 'rejected' | 'delivered' | 'failed' | 'dropped' | null;
    cursorOffset: number;
    headOffset: number;
    cursorLag: number;
    backlogCount: number;
    backlogBytes: number;
    backlogOldestAgeMs: number;
    retryCount: number;
    gapCount: number;
    retentionDroppedCount: number;
    retentionDroppedBytes: number;
    completeHistory: boolean;
    deliveryLatencyMs: number | null;
    receiverLatencyMs: number | null;
  } | null;
};

function event(
  sequence: number,
  eventName: string,
  overrides: Partial<HealthObservation> = {},
): HealthObservation {
  return {
    schemaVersion: 1,
    sequence,
    eventId: `health-event-${sequence}`,
    eventName,
    observedAt: `2026-10-27T10:${String(sequence).padStart(2, '0')}:00.000Z`,
    workspaceId: 'workspace-health',
    changeId: 'change-health',
    runId: 'run-health',
    workflowName: 'repoctopus-change',
    phase: 'build',
    work: null,
    skill: null,
    task: null,
    host: null,
    validator: null,
    continuation: null,
    recoverySourcePhase: null,
    previousPhase: null,
    lifecycleStatus: null,
    evidence: null,
    decision: null,
    blocker: null,
    telemetry: null,
    result: null,
    ...overrides,
  };
}

function shell(
  records: readonly HealthObservation[],
): Extract<DesktopShellState, { phase: 'ready' }> {
  const projection = records.reduce(
    (snapshot, record) => reduceChangeProjection(snapshot, record).snapshot,
    createEmptyChangeProjection(),
  );
  return {
    phase: 'ready',
    snapshot: { apiVersion: DESKTOP_APPLICATION_CONTRACT, phase: 'ready' },
    projection,
    delta: null,
    launchContext: null,
  };
}

const telemetry = (
  destinationId: string,
  destinationKind: 'remote' | 'desktop',
  result: 'accepted' | 'rejected' | 'delivered' | 'failed' | 'dropped',
  backlogCount: number,
): NonNullable<HealthObservation['telemetry']> => ({
  destinationId,
  destinationKind,
  result,
  cursorOffset: backlogCount === 0 ? 12 : 4,
  headOffset: 12,
  cursorLag: backlogCount === 0 ? 0 : 8,
  backlogCount,
  backlogBytes: backlogCount * 700,
  backlogOldestAgeMs: backlogCount * 4_000,
  retryCount: result === 'failed' ? 2 : 0,
  gapCount: result === 'dropped' ? 1 : 0,
  retentionDroppedCount: result === 'dropped' ? 2 : 0,
  retentionDroppedBytes: result === 'dropped' ? 900 : 0,
  completeHistory: result !== 'dropped',
  deliveryLatencyMs: result === 'accepted' ? null : 120,
  receiverLatencyMs: result === 'accepted' || result === 'rejected' ? 8 : null,
});

describe('Desktop Dashboard explainable health', () => {
  it('keeps flow, execution, quality and telemetry diagnoses independent and traceable', () => {
    const failedWork = { id: 'build:5.6', kind: 'task.implement', attempt: 1 };
    const records = [
      event(1, 'change.phase.entered', { phase: 'build' }),
      event(2, 'work.created', { work: failedWork }),
      event(3, 'work.completed', {
        work: failedWork,
        host: { id: 'external:cli:codex-root', status: 'failed' },
        result: 'failed',
      }),
      event(4, 'change.phase.entered', { phase: 'verify', previousPhase: 'build' }),
      event(5, 'change.phase.reopened', {
        phase: 'build',
        previousPhase: 'verify',
        recoverySourcePhase: 'verify',
        result: 'reopened',
      }),
      event(1, 'evidence.gate.evaluated', {
        eventId: 'quality-gate-failed',
        sequenceScope: 'evidence:attempt-health',
        affectsFreshness: false,
        evidence: {
          attemptId: 'attempt-health',
          status: 'completed',
          gate: { bundleId: 'bundle-health', status: 'failed', outcome: 'failed' },
          artifact: null,
        },
      }),
      event(6, 'telemetry.delivery-completed', {
        telemetry: telemetry('team-signoz', 'remote', 'failed', 8),
        result: 'failed',
      }),
      event(7, 'telemetry.receiver-evaluated', {
        telemetry: telemetry('desktop-current-user', 'desktop', 'accepted', 0),
        result: 'accepted',
      }),
    ];
    const model = dashboardModelFromShell(shell(records));

    expect(model.health).toEqual([
      expect.objectContaining({ kind: 'flow', status: 'warning' }),
      expect.objectContaining({ kind: 'execution', status: 'critical' }),
      expect.objectContaining({ kind: 'quality', status: 'critical' }),
      expect.objectContaining({ kind: 'telemetry', status: 'warning' }),
    ]);
    expect(model.health.flatMap((signal) => signal.diagnostics)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: { type: 'phase', id: 'build' } }),
        expect.objectContaining({ target: { type: 'work', id: 'build:5.6' } }),
        expect.objectContaining({ target: { type: 'evidence', id: 'attempt-health' } }),
        expect.objectContaining({ target: { type: 'destination', id: 'team-signoz' } }),
      ]),
    );
    expect(model.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'team-signoz', backlogCount: 8, result: 'failed' }),
        expect.objectContaining({
          id: 'desktop-current-user',
          receiverResult: 'accepted',
        }),
      ]),
    );
    expect(model.recentEvents[0]).toMatchObject({ eventName: 'telemetry.receiver-evaluated' });

    const markup = renderToStaticMarkup(
      createElement(DashboardSurface, { model, onRetry: () => undefined }),
    );
    for (const text of [
      '流转健康',
      '执行健康',
      '质量健康',
      '遥测健康',
      'team-signoz',
      'Backlog 8',
      'Receiver accepted',
      'At-least-once replay',
    ]) {
      expect(markup).toContain(text);
    }
  });

  it('decodes canonical pipeline health attributes from OTLP logs', () => {
    const attribute = (key: string, value: string | number | boolean) => ({
      key,
      value:
        typeof value === 'number'
          ? { intValue: String(value) }
          : typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: value },
    });
    const observation = decodeOtlpJsonProjectionObservations(
      Buffer.from(
        JSON.stringify({
          resourceLogs: [
            {
              resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-health')] },
              scopeLogs: [
                {
                  logRecords: [
                    {
                      timeUnixNano: '1793080800000000000',
                      body: { stringValue: 'telemetry.delivery-completed' },
                      attributes: [
                        attribute('repoctopus.event.id', 'pipeline-event'),
                        attribute('repoctopus.event.sequence', 8),
                        attribute('repoctopus.change.id', 'change-health'),
                        attribute('repoctopus.run.id', 'run-health'),
                        attribute('repoctopus.telemetry.destination.id', 'team-signoz'),
                        attribute('repoctopus.telemetry.destination.kind', 'remote'),
                        attribute('repoctopus.telemetry.result', 'failed'),
                        attribute('repoctopus.telemetry.cursor.offset', 4),
                        attribute('repoctopus.telemetry.head.offset', 12),
                        attribute('repoctopus.telemetry.cursor.lag', 8),
                        attribute('repoctopus.telemetry.backlog.count', 8),
                        attribute('repoctopus.telemetry.backlog.bytes', 5_600),
                        attribute('repoctopus.telemetry.backlog.oldest_age_ms', 32_000),
                        attribute('repoctopus.telemetry.retry.count', 2),
                        attribute('repoctopus.telemetry.gap.count', 0),
                        attribute('repoctopus.telemetry.retention.dropped_count', 0),
                        attribute('repoctopus.telemetry.retention.dropped_bytes', 0),
                        attribute('repoctopus.telemetry.history.complete', true),
                        attribute('repoctopus.telemetry.delivery.latency_ms', 120),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    )[0];

    expect(observation).toMatchObject({
      eventName: 'telemetry.delivery-completed',
      result: 'failed',
      telemetry: {
        destinationId: 'team-signoz',
        destinationKind: 'remote',
        cursorLag: 8,
        backlogCount: 8,
        retryCount: 2,
        completeHistory: true,
      },
    });
  });
});
