import { useEffect, useRef, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';
import { Dashboard } from './dashboard.js';
import { dashboardFixtureFromLocation } from './dashboard-fixtures.js';
import { dashboardModelFromShell } from './dashboard-model.js';

const initialState: DesktopShellState = { phase: 'starting' };

export function App() {
  const [state, setState] = useState<DesktopShellState>(initialState);
  const projectionVersion = useRef(-1);
  const fixture = dashboardFixtureFromLocation(window.location);

  useEffect(() => {
    if (fixture !== null) return;
    let active = true;
    const applyState = (next: DesktopShellState) => {
      if (!active) return;
      projectionVersion.current = next.phase === 'ready' ? next.snapshot.projection.version : -1;
      setState(next);
    };
    void window.repoctopusDesktop.currentState().then((next) => {
      applyState(next);
    });
    const unsubscribe = window.repoctopusDesktop.onState((next) => {
      applyState(next);
    });
    const unsubscribeProjection = window.repoctopusDesktop.onProjectionDelta((delta) => {
      if (!active || delta.version <= projectionVersion.current) return;
      if (delta.baseVersion !== projectionVersion.current) {
        void window.repoctopusDesktop.currentState().then(applyState);
        return;
      }
      projectionVersion.current = delta.version;
      setState((current) =>
        current.phase === 'ready'
          ? {
              ...current,
              snapshot: { ...current.snapshot, projection: delta.projection },
            }
          : current,
      );
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeProjection();
    };
  }, [fixture]);

  const model = fixture ?? dashboardModelFromShell(state);
  const retry =
    fixture === null
      ? () => window.repoctopusDesktop.retry()
      : () => {
          window.location.search = '?fixture=starting';
        };
  return <Dashboard model={model} onRetry={retry} />;
}
