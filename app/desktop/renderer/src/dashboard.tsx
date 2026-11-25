import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { DesktopApplicationSnapshot } from '../../../../services/desktop-application.js';
import {
  activeDelegations,
  changeKey,
  WORK_ACTIVITY_FRESHNESS_MS,
} from '../../../../domains/trajectory/projection-view.js';
import type {
  ChangeProjectionSnapshot,
  ProjectedAttempt,
  ProjectedChange,
  ProjectedDelegation,
  ProjectedHealthDimension,
  ProjectedHealthReason,
  ProjectedTimelineState,
} from '../../../../domains/trajectory/projection.js';
import { AgentList, AgentStrip } from './delegations.js';
import { BuildConfiguration, NextStep, PHASE_NAMES, workflowTone } from './workflow-guidance.js';

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
  sparse: '等待状态',
  'catching-up': '正在同步',
  live: '进行中',
  stale: '状态待确认',
  gap: '数据不完整',
  error: '连接异常',
  stalled: '进展待确认',
  waiting: '等待处理',
  rework: '返工中',
  blocked: '已阻塞',
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
    case 'specification-artifact-missing':
      return '缺少规格文件';
    case 'specification-validation-failed':
      return '规格校验未通过';
    case 'specification-contract-conflict':
      return '规格存在冲突';
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

function PhaseRail({ change, compact = false }: { change: ProjectedChange; compact?: boolean }) {
  return (
    <section
      className={compact ? 'phase-region phase-region--compact' : 'phase-region'}
      aria-label="工作流阶段"
    >
      <ol className="phase-rail" role="list">
        {change.phases.map((phase) => {
          const current = phase.phase === change.phase;
          return (
            <li
              className="phase-step"
              data-state={phase.state}
              key={phase.phase}
              aria-current={current ? 'step' : undefined}
            >
              {!compact ? <StatusDot state={phase.state} /> : null}
              <div className="phase-step__body">
                <div className="phase-step__title">
                  {compact ? (
                    <span>{PHASE_LABELS[phase.phase]}</span>
                  ) : (
                    <h3>{PHASE_LABELS[phase.phase]}</h3>
                  )}
                </div>
                {!compact ? (
                  <p>
                    {PHASE_NAMES[phase.phase]}
                    {current ? ' · 当前' : ''}
                  </p>
                ) : null}
                {!compact && phase.state !== 'not-reported' ? (
                  <span className="phase-step__state">{STATE_LABELS[phase.state]}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PhaseHistory({ change }: { change: ProjectedChange }) {
  return (
    <MetadataList
      items={change.phases.map((phase) => {
        const latest = phase.attempts.at(-1);
        return [
          PHASE_NAMES[phase.phase],
          latest
            ? `${phase.attempts.length} 次尝试 · ${formatTime(latest.enteredAt)} · ${formatDuration(attemptDuration(latest))}`
            : null,
        ];
      })}
    />
  );
}

function BuildTimeline({ change }: { change: ProjectedChange }) {
  return (
    <section className="build-region" aria-labelledby="build-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <h2 id="build-heading">实现进度</h2>
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

function SkillDetails({ skills }: { skills: ProjectedChange['skills'] }) {
  const roleLabel = (role: ProjectedChange['skills'][number]['role']) =>
    ({
      action: '工作流 Action',
      augmentation: '补充方法',
      'builtin-augmentation': '内置方法',
      'team-guidance': '团队指导',
      'team-replacement': '团队替换',
    })[role];
  return (
    <details className="secondary-panel skill-details">
      <summary>Skill 装填详情</summary>
      {skills.length > 0 ? (
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
                    {SKILL_STATUS[stage]}
                  </span>
                ))}
                {skill.state === 'failed' ? <span data-active="true">校验失败</span> : null}
              </div>
              {skill.failureReason ? (
                <p className="skill-row__failure">消费校验失败：{skill.failureReason}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-copy">当前 Work 尚无 Skill 观测。</p>
      )}
      <p className="helper-copy">
        「已确认读取」表示 Runtime 校验了宿主的 Skill 消费证明。实际测试结果见验证证据。
      </p>
    </details>
  );
}

const SKILL_STATUS = {
  'not-reported': '尚未上报',
  resolved: '已选定',
  delivered: '已交付',
  consumed: '已确认读取',
  failed: '校验失败',
} as const;

function CurrentSkills({ change }: { change: ProjectedChange }) {
  if (!change.currentWork) return null;
  const skills = change.skills.filter((skill) => skill.workId === change.currentWork?.workId);
  if (skills.length === 0) return null;
  return (
    <section aria-labelledby="current-skills-heading" className="current-skills">
      <h2 id="current-skills-heading">当前 Skill</h2>
      <ul role="list">
        {skills.map((skill) => (
          <li key={`${skill.role}:${skill.name}`}>
            <span>{skill.name}</span>
            <span>{SKILL_STATUS[skill.state]}</span>
          </li>
        ))}
      </ul>
      <SkillDetails skills={skills} />
    </section>
  );
}

function EvidenceDetails({ change }: { change: ProjectedChange }) {
  const waiting = change.decisions.find(
    (decision) =>
      decision.decisionId === change.lifecycle?.decisionId && decision.state === 'waiting',
  );
  const latestBinding = change.bindingRevalidations.at(-1) ?? null;
  const latestEvidence = change.evidence.at(-1) ?? null;
  return (
    <section className="detail-section" aria-labelledby="evidence-heading">
      <div className="section-heading section-heading--compact">
        <div>
          <h2 id="evidence-heading">审批与验证记录</h2>
        </div>
        <p>{waiting ? '需要人工决定' : value(change.continuation)}</p>
      </div>
      <MetadataList
        items={[
          ['当前审批请求', waiting?.decisionId ?? null],
          ['审批类别', waiting?.kind ?? null],
          ['Strategy', change.strategyId ?? null],
          [
            'Execution Binding',
            change.executionBindingId
              ? `${change.executionBindingId} · r${change.executionBindingRevision ?? '?'}`
              : null,
          ],
          [
            'Binding 自动重验',
            latestBinding
              ? `${latestBinding.state}${latestBinding.reasonClass ? ` · ${latestBinding.reasonClass}` : ''}`
              : null,
          ],
          [
            'Decision 历史',
            change.decisions.length > 0
              ? `${change.decisions.filter((decision) => decision.state === 'resolved').length} resolved · ${change.decisions.filter((decision) => decision.state === 'superseded').length} superseded · ${change.decisions.reduce((total, decision) => total + decision.reuseCount, 0)} reused`
              : null,
          ],
          ['Evidence Attempt', latestEvidence?.attemptId ?? null],
          ['Gate', latestEvidence?.gateStatus ?? null],
          ['Artifact', latestEvidence?.artifacts.at(-1)?.artifactType ?? null],
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

function SelectedChange({
  change,
  agents,
  headingId,
}: {
  change: ProjectedChange;
  agents: ProjectedDelegation[];
  headingId: string;
}) {
  const hasBuildHistory = change.buildActions.some((action) => action.state !== 'not-reported');
  const multiAgent = change.buildStrategy?.executionMode === 'subagent-driven-development';
  const history = (change.delegations ?? []).filter((agent) => !agents.includes(agent));
  return (
    <div className="change-view">
      <header className="change-header">
        <div>
          <p className="breadcrumb">{change.workspaceId}</p>
          <h1 id={headingId}>{change.changeId}</h1>
          <BuildConfiguration change={change} />
        </div>
        <div className="change-status" data-state={change.displayState}>
          <StatusDot state={change.displayState} />
          <span>{DISPLAY_LABELS[change.displayState]}</span>
          <time dateTime={change.latestObservedAt}>{formatTime(change.latestObservedAt)}</time>
        </div>
      </header>
      <PhaseRail change={change} />
      <NextStep change={change} />
      {multiAgent || agents.length > 0 ? <AgentList agents={agents} /> : null}
      <details className="secondary-panel run-details">
        <summary>运行与诊断详情</summary>
        <MetadataList items={[['Run', change.runId]]} />
        <PhaseHistory change={change} />
        {hasBuildHistory ? <BuildTimeline change={change} /> : null}
        <CurrentSkills change={change} />
        {history.length > 0 ? <AgentList agents={history} history /> : null}
        {change.recoveries.length > 0 ? (
          <MetadataList
            items={change.recoveries.map((item) => [
              formatTime(item.observedAt),
              [
                item.fromPhase ? PHASE_NAMES[item.fromPhase] : null,
                item.toPhase ? PHASE_NAMES[item.toPhase] : null,
                item.findingKind,
              ]
                .filter(Boolean)
                .join(' · ') || '恢复记录',
            ])}
          />
        ) : null}
        <div className="detail-region">
          <WorkDetails change={change} />
          <EvidenceDetails change={change} />
        </div>
        <HealthSummary change={change} />
      </details>
    </div>
  );
}

function RunFocus({
  change,
  agents,
  dismiss,
}: {
  change: ProjectedChange;
  agents: ProjectedDelegation[];
  dismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="run-focus"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="run-focus__toolbar">
        <button type="button" onClick={dismiss} autoFocus>
          <span aria-hidden="true">←</span> 全部 Run <kbd>Esc</kbd>
        </button>
      </div>
      <SelectedChange change={change} agents={agents} headingId={headingId} />
    </dialog>
  );
}

function RunCard({
  change,
  agents,
  recent,
  open,
}: {
  change: ProjectedChange;
  agents: ProjectedDelegation[];
  recent: boolean;
  open: (change: ProjectedChange, trigger: HTMLButtonElement) => void;
}) {
  const id = useId();
  const label = `放大 ${change.changeId}，Workspace ${change.workspaceId}，Run ${change.runId}`;
  return (
    <article
      className="run-card"
      data-tone={workflowTone(change)}
      data-recent={recent}
      aria-labelledby={id}
    >
      <header className="run-card__header">
        <div>
          <p className="breadcrumb">{change.workspaceId}</p>
          <h2 id={id}>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => open(change, event.currentTarget)}
            >
              {change.changeId}
            </button>
          </h2>
          <p className="run-id" title={change.runId}>
            Run {change.runId}
          </p>
        </div>
        <button
          type="button"
          className="run-card__expand"
          aria-haspopup="dialog"
          aria-label={label}
          title="放大 Run"
          onClick={(event) => open(change, event.currentTarget)}
        >
          <span aria-hidden="true">↗</span>
        </button>
      </header>
      <BuildConfiguration change={change} />
      <PhaseRail change={change} compact />
      <div className="run-card__work">
        <NextStep change={change} compact />
        <AgentStrip agents={agents} />
      </div>
    </article>
  );
}

function RunGrid({
  changes,
  activeKey,
  now,
  open,
}: {
  changes: ProjectedChange[];
  activeKey: string | null;
  now: number;
  open: (change: ProjectedChange, trigger: HTMLButtonElement) => void;
}) {
  const count = changes.length;
  const columns = count >= 10 ? 4 : count >= 5 ? 3 : count >= 2 ? 2 : 1;
  return (
    <div className="run-grid" data-columns={columns}>
      {changes.map((change) => (
        <RunCard
          key={changeKey(change)}
          change={change}
          recent={changeKey(change) === activeKey}
          agents={activeDelegations(change, now)}
          open={open}
        />
      ))}
    </div>
  );
}

function useObservationClock(changes: ProjectedChange[]) {
  const [, refresh] = useState(0);
  const now = Date.now();
  useEffect(() => {
    let expiration = Infinity;
    for (const change of changes) {
      for (const agent of activeDelegations(change, now)) {
        expiration = Math.min(
          expiration,
          Date.parse(agent.observedAt) + WORK_ACTIVITY_FRESHNESS_MS,
        );
      }
    }
    if (!Number.isFinite(expiration)) return;
    const timer = window.setTimeout(
      () => refresh((value) => value + 1),
      Math.max(0, expiration - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [changes, now]);
  return now;
}

export function Dashboard({
  projection,
  application,
}: {
  projection: ChangeProjectionSnapshot;
  application: DesktopApplicationSnapshot;
}) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const historySummary = useRef<HTMLElement | null>(null);
  const board = useRef<HTMLElement | null>(null);
  const now = useObservationClock(projection.changes);
  const activeKey = application.activeContext ? changeKey(application.activeContext) : null;
  const isTerminal = (change: ProjectedChange) =>
    change.lifecycle?.status === 'completed' || change.lifecycle?.status === 'failed';
  const active = projection.changes.filter((change) => !isTerminal(change));
  const history = projection.changes.filter(isTerminal);
  const focused = projection.changes.find((change) => changeKey(change) === focusedKey);
  const waiting = active.filter((change) => workflowTone(change) === 'decision').length;
  const waitingForActivation =
    activeKey !== null && !projection.changes.some((change) => changeKey(change) === activeKey);
  const open = (change: ProjectedChange, trigger: HTMLButtonElement) => {
    opener.current = trigger;
    setFocusedKey(changeKey(change));
    window.repoctopusDesktop.selectChange({
      schemaVersion: 1,
      workspaceId: change.workspaceId,
      changeId: change.changeId,
      runId: change.runId,
    });
  };
  const dismiss = () => {
    setFocusedKey(null);
    window.requestAnimationFrame(() => {
      const target = opener.current?.isConnected
        ? opener.current
        : (historySummary.current ?? board.current);
      target?.focus({ preventScroll: true });
    });
  };
  return (
    <main className="dashboard-main" ref={board} tabIndex={-1}>
      {active.length > 0 ? (
        <section className="run-board" aria-label="活动 Run">
          <div className="run-board__status">
            <span>{active.length} 条活动 Run</span>
            {waiting > 0 ? (
              <span className="run-board__waiting">{waiting} 条需要你决定</span>
            ) : null}
          </div>
          <RunGrid changes={active} activeKey={activeKey} now={now} open={open} />
        </section>
      ) : (
        <section className="empty-state" aria-live="polite">
          <h1>{waitingForActivation ? '等待启动来源的首个观测' : '暂无活动 Run'}</h1>
          <p>在 Agent 会话启动或恢复 Change 后，运行状态会显示在这里。</p>
        </section>
      )}
      {waitingForActivation && active.length > 0 ? (
        <p className="pending-run" role="status">
          等待启动来源的首个观测
        </p>
      ) : null}
      {history.length > 0 ? (
        <details className="history-board">
          <summary ref={historySummary}>历史 Run · {history.length}</summary>
          <RunGrid changes={history} activeKey={activeKey} now={now} open={open} />
        </details>
      ) : null}
      {focused ? (
        <RunFocus change={focused} agents={activeDelegations(focused, now)} dismiss={dismiss} />
      ) : null}
    </main>
  );
}
