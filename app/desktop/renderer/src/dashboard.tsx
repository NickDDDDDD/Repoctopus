import type { ReactNode } from 'react';

import type { DashboardSummaryItem, DashboardViewModel, StatusTone } from './dashboard-model.js';

interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
}

function StatusIndicator({ label, tone }: StatusIndicatorProps) {
  return (
    <span className={`status-indicator status-indicator--${tone}`}>
      <span className="status-indicator__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

interface DashboardSectionProps {
  children: ReactNode;
  description?: string;
  id: string;
  title: string;
}

function DashboardSection({ children, description, id, title }: DashboardSectionProps) {
  return (
    <section className="dashboard-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="section-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SummaryGrid({ items }: { items: readonly DashboardSummaryItem[] }) {
  return (
    <dl className="summary-grid">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.numeric === true ? 'numeric-value' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyRegion({ children }: { children: ReactNode }) {
  return <p className="empty-region">{children}</p>;
}

export interface DashboardProps {
  model: DashboardViewModel;
  onRetry?: () => void;
  onSelectContext: (contextId: string) => void;
}

const navigationStatusLabel: Readonly<Record<string, string>> = {
  active: '进行中',
  completed: '已完成',
  failed: '失败',
  unknown: '未知',
};

export function Dashboard({ model, onRetry, onSelectContext }: DashboardProps) {
  const hasContext = model.context.changeId !== null;
  return (
    <div className="app-shell" data-dashboard-state={model.state}>
      <header className="window-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <div>
            <p className="brand-name">Repoctopus</p>
            <p className="product-name">Desktop</p>
          </div>
        </div>
        <StatusIndicator label={model.statusLabel} tone={model.tone} />
      </header>

      <div className="workspace-layout">
        <aside className="context-rail" aria-label="当前观测上下文">
          <div className="context-browser">
            <p className="rail-heading">Workspaces</p>
            {model.navigation.length === 0 ? (
              <p className="context-empty">尚无 Change</p>
            ) : (
              <div className="workspace-groups">
                {model.navigation.map((workspace) => (
                  <section className="workspace-group" key={workspace.workspaceId}>
                    <p className="workspace-name">{workspace.workspaceId}</p>
                    <ul role="list" className="change-list">
                      {workspace.changes.map((change) => {
                        const selected = change.id === model.selectedContextId;
                        return (
                          <li key={change.id}>
                            <button
                              className="change-selector"
                              type="button"
                              aria-current={selected ? 'page' : undefined}
                              onClick={() => onSelectContext(change.id)}
                            >
                              <span className="change-selector__name">{change.changeId}</span>
                              <span
                                className={`change-selector__status change-selector__status--${change.tone}`}
                              >
                                <span aria-hidden="true" />
                                {navigationStatusLabel[change.status] ?? '未知'}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
          <nav className="section-navigation" aria-label="Dashboard 区域">
            <a href="#overview">运行概览</a>
            <a href="#execution">阶段与任务</a>
            <a href="#assurance">验证与阻塞</a>
            <a href="#activity">最近事件</a>
          </nav>
          <div className="source-note">
            <p className="rail-label">数据来源</p>
            <p>仅使用 Repoctopus OTLP 上报，不扫描 Workspace 文件。</p>
          </div>
        </aside>

        <main className="dashboard-main">
          <section
            className={`state-banner state-banner--${model.tone}`}
            aria-live="polite"
            aria-busy={model.ariaBusy}
          >
            <div className="state-banner__copy">
              <p className="eyebrow">{model.eyebrow}</p>
              <h1>{model.title}</h1>
              <p className="description">{model.description}</p>
            </div>
            {model.canRetry ? (
              <button type="button" onClick={onRetry}>
                重试启动
              </button>
            ) : null}
          </section>

          <div className="content-stack">
            <DashboardSection
              id="overview"
              title="运行概览"
              description="Change、Run 与当前观测位置"
            >
              {hasContext ? (
                <SummaryGrid items={model.summary} />
              ) : (
                <EmptyRegion>收到首个 Change 事实后显示运行概览。</EmptyRegion>
              )}
            </DashboardSection>

            <div className="section-grid">
              <DashboardSection id="execution" title="阶段与任务">
                <EmptyRegion>
                  {hasContext ? '等待阶段、执行主体和任务事实。' : '当前没有可关联的运行。'}
                </EmptyRegion>
              </DashboardSection>
              <DashboardSection id="assurance" title="验证与阻塞">
                <EmptyRegion>
                  {hasContext ? '等待 Evidence、Gate 或 blocker 事实。' : '当前没有可关联的验证。'}
                </EmptyRegion>
              </DashboardSection>
            </div>

            <DashboardSection id="activity" title="最近事件">
              <EmptyRegion>
                {model.lastObservedAt === null
                  ? '尚未收到观测事件。'
                  : `最后观测：${model.lastObservedAt}`}
              </EmptyRegion>
            </DashboardSection>
          </div>
        </main>
      </div>

      <footer className="status-bar">
        <span>{model.statusDetail}</span>
        <span>{model.lastObservedAt === null ? '尚无观测时间' : model.lastObservedAt}</span>
      </footer>
    </div>
  );
}
