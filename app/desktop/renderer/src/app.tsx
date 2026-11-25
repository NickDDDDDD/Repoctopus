import { useEffect, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';
import { Dashboard } from './dashboard.js';

const initialState: DesktopShellState = { protocolVersion: 1, phase: 'starting' };

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
    const unsubscribeProjection = window.repoctopusDesktop.onProjection((update) => {
      if (!active) return;
      setState((current) => {
        if (current.phase !== 'ready') return current;
        if (
          update.snapshot.version !== update.delta.version ||
          update.snapshot.version <= current.projection.version
        )
          return current;
        return { ...current, projection: update.snapshot };
      });
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeProjection();
    };
  }, []);

  const content =
    state.phase === 'starting'
      ? {
          eyebrow: '正在连接',
          title: '正在启动桌面观测',
          description: 'Repoctopus 正在启动隔离的 Desktop Host，并检查 Cordis 服务是否就绪。',
        }
      : state.phase === 'error'
        ? {
            eyebrow: '启动失败',
            title: 'Desktop Host 无法启动',
            description: state.message,
          }
        : null;

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand-group">
          <div className="brand">Repoctopus</div>
        </div>
        <div className="receiver-state" aria-live="polite">
          <span aria-hidden="true" />
          {state.phase === 'ready'
            ? '本地接收已连接'
            : state.phase === 'starting'
              ? '正在连接'
              : '连接失败'}
        </div>
      </header>
      {state.phase === 'ready' ? (
        <Dashboard projection={state.projection} application={state.snapshot} />
      ) : (
        <main className="startup-surface">
          <section
            className="status-group"
            aria-live="polite"
            aria-busy={state.phase === 'starting'}
          >
            <div className={`status-mark status-mark--${state.phase}`} aria-hidden="true" />
            <div className="status-copy">
              <p className="eyebrow">{content?.eyebrow}</p>
              <h1>{content?.title}</h1>
              <p className="description">{content?.description}</p>
            </div>
            {state.phase === 'error' ? (
              <button type="button" onClick={() => window.repoctopusDesktop.retry()}>
                重试启动
              </button>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
