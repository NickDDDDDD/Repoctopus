import type { DesktopApplicationSnapshot } from '../../../../services/desktop-application.js';
import type {
  ChangeProjectionSnapshot,
  ProjectedAttempt,
  ProjectedChange,
  ProjectedHealthDimension,
  ProjectedHealthReason,
  ProjectedTimelineState,
} from '../../../../domains/trajectory/projection.js';

const PHASE_LABELS = {
  open: 'Open',
  design: 'Design',
  build: 'Build',
  verify: 'Verify',
  archive: 'Archive',
} as const;

const ACTION_LABELS = {
  configure: 'Configure',
  plan: 'Plan',
  'plan-evidence': 'Plan Evidence',
  execute: 'Execute',
  check: 'Check',
} as const;

const STATE_LABELS: Record<ProjectedTimelineState, string> = {
  'not-reported': '尚未上报',
  pending: '待执行',
  running: '进行中',
  waiting: '等待中',
  blocked: '已阻塞',
  rework: '返工中',
  completed: '已完成',
  failed: '失败',
};

const DISPLAY_LABELS: Record<ProjectedChange['displayState'], string> = {
  sparse: '事实稀疏',
  'catching-up': '正在追平',
  live: '实时',
  stale: '数据过期',
  gap: '存在缺口',
  error: '接收异常',
  stalled: '执行停滞',
  waiting: '等待决定',
  rework: '返工中',
  complete: '已完成',
  failed: '失败',
};

const HEALTH_LABELS = {
  transition: '流转',
  execution: '执行',
  quality: '质量',
  telemetry: '遥测',
} as const;

const HEALTH_STATE_LABELS: Record<ProjectedHealthDimension['status'], string> = {
  'not-reported': '尚未上报',
  healthy: '正常',
  attention: '需关注',
  critical: '异常',
};

function formatTime(value: string | null): string {
  if (value === null) return '尚未上报';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '尚未上报';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return '尚未上报';
  if (milliseconds < 1_000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} 秒`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} 分钟`;
  return `${Math.round(milliseconds / 3_600_000)} 小时`;
}

function attemptDuration(attempt: ProjectedAttempt): number | null {
  if (attempt.exitedAt === null) return null;
  return Math.max(0, Date.parse(attempt.exitedAt) - Date.parse(attempt.enteredAt));
}

function value(value: string | number | null): string {
  return value === null ? '尚未上报' : String(value);
}

function reasonText(reason: ProjectedHealthReason): string {
  switch (reason.code) {
    case 'phase-failed':
      return `${reason.phase ? PHASE_LABELS[reason.phase] : '阶段'}失败`;
    case 'phase-blocked':
      return `${reason.phase ? PHASE_LABELS[reason.phase] : '阶段'}被阻塞`;
    case 'human-decision':
      return '等待人工决定';
    case 'fallback':
      return `已发生 ${reason.count ?? 1} 次回退`;
    case 'work-failed':
      return `Work ${reason.workId ?? ''} 执行失败`.trim();
    case 'work-stalled':
      return `Work 已停滞 ${formatDuration(reason.durationMs ?? null)}`;
    case 'work-waiting':
      return 'Work 正在等待外部结果';
    case 'gate-failed':
      return `Evidence Gate 未通过${reason.evidenceAttemptId ? ` · ${reason.evidenceAttemptId}` : ''}`;
    case 'verification-rework':
      return `验证触发 ${reason.count ?? 1} 次返工`;
    case 'sequence-gap':
      return `缺少 ${reason.count ?? 0} 个观测序列`;
    case 'receiver-error':
      return '本地接收器报告错误';
    case 'telemetry-stale':
      return '最新观测已过期';
    case 'telemetry-catching-up':
      return '本地投影正在追平';
    case 'destination-backlog':
      return `${reason.destinationId ?? '目的地'}积压 ${reason.count ?? 0} 条`;
    case 'destination-failed':
      return `${reason.destinationId ?? '目的地'}最近投递失败${reason.category ? ` · ${reason.category}` : ''}`;
    default:
      return reason.code;
  }
}

function StateBadge({ state }: { state: ProjectedTimelineState }) {
  return (
    <span className="state-badge" data-state={state}>
      {STATE_LABELS[state]}
    </span>
  );
}

function StatusDot({ state }: { state: string }) {
  return <span className="status-dot" data-state={state} aria-hidden="true" />;
}

function ChangeNavigation({
  snapshot,
  application,
}: {
  snapshot: ChangeProjectionSnapshot;
  application: DesktopApplicationSnapshot;
}) {
  const selected = application.selectedContext;
  const workspaces = [...new Set(snapshot.changes.map((change) => change.workspaceId))].sort();
  const select = (change: ProjectedChange) => {
    window.repoctopusDesktop.selectChange({
      schemaVersion: 1,
      workspaceId: change.workspaceId,
      changeId: change.changeId,
      runId: change.runId,
    });
  };
  const list = (
    <div className="change-list" role="list">
      {workspaces.map((workspaceId) => (
        <section
          className="workspace-group"
          key={workspaceId}
          aria-labelledby={`workspace-${workspaceId}`}
        >
          <h2 id={`workspace-${workspaceId}`}>{workspaceId}</h2>
          <div className="workspace-changes" role="list">
            {snapshot.changes
              .filter((change) => change.workspaceId === workspaceId)
              .map((change) => {
                const isSelected =
                  selected?.workspaceId === change.workspaceId &&
                  selected.changeId === change.changeId &&
                  selected.runId === change.runId;
                return (
                  <button
                    className="change-row"
                    type="button"
                    aria-pressed={isSelected}
                    key={`${change.changeId}\0${change.runId}`}
                    onClick={() => select(change)}
                  >
                    <StatusDot state={change.displayState} />
                    <span className="change-row__copy">
                      <span className="change-row__name">{change.changeId}</span>
                      <span className="change-row__meta">
                        {DISPLAY_LABELS[change.displayState]} ·{' '}
                        {formatTime(change.latestObservedAt)}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );

  return (
    <>
      <aside className="change-sidebar" aria-label="Workspace 与 change">
        <div className="sidebar-heading">
          <p>当前工作</p>
          <span>{snapshot.changes.length} 个 change</span>
        </div>
        {list}
      </aside>
      <details className="mobile-change-nav">
        <summary>
          <span>切换 change</span>
          <span>{selected?.changeId ?? '尚未选择'}</span>
        </summary>
        {list}
      </details>
    </>
  );
}

function PhaseRail({ change }: { change: ProjectedChange }) {
  return (
    <section className="phase-region" aria-labelledby="phase-heading">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Lifecycle</p>
          <h2 id="phase-heading">五阶段</h2>
        </div>
        <p>尝试与时间只来自已接收的权威事实</p>
      </div>
      <ol className="phase-rail" role="list">
        {change.phases.map((phase, index) => {
          const latest = phase.attempts.at(-1);
          return (
            <li className="phase-step" data-state={phase.state} key={phase.phase}>
              <div className="phase-step__index" aria-hidden="true">
                {index + 1}
              </div>
              <div className="phase-step__body">
                <div className="phase-step__title">
                  <h3>{PHASE_LABELS[phase.phase]}</h3>
                  <StateBadge state={phase.state} />
                </div>
                <dl>
                  <div>
                    <dt>尝试</dt>
                    <dd className="numeric">{phase.attempts.length || '—'}</dd>
                  </div>
                  <div>
                    <dt>进入</dt>
                    <dd>{formatTime(latest?.enteredAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt>耗时</dt>
                    <dd>{formatDuration(latest ? attemptDuration(latest) : null)}</dd>
                  </div>
                </dl>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function BuildTimeline({ change }: { change: ProjectedChange }) {
  return (
    <section className="build-region" aria-labelledby="build-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="section-kicker">Build</p>
          <h2 id="build-heading">执行动作</h2>
        </div>
        <p>{change.buildAction ? ACTION_LABELS[change.buildAction] : '当前 action 尚未上报'}</p>
      </div>
      <ol className="build-actions" role="list">
        {change.buildActions.map((action) => (
          <li key={action.action} data-state={action.state}>
            <StatusDot state={action.state} />
            <span>{ACTION_LABELS[action.action]}</span>
            <StateBadge state={action.state} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function MetadataList({ items }: { items: ReadonlyArray<[string, string | number | null]> }) {
  return (
    <dl className="metadata-list">
      {items.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value(detail)}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorkDetails({ change }: { change: ProjectedChange }) {
  const work = change.currentWork;
  return (
    <section className="detail-section" aria-labelledby="work-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="section-kicker">Current work</p>
          <h2 id="work-heading">当前执行</h2>
        </div>
        {work ? <StateBadge state={work.state} /> : <StateBadge state="not-reported" />}
      </div>
      <MetadataList
        items={[
          ['Work', work?.workId ?? null],
          ['Task', work?.taskId ?? null],
          ['Package', work?.packageId ?? null],
          ['Attempt', work?.attempt ?? null],
          ['Host', work?.hostId ?? null],
          ['Validator', work?.validatorId ?? null],
          ['Continuation', work?.continuation ?? null],
          ['最近活动', work ? formatTime(work.latestObservedAt) : null],
        ]}
      />
    </section>
  );
}

function SkillDetails({ change }: { change: ProjectedChange }) {
  const skills = change.currentWork
    ? change.skills.filter((skill) => skill.workId === change.currentWork?.workId)
    : [];
  const roleLabel = (role: ProjectedChange['skills'][number]['role']) =>
    ({
      action: 'Action Skill',
      augmentation: 'Legacy augmentation',
      'builtin-augmentation': 'Built-in augmentation',
      'team-guidance': 'Team guidance',
      'team-replacement': 'Team replacement',
    })[role];
  return (
    <section className="detail-section" aria-labelledby="skill-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="section-kicker">Skill chain</p>
          <h2 id="skill-heading">Skill 装填与消费</h2>
        </div>
        <p>{skills.length > 0 ? `${skills.length} 个` : '尚未上报'}</p>
      </div>
      {skills.length === 0 ? (
        <p className="empty-copy">当前 Work 没有已上报的 Skill 事实。</p>
      ) : (
        <div className="skill-list" role="list">
          {skills.map((skill) => (
            <div className="skill-row" role="listitem" key={`${skill.role}:${skill.name}`}>
              <div>
                <p>{skill.name}</p>
                <span>
                  {roleLabel(skill.role)}
                  {skill.slotId ? ` · slot ${skill.slotId}` : ''}
                  {skill.replacedSkillName ? ` · replaces ${skill.replacedSkillName}` : ''}
                  {skill.bindingId ? ` · team ${skill.bindingId}` : ''}
                </span>
              </div>
              <div className="skill-stages" aria-label={`${skill.name} 生命周期`}>
                {(['resolved', 'delivered', 'consumed'] as const).map((stage) => (
                  <span
                    key={stage}
                    data-active={
                      skill.state === stage ||
                      (stage === 'resolved' && ['delivered', 'consumed'].includes(skill.state)) ||
                      (stage === 'delivered' && skill.state === 'consumed')
                    }
                  >
                    {stage}
                  </span>
                ))}
                {skill.state === 'failed' ? <span data-active="true">failed</span> : null}
              </div>
              {skill.failureReason ? (
                <p className="skill-row__failure">消费校验失败：{skill.failureReason}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <p className="helper-copy">
        consumed 表示 Host 声明并由 Runtime 校验的消费证明，不代表 Agent 的内部思考。
      </p>
    </section>
  );
}

function EvidenceDetails({ change }: { change: ProjectedChange }) {
  const waiting = change.decisions.filter((decision) => decision.state === 'waiting');
  const latestEvidence = change.evidence.at(-1) ?? null;
  return (
    <section className="detail-section" aria-labelledby="evidence-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <p className="section-kicker">Decision & evidence</p>
          <h2 id="evidence-heading">验证与下一步</h2>
        </div>
        <p>{waiting.length > 0 ? '需要人工决定' : value(change.continuation)}</p>
      </div>
      <MetadataList
        items={[
          ['Human Decision', waiting[0]?.decisionId ?? null],
          ['Decision 类别', waiting[0]?.kind ?? null],
          ['Evidence Attempt', latestEvidence?.attemptId ?? null],
          ['Gate', latestEvidence?.gateStatus ?? null],
          ['Artifact', latestEvidence?.artifacts.at(-1)?.artifactType ?? null],
          ['下一步', change.continuation ?? null],
        ]}
      />
      {latestEvidence?.artifacts.length ? (
        <p className="helper-copy">
          仅显示 Artifact 类型、摘要身份和脱敏标记；正文、绝对路径、Prompt 与命令输出不会进入投影。
        </p>
      ) : null}
    </section>
  );
}

function HealthSummary({ change }: { change: ProjectedChange }) {
  return (
    <section className="health-region" aria-labelledby="health-heading">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Explainable health</p>
          <h2 id="health-heading">工作流健康</h2>
        </div>
        <p>四个维度独立判断，不合成总分</p>
      </div>
      <div className="health-grid" role="list">
        {(
          Object.entries(change.health) as Array<
            [keyof ProjectedChange['health'], ProjectedHealthDimension]
          >
        ).map(([dimension, health]) => (
          <section className="health-item" role="listitem" key={dimension}>
            <div className="health-item__title">
              <StatusDot state={health.status} />
              <h3>{HEALTH_LABELS[dimension]}</h3>
              <span>{HEALTH_STATE_LABELS[health.status]}</span>
            </div>
            {health.reasons.length > 0 ? (
              <ul role="list">
                {health.reasons.map((reason, index) => (
                  <li key={`${reason.code}:${index}`}>{reasonText(reason)}</li>
                ))}
              </ul>
            ) : (
              <p>{health.status === 'not-reported' ? '尚无可信事实' : '未发现异常事实'}</p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function SelectedChange({ change }: { change: ProjectedChange }) {
  return (
    <div className="change-view">
      <header className="change-header">
        <div>
          <p className="breadcrumb">{change.workspaceId}</p>
          <h1>{change.changeId}</h1>
          <p className="run-id">{change.runId}</p>
        </div>
        <div className="change-status" data-state={change.displayState}>
          <StatusDot state={change.displayState} />
          <span>{DISPLAY_LABELS[change.displayState]}</span>
          <time dateTime={change.latestObservedAt}>{formatTime(change.latestObservedAt)}</time>
        </div>
      </header>
      <PhaseRail change={change} />
      <BuildTimeline change={change} />
      <div className="detail-region">
        <WorkDetails change={change} />
        <SkillDetails change={change} />
        <EvidenceDetails change={change} />
      </div>
      <HealthSummary change={change} />
    </div>
  );
}

function NoSelection({ application }: { application: DesktopApplicationSnapshot }) {
  return (
    <section className="empty-state" aria-live="polite">
      <p className="section-kicker">Ready</p>
      <h1>{application.activeContext ? '等待启动来源的首个观测' : '选择一个 change'}</h1>
      <p>
        {application.activeContext
          ? 'Desktop Host 已收到 Run 上下文。投影会在第一批 OTLP 事实到达后显示，不会扫描 Workspace 文件补造状态。'
          : '左侧会列出已通过本地 OTLP 接收器上报的 Workspace 与 change。'}
      </p>
    </section>
  );
}

export function Dashboard({
  projection,
  application,
}: {
  projection: ChangeProjectionSnapshot;
  application: DesktopApplicationSnapshot;
}) {
  const selected = application.selectedContext;
  const change = selected
    ? (projection.changes.find(
        (candidate) =>
          candidate.workspaceId === selected.workspaceId &&
          candidate.changeId === selected.changeId &&
          candidate.runId === selected.runId,
      ) ?? null)
    : null;

  return (
    <div className="workspace-layout">
      <ChangeNavigation snapshot={projection} application={application} />
      <main className="dashboard-main">
        {change ? <SelectedChange change={change} /> : <NoSelection application={application} />}
      </main>
    </div>
  );
}
