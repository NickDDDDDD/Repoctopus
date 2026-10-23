import { describe, expect, it } from 'vitest';

import {
  dashboardFixtureFromLocation,
  desktopDashboardFixtures,
} from '../app/desktop/renderer/src/dashboard-fixtures.js';
import {
  DASHBOARD_STATES,
  dashboardModelFromShell,
} from '../app/desktop/renderer/src/dashboard-model.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

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
          projection: {
            schemaVersion: 1,
            version: 1,
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
        { label: 'Change 状态', value: '尚未上报' },
        { label: 'Run', value: 'run-1' },
        { label: '阶段', value: '尚未上报' },
        { label: '事件序列', value: '1', numeric: true },
      ],
    });
  });
});
