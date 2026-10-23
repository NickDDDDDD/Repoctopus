import { useEffect, useRef, useState } from 'react';

import type { DesktopRunContext } from '../../shared/activation-protocol.js';
import type { DesktopShellState } from '../../shared/renderer-contract.js';
import { Dashboard } from './dashboard.js';
import { dashboardFixtureFromLocation } from './dashboard-fixtures.js';
import { dashboardModelFromShell } from './dashboard-model.js';
import { DesktopProjectionStream } from './projection-stream.js';

const initialState: DesktopShellState = { phase: 'starting' };
const SELECTION_STORAGE_KEY = 'repoctopus.desktop.selected-context';

function storedSelection(): string | null {
  try {
    return window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSelection(contextId: string): void {
  try {
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, contextId);
  } catch {
    // Selection still remains valid for the current Renderer lifetime.
  }
}

export function App() {
  const [state, setState] = useState<DesktopShellState>(initialState);
  const [activation, setActivation] = useState<DesktopRunContext | null>(null);
  const [selectedContextId, setSelectedContextId] = useState(storedSelection);
  const projectionStream = useRef<DesktopProjectionStream | null>(null);
  const fixtureSurface = ['http:', 'https:'].includes(window.location.protocol);
  const fixture = dashboardFixtureFromLocation(window.location, selectedContextId);

  useEffect(() => {
    if (fixtureSurface) return;
    let active = true;
    const stream = new DesktopProjectionStream({
      currentState: () => window.repoctopusDesktop.currentState(),
      publish: (next) => {
        if (active) setState(next);
      },
    });
    projectionStream.current = stream;
    stream.start();
    const unsubscribe = window.repoctopusDesktop.onState((next) => {
      stream.acceptState(next);
    });
    const unsubscribeProjection = window.repoctopusDesktop.onProjectionDelta((delta) => {
      stream.acceptDelta(delta);
    });
    const unsubscribeActivation = window.repoctopusDesktop.onActivation((context) => {
      if (active) setActivation(context);
    });
    return () => {
      active = false;
      stream.close();
      if (projectionStream.current === stream) projectionStream.current = null;
      unsubscribe();
      unsubscribeProjection();
      unsubscribeActivation();
    };
  }, [fixtureSurface]);

  const model = fixture ?? dashboardModelFromShell(state, selectedContextId, activation);
  const retry =
    fixture === null
      ? () => window.repoctopusDesktop.retry()
      : () => {
          window.location.search = '?fixture=starting';
        };
  const selectContext = (contextId: string) => {
    setSelectedContextId(contextId);
    storeSelection(contextId);
  };
  return <Dashboard model={model} onRetry={retry} onSelectContext={selectContext} />;
}
