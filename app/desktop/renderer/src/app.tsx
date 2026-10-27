import { useEffect, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';
import { dashboardModelFromShell } from './dashboard-model.js';
import { DashboardSurface } from './dashboard-surface.js';

const initialState: DesktopShellState = { phase: 'starting' };

export function App() {
  const [state, setState] = useState<DesktopShellState>(initialState);

  useEffect(() => {
    let active = true;
    void window.repoctopusDesktop.currentState().then((next) => {
      if (active) setState(next);
    });
    const unsubscribe = window.repoctopusDesktop.onState((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <DashboardSurface
      model={dashboardModelFromShell(state)}
      onRetry={() => window.repoctopusDesktop.retry()}
    />
  );
}
