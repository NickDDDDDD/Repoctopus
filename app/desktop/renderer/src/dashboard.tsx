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

const taskStatusLabel = {
  pending: '进行中',
  blocked: '已阻塞',
} as const;

const verificationStatusLabel: Readonly<Record<string, string>> = {
  running: '验证中',
  completed: '已完成',
  superseded: '已取代',
  satisfied: '已满足',
  blocked: '已阻塞',
};

const verificationOutcomeLabel: Readonly<Record<string, string>> = {
  passed: '通过',
  failed: '失败',
  incomplete: '不完整',
  passed_with_warnings: '通过，有警告',
};

const gateStatusLabel = {
  satisfied: '已满足',
  blocked: '已阻塞',
} as const;

const blockerLabel: Readonly<Record<string, string>> = {
  'human-decision': '等待人工决定',
  'evidence-gate': 'Evidence Gate 未满足',
};

function formatBytes(value: number | null): string {
  if (value === null) return '尚未上报';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDigest(value: string): string {
  if (value.length <= 32) return value;
  return `${value.slice(0, 19)}…${value.slice(-10)}`;
}

function ExecutionOverview({ model }: { model: DashboardViewModel }) {
  const progress = model.execution.taskProgress;
  const progressKnown = progress !== null && progress.unknown === 0;
  return (
    <div className="execution-stack">
      <div className="execution-overview">
        <div className="execution-detail">
          <p className="detail-label">当前阶段</p>
          <p className="detail-value">{model.execution.stageName ?? '尚未上报'}</p>
        </div>
        <div className="execution-detail">
          <p className="detail-label">执行主体</p>
          {model.execution.subjects.length === 0 ? (
            <p className="detail-value detail-value--unknown">尚未上报</p>
          ) : (
            <ul role="list" className="subject-list">
              {model.execution.subjects.map((subject) => (
                <li key={`${subject.kind}:${subject.id}:${subject.provider ?? ''}`}>
                  <span>{subject.id}</span>
                  <small>
                    {subject.kind}
                    {subject.provider === null ? '' : ` · ${subject.provider}`}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="execution-detail">
          <div className="task-progress__heading">
            <p className="detail-label">任务进度</p>
            <p className="task-progress__value numeric-value">
              {progressKnown ? `${progress.completed} / ${progress.total}` : '尚未上报'}
            </p>
          </div>
          {progressKnown ? (
            <>
              <progress
                className="task-progress__bar"
                max={Math.max(progress.total, 1)}
                value={progress.completed}
                aria-label="已完成任务"
              />
              <p className="task-progress__meta numeric-value">
                活动 {progress.active} · 失败 {progress.failed}
              </p>
            </>
          ) : progress === null ? (
            <p className="task-progress__meta">等待任务事实。</p>
          ) : (
            <p className="task-progress__meta">
              已识别 {progress.total} 个任务，其中 {progress.unknown} 个状态尚未上报。
            </p>
          )}
        </div>
      </div>

      <div className="active-tasks">
        <div className="active-tasks__heading">
          <h3>活动任务</h3>
          {progress === null ? null : (
            <span className="numeric-value">{model.execution.activeTasks.length}</span>
          )}
        </div>
        {progress === null ? (
          <EmptyRegion>活动任务尚未上报。</EmptyRegion>
        ) : model.execution.activeTasks.length === 0 ? (
          <EmptyRegion>
            {progress.unknown > 0 ? '部分任务状态尚未上报。' : '当前没有活动任务。'}
          </EmptyRegion>
        ) : (
          <ul role="list" className="task-list">
            {model.execution.activeTasks.map((task) => (
              <li key={task.id}>
                <div className="task-list__identity">
                  <p>{task.label}</p>
                  <span>{task.type ?? '类型尚未上报'}</span>
                </div>
                <dl className="task-list__metadata">
                  <div>
                    <dt>阶段</dt>
                    <dd>{task.stageName ?? '尚未上报'}</dd>
                  </div>
                  <div>
                    <dt>执行主体</dt>
                    <dd>{task.subject?.id ?? '尚未上报'}</dd>
                  </div>
                </dl>
                <span
                  className={`task-status task-status--${task.status === 'blocked' ? 'warning' : 'accent'}`}
                >
                  {taskStatusLabel[task.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AssuranceOverview({ model }: { model: DashboardViewModel }) {
  const assurance = model.assurance;
  if (assurance === null) {
    return <EmptyRegion>Evidence、Gate 与阻塞事实尚未上报。</EmptyRegion>;
  }
  const verification = assurance.verification;
  return (
    <div className="assurance-stack">
      <dl className="assurance-overview">
        <div>
          <dt>Evidence Attempt</dt>
          <dd>{verification?.attemptId ?? verification?.id ?? '尚未上报'}</dd>
          <small>
            {verification?.status === null || verification?.status === undefined
              ? '状态尚未上报'
              : (verificationStatusLabel[verification.status] ?? verification.status)}
          </small>
        </div>
        <div>
          <dt>Evidence Gate</dt>
          <dd>
            {verification?.gateStatus === null || verification?.gateStatus === undefined
              ? '尚未上报'
              : gateStatusLabel[verification.gateStatus]}
          </dd>
          <small>{verification?.bundleId ?? 'Bundle 尚未上报'}</small>
        </div>
        <div>
          <dt>验证结果</dt>
          <dd>
            {verification?.outcome === null || verification?.outcome === undefined
              ? '尚未上报'
              : (verificationOutcomeLabel[verification.outcome] ?? verification.outcome)}
          </dd>
          <small>仅显示 OTLP 安全元数据</small>
        </div>
      </dl>

      <div className="assurance-region">
        <div className="assurance-region__heading">
          <h3>Artifact 元数据</h3>
          <span className="numeric-value">{assurance.artifacts.length}</span>
        </div>
        {assurance.artifacts.length === 0 ? (
          <EmptyRegion>Artifact 元数据尚未上报。</EmptyRegion>
        ) : (
          <ul role="list" className="artifact-list">
            {assurance.artifacts.map((artifact) => (
              <li key={artifact.digest}>
                <div className="artifact-list__identity">
                  <p>{artifact.type ?? '类型尚未上报'}</p>
                  <span title={artifact.digest} aria-label={artifact.digest}>
                    {formatDigest(artifact.digest)}
                  </span>
                </div>
                <dl className="artifact-list__metadata">
                  <div>
                    <dt>媒体类型</dt>
                    <dd>{artifact.mediaType ?? '尚未上报'}</dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd className="numeric-value">{formatBytes(artifact.size)}</dd>
                  </div>
                  <div>
                    <dt>脱敏</dt>
                    <dd>
                      {artifact.redacted === null
                        ? '尚未上报'
                        : artifact.redacted
                          ? '已脱敏'
                          : '未标记脱敏'}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="assurance-columns">
        <div className="assurance-region">
          <div className="assurance-region__heading">
            <h3>阻塞与 Human Decision</h3>
            <span className="numeric-value">{assurance.blockers.length}</span>
          </div>
          {assurance.blockers.length === 0 ? (
            <EmptyRegion>当前没有已上报的阻塞。</EmptyRegion>
          ) : (
            <ul role="list" className="assurance-list">
              {assurance.blockers.map((blocker) => (
                <li key={`${blocker.category}:${blocker.requestId}`}>
                  <p>{blockerLabel[blocker.category] ?? blocker.category}</p>
                  <span>{blocker.requestId}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="assurance-region">
          <div className="assurance-region__heading">
            <h3>下一步动作</h3>
            <span className="numeric-value">{assurance.nextActions.length}</span>
          </div>
          {assurance.nextActions.length === 0 ? (
            <EmptyRegion>当前没有已上报的下一步动作。</EmptyRegion>
          ) : (
            <ul role="list" className="assurance-list">
              {assurance.nextActions.map((action) => (
                <li key={action.id}>
                  <p>{action.ref ?? action.id}</p>
                  <span>
                    {action.type ?? '类型尚未上报'} · {action.stageName ?? '阶段尚未上报'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityOverview({ model }: { model: DashboardViewModel }) {
  return (
    <div className="activity-stack">
      <dl className="diagnostic-grid">
        {model.diagnostics.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              <StatusIndicator label={item.value} tone={item.tone} />
            </dd>
            <small>{item.detail}</small>
          </div>
        ))}
      </dl>

      <div className="activity-region">
        <div className="activity-region__heading">
          <h3>最近事件</h3>
          <span className="numeric-value">{model.recentEvents.length}</span>
        </div>
        {model.recentEvents.length === 0 ? (
          <EmptyRegion>尚未收到可关联的观测事件。新事件到达后会自动显示。</EmptyRegion>
        ) : (
          <ol role="list" className="event-list">
            {model.recentEvents.map((event) => (
              <li key={event.id}>
                <div className="event-list__identity">
                  <p>{event.type}</p>
                  <span>{event.detail}</span>
                </div>
                <dl className="event-list__metadata">
                  <div>
                    <dt>Stream</dt>
                    <dd>{event.streamId}</dd>
                  </div>
                  <div>
                    <dt>序列</dt>
                    <dd className="numeric-value">{event.sequence}</dd>
                  </div>
                  <div>
                    <dt>观测时间</dt>
                    <dd>
                      <time dateTime={event.observedAt}>{event.observedAt}</time>
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
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
            <a href="#activity">接收与事件</a>
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
              description="Run 身份、Workflow 与当前观测序列"
            >
              {hasContext ? (
                <SummaryGrid items={model.summary} />
              ) : (
                <EmptyRegion>收到首个 Change 事实后显示运行概览。</EmptyRegion>
              )}
            </DashboardSection>

            <DashboardSection
              id="execution"
              title="阶段与任务"
              description="当前 Run 的执行位置、主体和活动任务"
            >
              {hasContext ? (
                <ExecutionOverview model={model} />
              ) : (
                <EmptyRegion>收到 Run 事实后显示阶段与任务。</EmptyRegion>
              )}
            </DashboardSection>
            <DashboardSection
              id="assurance"
              title="验证与阻塞"
              description="Evidence Gate、安全 Artifact 元数据与待处理事项"
            >
              {hasContext ? (
                <AssuranceOverview model={model} />
              ) : (
                <EmptyRegion>收到验证事实后显示结果。</EmptyRegion>
              )}
            </DashboardSection>

            <DashboardSection
              id="activity"
              title="接收与事件"
              description="Receiver、目的地、重放、新鲜度与序列完整性"
            >
              <ActivityOverview model={model} />
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
