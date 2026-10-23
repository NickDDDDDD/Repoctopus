import { useEffect, useRef, useState } from 'react';

import type { DesktopShellState } from '../../shared/renderer-contract.js';

const initialState: DesktopShellState = { phase: 'starting' };

export function App() {
  const [state, setState] = useState<DesktopShellState>(initialState);
  const projectionVersion = useRef(-1);

  useEffect(() => {
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
  }, []);

  const readyProjection = state.phase === 'ready' ? state.snapshot.projection : null;
  const readyChange = readyProjection?.change;
  if (readyProjection !== null && readyChange !== null && readyChange !== undefined) {
    const projection = readyProjection;
    const change = readyChange;
    const gapLabel = projection.gap.ranges
      .map((range) => (range.from === range.to ? String(range.from) : `${range.from}–${range.to}`))
      .join('、');
    return (
      <div className="app-shell">
        <header className="titlebar">
          <div className="brand">Repoctopus</div>
          <div className="surface-label">Desktop observability</div>
        </header>
        <main className="dashboard-surface">
          <section className="change-overview" aria-live="polite">
            <div className="change-heading">
              <div
                className={`status-mark status-mark--${projection.freshness === 'live' ? 'ready' : 'starting'}`}
                aria-hidden="true"
              />
              <div className="status-copy">
                <p className="eyebrow">
                  {projection.freshness === 'live' ? '实时接收' : '状态已过期'}
                </p>
                <h1>{change.id}</h1>
                <p className="description">
                  当前 Run 与阶段来自 Desktop Host 接收的 OTLP 上报，不读取本地项目文件。
                </p>
              </div>
            </div>
            <dl className="projection-details">
              <div>
                <dt>Change 状态</dt>
                <dd>{change.status}</dd>
              </div>
              <div>
                <dt>Run</dt>
                <dd>{projection.run?.id ?? '尚未上报'}</dd>
              </div>
              <div>
                <dt>阶段</dt>
                <dd>{projection.stage?.name ?? '尚未上报'}</dd>
              </div>
              <div>
                <dt>事件序列</dt>
                <dd className="numeric-value">{projection.latestSequence ?? '尚未上报'}</dd>
              </div>
            </dl>
            {projection.gap.detected ? (
              <p className="gap-notice" role="status">
                数据存在缺口：缺少事件序列 {gapLabel}。界面保留已确认事实，等待重放补齐。
              </p>
            ) : null}
          </section>
        </main>
        <footer>最后观测：{projection.lastObservedAt ?? '尚未上报'}</footer>
      </div>
    );
  }

  const content =
    state.phase === 'starting'
      ? {
          eyebrow: '正在连接',
          title: '正在启动桌面观测',
          description: 'Repoctopus 正在启动隔离的 Desktop Host，并检查 Cordis 服务是否就绪。',
        }
      : state.phase === 'ready'
        ? {
            eyebrow: 'Host 已就绪',
            title: '等待首个 OTLP 上报',
            description: '桌面运行边界与 Receiver 已就绪，当前 change 状态会在首次上报后实时显示。',
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
