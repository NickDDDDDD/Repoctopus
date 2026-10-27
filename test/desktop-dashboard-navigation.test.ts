import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  dashboardNavigationFromShell,
  reconcileDashboardSelection,
} from '../app/desktop/renderer/src/dashboard-navigation.js';
import { dashboardModelFromShell } from '../app/desktop/renderer/src/dashboard-model.js';
import { DashboardSurface } from '../app/desktop/renderer/src/dashboard-surface.js';
import { desktopLaunchContextFromArguments } from '../app/desktop/main/launch-context.js';
import type { DesktopShellState } from '../app/desktop/shared/renderer-contract.js';
import {
  encodeDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../domains/desktop/launcher.js';
import {
  createEmptyChangeProjection,
  reduceChangeProjection,
  type ChangeProjectionObservation,
  type ChangeProjectionSnapshot,
} from '../domains/telemetry/change-projection.js';
import { DESKTOP_APPLICATION_CONTRACT } from '../services/desktop-application.js';

const observation = (
  sequence: number,
  workspaceId: string,
  changeId: string,
): ChangeProjectionObservation => ({
  schemaVersion: 1,
  sequence,
  eventId: `event-${sequence}`,
  eventName: 'change.phase.entered',
  observedAt: `2026-10-27T09:0${sequence}:00.000Z`,
  workspaceId,
  changeId,
  runId: `run-${changeId}`,
  workflowName: 'repoctopus-change',
  phase: 'open',
  work: null,
  skill: null,
  task: null,
  host: null,
  validator: null,
  continuation: null,
  recoverySourcePhase: null,
  previousPhase: null,
  lifecycleStatus: null,
  result: null,
});

function project(records: readonly ChangeProjectionObservation[]): ChangeProjectionSnapshot {
  return records.reduce(
    (snapshot, record) => reduceChangeProjection(snapshot, record).snapshot,
    createEmptyChangeProjection(),
  );
}

function ready(
  projection: ChangeProjectionSnapshot,
  launchContext: Omit<DesktopLaunchContext, 'schemaVersion'>,
): DesktopShellState {
  return {
    phase: 'ready',
    snapshot: { apiVersion: DESKTOP_APPLICATION_CONTRACT, phase: 'ready' },
    projection,
    delta: null,
    launchContext: { schemaVersion: 1, ...launchContext },
  };
}

describe('Desktop Dashboard navigation selection', () => {
  it('reads the bounded Runtime launch context at the initial Shell boundary', () => {
    const context: DesktopLaunchContext = {
      schemaVersion: 1,
      workspaceId: 'workspace-a',
      changeId: 'change-a',
      runId: 'run-change-a',
    };
    expect(
      desktopLaunchContextFromArguments([
        'electron.exe',
        'main.js',
        '--repoctopus-launch-context',
        encodeDesktopLaunchContext(context),
      ]),
    ).toEqual(context);
    expect(desktopLaunchContextFromArguments(['electron.exe', 'main.js'])).toBeNull();
  });

  it('focuses the launch source once and never lets newer observations steal the selection', () => {
    const launchSource = {
      workspaceId: 'workspace-a',
      changeId: 'change-a',
      runId: 'run-change-a',
    };
    const first = ready(
      project([
        observation(1, 'workspace-a', 'change-a'),
        observation(2, 'workspace-b', 'change-b'),
      ]),
      launchSource,
    );

    const initial = reconcileDashboardSelection(null, first);
    expect(initial).toEqual({ workspaceId: 'workspace-a', changeId: 'change-a' });

    const withNewerChange = ready(
      project([
        observation(1, 'workspace-a', 'change-a'),
        observation(2, 'workspace-b', 'change-b'),
        observation(3, 'workspace-c', 'change-c'),
      ]),
      launchSource,
    );
    expect(reconcileDashboardSelection(initial, withNewerChange)).toEqual(initial);

    const userSelected = { workspaceId: 'workspace-b', changeId: 'change-b' };
    expect(reconcileDashboardSelection(userSelected, withNewerChange)).toEqual(userSelected);
    expect(dashboardModelFromShell(withNewerChange, userSelected)).toMatchObject({
      workspaceId: 'workspace-b',
      changeId: 'change-b',
      runId: 'run-change-b',
    });
  });

  it('keeps an unseen launch source selected until its first OTLP observation arrives', () => {
    const shell = ready(project([observation(1, 'workspace-b', 'change-b')]), {
      workspaceId: 'workspace-a',
      changeId: 'change-a',
      runId: 'run-change-a',
    });
    const selection = reconcileDashboardSelection(null, shell);

    expect(selection).toEqual({ workspaceId: 'workspace-a', changeId: 'change-a' });
    expect(dashboardModelFromShell(shell, selection)).toMatchObject({
      state: 'sparse',
      workspaceId: 'workspace-a',
      changeId: 'change-a',
      runId: 'run-change-a',
    });
  });

  it('renders grouped Workspace and change choices with one current selection', () => {
    const shell = ready(
      project([
        observation(1, 'workspace-a', 'change-a'),
        observation(2, 'workspace-a', 'change-b'),
        observation(3, 'workspace-b', 'change-c'),
      ]),
      { workspaceId: 'workspace-a', changeId: 'change-a', runId: 'run-change-a' },
    );
    const selection = reconcileDashboardSelection(null, shell);
    const navigation = dashboardNavigationFromShell(shell, selection);
    const markup = renderToStaticMarkup(
      createElement(DashboardSurface, {
        model: dashboardModelFromShell(shell, selection),
        navigation,
        onSelect: () => undefined,
        onRetry: () => undefined,
      }),
    );

    expect(navigation.groups).toHaveLength(2);
    expect(navigation.groups.flatMap((group) => group.changes)).toHaveLength(3);
    expect(markup.match(/data-change-choice=/g)).toHaveLength(3);
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
