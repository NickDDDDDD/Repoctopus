import { useEffect, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';

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

  const activeChange =
    state.phase === 'ready' && state.projection.activeChange
      ? state.projection.changes.find(
          (change) =>
            change.workspaceId === state.projection.activeChange?.workspaceId &&
            change.changeId === state.projection.activeChange.changeId,
        )
      : undefined;
  const activeRun = activeChange?.runs.find((run) => run.runId === activeChange.currentRunId);
  const content =
    state.phase === 'starting'
      ? {
          eyebrow: '正在连接',
          title: '正在启动桌面观测',
          description: 'Repoctopus 正在启动隔离的 Desktop Host，并检查 Cordis 服务是否就绪。',
        }
      : state.phase === 'ready'
        ? activeChange && activeRun
          ? {
              eyebrow: '实时观测',
              title: activeChange.changeId,
              description: `当前阶段 ${activeRun.currentPhase ?? '尚未上报'} · Run ${activeRun.runId}`,
            }
          : {
              eyebrow: 'Host 已就绪',
              title: '等待首个 OTLP 上报',
              description:
                '桌面运行边界已建立。Receiver 接入后，当前 change 状态会在这里实时显示。',
            }
        : {
            eyebrow: '启动失败',
            title: 'Desktop Host 无法启动',
            description: state.message,
          };

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">Repoctopus</div>
        <div className="surface-label">Desktop observability</div>
      </header>
      <main className="startup-surface">
        <section className="status-group" aria-live="polite" aria-busy={state.phase === 'starting'}>
          <div className={`status-mark status-mark--${state.phase}`} aria-hidden="true" />
          <div className="status-copy">
            <p className="eyebrow">{content.eyebrow}</p>
            <h1>{content.title}</h1>
            <p className="description">{content.description}</p>
            {state.phase === 'ready' && activeRun ? (
              <ol className="phase-rail" aria-label="Change 阶段">
                {activeRun.phases.map((phase) => (
                  <li key={phase.phase} data-status={phase.status}>
                    <span>{phase.phase}</span>
                    <small>{phase.status}</small>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
          {state.phase === 'error' ? (
            <button type="button" onClick={() => window.repoctopusDesktop.retry()}>
              重试启动
            </button>
          ) : null}
        </section>
      </main>
      <footer>本地状态来自 Repoctopus OTLP 上报，不扫描 Workspace 文件。</footer>
    </div>
  );
}
