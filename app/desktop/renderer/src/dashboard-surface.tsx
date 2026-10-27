import type { DashboardModel, DashboardPhaseStatus } from './dashboard-model.js';

export interface DashboardSurfaceProps {
  model: DashboardModel;
  onRetry: () => void;
}

const PHASE_STATUS_LABELS: Record<DashboardPhaseStatus, string> = {
  'not-started': '未开始',
  running: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  rework: '返工',
  failed: '失败',
};

function identity(value: string | null): string {
  return value ?? '尚未上报';
}

function formatObservedAt(value: string | null): string {
  if (value === null) return '尚无观测';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function DashboardSurface({ model, onRetry }: DashboardSurfaceProps) {
  const alert = model.state === 'error' || model.state === 'failed';
  return (
    <div className="app-shell" data-dashboard-state={model.state} data-tone={model.tone}>
      <header className="titlebar">
        <div className="product-lockup">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <div>
            <strong>Repoctopus Desktop</strong>
            <span>本地 workflow observability</span>
          </div>
        </div>
        <div className="freshness" aria-label={`遥测新鲜度：${model.freshnessLabel}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{model.freshnessLabel}</span>
          <time dateTime={model.lastObservedAt ?? undefined}>
            {formatObservedAt(model.lastObservedAt)}
          </time>
        </div>
      </header>

      <main className="dashboard-layout" aria-busy={model.busy}>
        <aside className="context-pane" data-region="current-context" aria-label="当前上下文">
          <p className="section-kicker">Current context</p>
          <dl className="identity-list">
            <div>
              <dt>Workspace</dt>
              <dd>{identity(model.workspaceId)}</dd>
            </div>
            <div>
              <dt>Change</dt>
              <dd>{identity(model.changeId)}</dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd>{identity(model.runId)}</dd>
            </div>
            <div>
              <dt>Workflow</dt>
              <dd>{identity(model.workflowName)}</dd>
            </div>
          </dl>

          <section className="work-panel" aria-labelledby="current-work-title">
            <div className="section-heading">
              <h2 id="current-work-title">Current work</h2>
              {model.currentWork ? <span>Attempt {model.currentWork.attempt}</span> : null}
            </div>
            {model.currentWork ? (
              <>
                <strong className="work-id">{model.currentWork.id}</strong>
                <span className="work-kind">
                  {model.currentWork.kind} · {model.currentWork.status}
                </span>
                <ul className="skill-list" aria-label="装填的 Skills">
                  {model.currentWork.skills.map((skill) => (
                    <li key={`${skill.role}:${skill.name}`}>
                      <span>{skill.name}</span>
                      <small>
                        {skill.role} · {skill.status}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="empty-copy">当前没有可展示的 work 或 skill。</p>
            )}
          </section>
        </aside>

        <section
          className="run-pane"
          data-region="run-status"
          aria-labelledby="run-status-title"
          role={alert ? 'alert' : undefined}
        >
          <div className="run-summary">
            <div>
              <span className="state-badge">{model.statusLabel}</span>
              <h1 id="run-status-title">{model.title}</h1>
              <p>{model.description}</p>
            </div>
            {model.recoverable ? (
              <button type="button" onClick={onRetry}>
                重试 Desktop Host
              </button>
            ) : null}
          </div>

          <ol className="phase-rail" aria-label="Change lifecycle">
            {model.phases.map((phase, index) => (
              <li
                key={phase.phase}
                data-phase-status={phase.status}
                aria-current={
                  phase.status === 'running' || phase.status === 'rework' ? 'step' : undefined
                }
              >
                <span className="phase-index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="phase-copy">
                  <strong>{phase.label}</strong>
                  <small>{PHASE_STATUS_LABELS[phase.status]}</small>
                </span>
              </li>
            ))}
          </ol>

          <div className="guidance">
            <span aria-hidden="true">i</span>
            <p>{model.guidance}</p>
          </div>
        </section>
      </main>

      <footer>
        <span>Source · Repoctopus OTLP Receiver</span>
        <span>Read-only · Runtime-authoritative</span>
      </footer>
    </div>
  );
}
