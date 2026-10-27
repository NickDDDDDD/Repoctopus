import type { DashboardModel, DashboardPhaseStatus } from './dashboard-model.js';
import type { DashboardNavigationModel, DashboardSelection } from './dashboard-navigation.js';

export interface DashboardSurfaceProps {
  model: DashboardModel;
  navigation?: DashboardNavigationModel;
  onSelect?: (selection: DashboardSelection) => void;
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

const SKILL_ROLE_LABELS = {
  action: 'Action',
  augmentation: 'Augmentation',
} as const;

const SKILL_STATUS_LABELS = {
  resolved: 'Resolved',
  delivered: 'Delivered',
  consumed: 'Consumed',
} as const;

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

export function DashboardSurface({
  model,
  navigation = { groups: [] },
  onSelect,
  onRetry,
}: DashboardSurfaceProps) {
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
          {navigation.groups.length > 0 ? (
            <nav className="change-explorer" aria-label="Workspace 和 Change">
              <p className="section-kicker">Change explorer</p>
              {navigation.groups.map((group) => (
                <section key={group.workspaceId} aria-labelledby={`workspace-${group.workspaceId}`}>
                  <h2 id={`workspace-${group.workspaceId}`}>{group.workspaceId}</h2>
                  <ul>
                    {group.changes.map((change) => (
                      <li key={change.changeId}>
                        <button
                          type="button"
                          data-change-choice={`${change.workspaceId}/${change.changeId}`}
                          aria-current={change.selected ? 'page' : undefined}
                          onClick={() =>
                            onSelect?.({
                              workspaceId: change.workspaceId,
                              changeId: change.changeId,
                            })
                          }
                        >
                          <span>{change.changeId}</span>
                          <small>{change.status}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          ) : null}
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
                <dl className="execution-facts">
                  <div>
                    <dt>Task</dt>
                    <dd>{model.currentWork.task ? `Task ${model.currentWork.task.id}` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Host</dt>
                    <dd>{model.currentWork.host?.id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Validator</dt>
                    <dd>{model.currentWork.validator?.id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Continuation</dt>
                    <dd>{model.currentWork.continuation ?? '—'}</dd>
                  </div>
                </dl>
                <ul className="skill-list" aria-label="装填的 Skills">
                  {model.currentWork.skills.map((skill) => (
                    <li key={`${skill.role}:${skill.name}`}>
                      <span>{skill.name}</span>
                      <small>
                        {SKILL_ROLE_LABELS[skill.role]} · {SKILL_STATUS_LABELS[skill.status]}
                      </small>
                    </li>
                  ))}
                </ul>
                {model.currentWork.skills.length > 0 ? (
                  <p className="skill-semantics">
                    Resolved 表示 Runtime 已选择；Delivered 表示内容已装入 Host packet；Consumed
                    表示 Host 声明并经 Runtime 验证。Dashboard 不观察 Agent 的内部思考。
                  </p>
                ) : null}
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
                  {phase.history.filter((entry) => entry.event === 'reopened').length > 0 ? (
                    <small>
                      返工 {phase.history.filter((entry) => entry.event === 'reopened').length} 次
                    </small>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          {model.executionHistory.length > 0 ? (
            <section className="execution-history" aria-labelledby="execution-history-title">
              <div className="section-heading">
                <h2 id="execution-history-title">Execution history</h2>
                <span>{model.executionHistory.length} attempts</span>
              </div>
              <ol>
                {model.executionHistory.map((work) => (
                  <li key={`${work.id}:${work.attempt}`} data-work-status={work.status}>
                    <span className="history-phase">{work.phase}</span>
                    <span>
                      <strong>{work.id}</strong>
                      <small>
                        Attempt {work.attempt} · {work.status}
                      </small>
                    </span>
                    <span className="history-runtime">
                      {work.host?.id ?? work.validator?.id ?? 'Runtime pending'}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {model.evidenceAttempts.length > 0 ||
          model.decisions.length > 0 ||
          model.blocker ||
          model.nextAction ? (
            <section className="observed-facts" aria-labelledby="observed-facts-title">
              <div className="section-heading">
                <h2 id="observed-facts-title">Evidence &amp; decisions</h2>
                <span>Allowlisted metadata only</span>
              </div>
              {model.blocker ? (
                <p className="blocker-line">
                  <strong>Blocker</strong> {model.blocker.kind} · {model.blocker.id}
                </p>
              ) : null}
              {model.nextAction ? (
                <p className="next-action-line">
                  <strong>Next action</strong> {model.nextAction}
                </p>
              ) : null}
              {model.decisions.length > 0 ? (
                <ul className="decision-list" aria-label="Human decisions">
                  {model.decisions.map((decision) => (
                    <li key={decision.id}>
                      <span>{decision.kind}</span>
                      <strong>{decision.status}</strong>
                      <small>{decision.id}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
              {model.evidenceAttempts.map((attempt) => (
                <article className="evidence-attempt" key={attempt.attemptId}>
                  <div>
                    <strong>{attempt.attemptId}</strong>
                    <span>{attempt.status ?? 'active'}</span>
                  </div>
                  {attempt.gate ? (
                    <p>
                      Gate {attempt.gate.status} · {attempt.gate.outcome}
                    </p>
                  ) : null}
                  <ul aria-label={`Artifacts for ${attempt.attemptId}`}>
                    {attempt.artifacts.map((artifact) => (
                      <li key={artifact.digest}>
                        <span>{artifact.type}</span>
                        <code>{artifact.digest}</code>
                        <small>
                          {artifact.mediaType} · {artifact.size} bytes ·
                          {artifact.redacted ? ' redacted' : ' metadata only'}
                        </small>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
          ) : null}

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
