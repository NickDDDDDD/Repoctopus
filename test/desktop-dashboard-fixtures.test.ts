import { describe, expect, it } from 'vitest';

import {
  dashboardFixtureFromLocation,
  desktopDashboardFixtures,
} from '../app/desktop/renderer/src/dashboard-fixtures.js';
import {
  DASHBOARD_STATES,
  dashboardContextId,
  dashboardModelFromShell,
  reconcileDashboardSelection,
} from '../app/desktop/renderer/src/dashboard-model.js';
import type { ChangeProjectionContext } from '../domains/telemetry/change-projection.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

const ingress = {
  receiver: {
    status: 'ready' as const,
    acceptedBatches: 1,
    acceptedRecords: 1,
    rejectedRequests: 0,
    lastReceivedAt: '2026-10-23T08:15:42.000Z',
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
    lastCompletedAt: '2026-10-23T08:15:42.000Z',
  },
};

describe('desktop dashboard state matrix', () => {
  it('provides an executable fixture for every designed state', () => {
    expect(Object.keys(desktopDashboardFixtures)).toEqual(DASHBOARD_STATES);
    for (const state of DASHBOARD_STATES) {
      const fixture = desktopDashboardFixtures[state];
      expect(fixture.state).toBe(state);
      expect(fixture.title.length).toBeGreaterThan(0);
      expect(fixture.statusLabel.length).toBeGreaterThan(0);
      expect(fixture.description.length).toBeGreaterThan(0);
    }
  });

  it('only enables URL fixtures on an HTTP development surface', () => {
    expect(
      dashboardFixtureFromLocation(new URL('http://127.0.0.1:5173/?fixture=catching-up')),
    ).toEqual(desktopDashboardFixtures['catching-up']);
    expect(
      dashboardFixtureFromLocation(new URL('file:///C:/repoctopus/index.html?fixture=failed')),
    ).toBeNull();
    expect(dashboardFixtureFromLocation(new URL('http://127.0.0.1:5173/?fixture=unknown'))).toEqual(
      desktopDashboardFixtures.live,
    );
  });

  it('runs the multi-workspace fixture with an independently selected change', () => {
    const selected = dashboardContextId('repoctopus', 'harden-evidence-retention');
    const fixture = dashboardFixtureFromLocation(
      new URL('http://127.0.0.1:5173/?fixture=multi-context'),
      selected,
    );
    expect(fixture).toMatchObject({
      state: 'failed',
      title: 'harden-evidence-retention',
      selectedContextId: selected,
      navigation: [{ workspaceId: 'platform-services' }, { workspaceId: 'repoctopus' }],
    });
  });

  it('preserves an explicit selection and only uses activation when none remains', () => {
    const context = (
      workspaceId: string,
      changeId: string,
      lastObservedAt: string,
    ): ChangeProjectionContext => ({
      workspaceId,
      change: { id: changeId, status: 'active' },
      run: { id: `run-${changeId}`, status: 'active' },
      workflow: { name: 'self-hosted-development', version: '1.0.0' },
      stage: { name: 'implementation', sequence: 1 },
      executionSubjects: [],
      tasks: null,
      assurance: null,
      recentEvents: [],
      latestSequence: 1,
      lastObservedAt,
      freshness: 'live',
      gap: { detected: false, ranges: [] },
    });
    const existing = context('workspace-one', 'existing-change', '2026-10-23T08:15:01.000Z');
    const incoming = context('workspace-two', 'incoming-change', '2026-10-23T08:15:02.000Z');
    const contexts = [incoming, existing];
    const existingId = dashboardContextId(existing.workspaceId, existing.change.id);
    const incomingActivation = {
      schemaVersion: 1 as const,
      workspaceId: incoming.workspaceId,
      changeId: incoming.change.id,
      runId: incoming.run.id,
    };

    expect(reconcileDashboardSelection(existingId, contexts, incomingActivation)).toBe(existingId);
    expect(reconcileDashboardSelection(null, contexts, incomingActivation)).toBe(
      dashboardContextId(incoming.workspaceId, incoming.change.id),
    );
  });

  it('maps shell lifecycle and projection facts without inferring missing values', () => {
    expect(dashboardModelFromShell({ phase: 'starting' }).state).toBe('starting');
    expect(dashboardModelFromShell({ phase: 'error', message: 'receiver failed' })).toMatchObject({
      state: 'error',
      description: 'receiver failed',
      canRetry: true,
    });
    expect(
      dashboardModelFromShell({
        phase: 'ready',
        snapshot: {
          apiVersion: DESKTOP_APPLICATION_CONTRACT,
          phase: 'ready',
          ingress,
          projection: {
            schemaVersion: 1,
            version: 1,
            contexts: [
              {
                workspaceId: 'repoctopus',
                change: { id: 'desktop-dashboard', status: 'unknown' },
                run: { id: 'run-1', status: 'unknown' },
                workflow: null,
                stage: null,
                executionSubjects: [],
                tasks: null,
                assurance: null,
                recentEvents: [
                  {
                    eventId: 'event-1',
                    eventType: 'run.progressed',
                    streamId: 'run-1',
                    sequence: 1,
                    observedAt: '2026-10-23T08:15:42.000Z',
                    stageName: null,
                    taskRef: null,
                    taskStatus: null,
                    verificationStatus: null,
                  },
                ],
                latestSequence: 1,
                lastObservedAt: '2026-10-23T08:15:42.000Z',
                freshness: 'live',
                gap: { detected: false, ranges: [] },
              },
            ],
            workspaceId: 'repoctopus',
            change: { id: 'desktop-dashboard', status: 'unknown' },
            activeChangeId: null,
            run: { id: 'run-1', status: 'unknown' },
            stage: null,
            latestSequence: 1,
            lastObservedAt: '2026-10-23T08:15:42.000Z',
            freshness: 'live',
            gap: { detected: false, ranges: [] },
          },
        },
      }),
    ).toMatchObject({
      state: 'sparse',
      summary: [
        { label: 'Run', value: 'run-1' },
        { label: 'Run 状态', value: '尚未上报' },
        { label: 'Workflow', value: '尚未上报' },
        { label: '事件序列', value: '1', numeric: true },
      ],
      execution: {
        stageName: null,
        subjects: [],
        taskProgress: null,
        activeTasks: [],
      },
      assurance: null,
      diagnostics: [
        { label: 'Receiver', value: '已就绪', tone: 'success' },
        { label: '本地目的地', value: '健康', tone: 'success' },
        { label: '新鲜度', value: '实时', tone: 'success' },
        { label: '重放', value: '空闲', tone: 'neutral' },
        { label: '序列', value: '完整', tone: 'success' },
      ],
      recentEvents: [
        {
          id: 'event-1',
          type: 'run.progressed',
          streamId: 'run-1',
          sequence: 1,
        },
      ],
    });
  });
});
