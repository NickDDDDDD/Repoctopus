import { useEffect, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';
import {
  dashboardNavigationFromShell,
  reconcileDashboardSelection,
  type DashboardSelection,
} from './dashboard-navigation.js';
import { dashboardModelFromShell } from './dashboard-model.js';
import { DashboardSurface } from './dashboard-surface.js';
import { DesktopProjectionSession } from './projection-session.js';

const initialState: DesktopShellState = { phase: 'starting' };

export function App() {
  const [state, setState] = useState<DesktopShellState>(initialState);
  const [selection, setSelection] = useState<DashboardSelection | null>(null);

  useEffect(() => {
    const session = new DesktopProjectionSession(window.repoctopusDesktop, setState);
    void session.start();
    return () => {
      session.stop();
    };
  }, []);

  useEffect(() => {
    setSelection((current) => reconcileDashboardSelection(current, state));
  }, [state]);

  const effectiveSelection = reconcileDashboardSelection(selection, state);

  return (
    <DashboardSurface
      model={dashboardModelFromShell(state, effectiveSelection)}
      navigation={dashboardNavigationFromShell(state, effectiveSelection)}
      onSelect={setSelection}
      onRetry={() => window.repoctopusDesktop.retry()}
    />
  );
}
