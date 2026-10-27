import { useEffect, useRef, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';
import {
  dashboardLaunchSelection,
  dashboardNavigationFromShell,
  reconcileDashboardSelection,
  type DashboardSelection,
} from './dashboard-navigation.js';
import { DASHBOARD_STALE_AFTER_MS, dashboardModelFromShell } from './dashboard-model.js';
import { DashboardSurface } from './dashboard-surface.js';
import { DesktopProjectionSession } from './projection-session.js';

const initialState: DesktopShellState = { phase: 'starting' };

export function App() {
  const [state, setState] = useState<DesktopShellState>(initialState);
  const [selection, setSelection] = useState<DashboardSelection | null>(null);
  const appliedLaunchSequence = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const session = new DesktopProjectionSession(window.repoctopusDesktop, (nextState) => {
      setNowMs(Date.now());
      setState(nextState);
    });
    void session.start();
    return () => {
      session.stop();
    };
  }, []);

  useEffect(() => {
    const activation = dashboardLaunchSelection(state, appliedLaunchSequence.current);
    if (activation !== null) {
      appliedLaunchSequence.current = activation.sequence;
      setSelection(activation.selection);
      return;
    }
    setSelection((current) => reconcileDashboardSelection(current, state));
  }, [state]);

  const effectiveSelection = reconcileDashboardSelection(selection, state);

  useEffect(() => {
    if (state.phase !== 'ready') return;
    const activeIdentity = effectiveSelection ?? state.projection.activeChange;
    const change = activeIdentity
      ? state.projection.changes.find(
          (candidate) =>
            candidate.workspaceId === activeIdentity.workspaceId &&
            candidate.changeId === activeIdentity.changeId,
        )
      : undefined;
    const run = change?.runs.find((candidate) => candidate.runId === change.currentRunId);
    if (!run || run.status !== 'active') return;
    const observedAtMs = Date.parse(run.latestObservedAt);
    if (!Number.isFinite(observedAtMs)) return;
    const remainingMs = observedAtMs + DASHBOARD_STALE_AFTER_MS - Date.now();
    if (remainingMs <= 0) return;
    const timeout = window.setTimeout(() => setNowMs(Date.now()), remainingMs);
    return () => window.clearTimeout(timeout);
  }, [effectiveSelection?.changeId, effectiveSelection?.workspaceId, state]);

  return (
    <DashboardSurface
      model={dashboardModelFromShell(state, effectiveSelection, { nowMs })}
      navigation={dashboardNavigationFromShell(state, effectiveSelection)}
      onSelect={setSelection}
      onRetry={() => window.repoctopusDesktop.retry()}
    />
  );
}
