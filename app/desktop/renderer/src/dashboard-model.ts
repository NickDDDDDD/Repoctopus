import type { DesktopShellState } from '../../shared/renderer-contract.js';
import type { DashboardSelection } from './dashboard-navigation.js';

export const DASHBOARD_PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;

export type DashboardPhase = (typeof DASHBOARD_PHASES)[number];
export type DashboardSemanticState =
  | 'starting'
  | 'empty'
  | 'sparse'
  | 'live'
  | 'catching-up'
  | 'stale'
  | 'gap'
  | 'waiting-human'
  | 'blocked'
  | 'rework'
  | 'error'
  | 'completed'
  | 'failed';
export type DashboardTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type DashboardPhaseStatus =
  | 'not-started'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'rework'
  | 'failed';

export interface DashboardPhaseModel {
  phase: DashboardPhase;
  label: string;
  status: DashboardPhaseStatus;
  history: readonly {
    event: 'entered' | 'completed' | 'reopened';
    sequence: number;
    observedAt: string;
    recoverySourcePhase: DashboardPhase | null;
  }[];
}

export interface DashboardSkillModel {
  name: string;
  role: 'action' | 'augmentation';
  status: 'resolved' | 'delivered' | 'consumed';
}

export interface DashboardWorkModel {
  id: string;
  kind: string;
  attempt: number;
  status: 'active' | 'completed' | 'failed';
  phase: DashboardPhase;
  task: { id: string; revision: string | null } | null;
  host: { id: string; status: 'running' | 'completed' | 'failed' } | null;
  validator: { id: string; status: 'running' | 'completed' | 'failed' } | null;
  continuation: 'execute' | 'ask' | 'wait' | 'reconcile' | 'done' | null;
  skills: readonly DashboardSkillModel[];
}

export interface DashboardModel {
  state: DashboardSemanticState;
  tone: DashboardTone;
  statusLabel: string;
  title: string;
  description: string;
  workspaceId: string | null;
  changeId: string | null;
  runId: string | null;
  workflowName: string | null;
  freshnessLabel: string;
  lastObservedAt: string | null;
  phases: readonly DashboardPhaseModel[];
  currentWork: DashboardWorkModel | null;
  executionHistory: readonly DashboardWorkModel[];
  evidenceAttempts: readonly {
    attemptId: string;
    status: string | null;
    gate: { bundleId: string | null; status: string; outcome: string } | null;
    artifacts: readonly {
      digest: string;
      type: string;
      size: number;
      mediaType: string;
      redacted: boolean;
    }[];
  }[];
  decisions: readonly {
    id: string;
    kind: string;
    status: 'requested' | 'resolved';
    result: string | null;
  }[];
  blocker: { id: string; kind: string } | null;
  nextAction: string | null;
  guidance: string;
  busy: boolean;
  recoverable: boolean;
}

const PHASE_LABELS: Record<DashboardPhase, string> = {
  open: 'Open',
  design: 'Design',
  build: 'Build',
  verify: 'Verify',
  archive: 'Archive',
};

export function emptyDashboardPhases(): DashboardPhaseModel[] {
  return DASHBOARD_PHASES.map((phase) => ({
    phase,
    label: PHASE_LABELS[phase],
    status: 'not-started',
    history: [],
  }));
}

function shellModel(
  state: DashboardSemanticState,
  fields: Pick<
    DashboardModel,
    | 'tone'
    | 'statusLabel'
    | 'title'
    | 'description'
    | 'freshnessLabel'
    | 'guidance'
    | 'busy'
    | 'recoverable'
  >,
): DashboardModel {
  return {
    state,
    ...fields,
    workspaceId: null,
    changeId: null,
    runId: null,
    workflowName: null,
    lastObservedAt: null,
    phases: emptyDashboardPhases(),
    currentWork: null,
    executionHistory: [],
    evidenceAttempts: [],
    decisions: [],
    blocker: null,
    nextAction: null,
  };
}

const STARTING_MODEL = shellModel('starting', {
  tone: 'info',
  statusLabel: '正在启动',
  title: '正在启动 Desktop Host',
  description: '正在建立本机 OTLP 接收边界并恢复尚未投影的观测事件。',
  freshnessLabel: '等待连接',
  guidance: '启动完成后，当前 change 会自动出现在这里。',
  busy: true,
  recoverable: false,
});

function readyWithoutRunModel(): DashboardModel {
  return shellModel('empty', {
    tone: 'neutral',
    statusLabel: '等待数据',
    title: '尚未收到 Change 遥测',
    description: 'Desktop Host 已就绪；新的 Repoctopus run 会通过同一套 OTLP 事件更新此处。',
    freshnessLabel: '无事件',
    guidance: '开始一个 change run 后无需刷新窗口。',
    busy: false,
    recoverable: false,
  });
}

function stateCopy(
  state: DashboardSemanticState,
): Pick<
  DashboardModel,
  'tone' | 'statusLabel' | 'title' | 'description' | 'guidance' | 'busy' | 'recoverable'
> {
  switch (state) {
    case 'sparse':
      return {
        tone: 'info',
        statusLabel: '正在建立上下文',
        title: 'Change 已识别，等待阶段事件',
        description: '已收到 run 身份，但当前 phase 或 work 尚未完整上报。',
        guidance: '保持 run 运行；后续 OTLP 事件会补全视图。',
        busy: true,
        recoverable: false,
      };
    case 'gap':
      return {
        tone: 'warning',
        statusLabel: '事件不连续',
        title: '遥测序列存在 gap',
        description: '当前投影缺少一个或多个序列号，因此界面不会把状态标记为完全可信。',
        guidance: 'Desktop Host 会通过持久化队列恢复；无需修改 workflow 状态。',
        busy: true,
        recoverable: false,
      };
    case 'blocked':
      return {
        tone: 'warning',
        statusLabel: '已阻塞',
        title: '当前阶段无法继续',
        description: 'Runtime 已验证当前 outcome 不满足推进条件。',
        guidance: '查看当前 work 与 skill，解决阻塞原因后由 Runtime 重新选择 action。',
        busy: false,
        recoverable: false,
      };
    case 'rework':
      return {
        tone: 'warning',
        statusLabel: '正在返工',
        title: 'Change 已回到前序阶段',
        description: 'Runtime 根据验证结果重新打开了一个已完成阶段。',
        guidance: '只处理当前 action；完成后仍由 Runtime 验证并推进。',
        busy: false,
        recoverable: false,
      };
    case 'completed':
      return {
        tone: 'success',
        statusLabel: '已完成',
        title: 'Change lifecycle 已完成',
        description: 'Open、Design、Build、Verify 与 Archive 均已留下已验证的 outcome。',
        guidance: '此视图保留最终状态，便于核对交付结果。',
        busy: false,
        recoverable: false,
      };
    case 'failed':
      return {
        tone: 'danger',
        statusLabel: '失败',
        title: '当前 run 已失败',
        description: 'Runtime 已记录失败 outcome，生命周期不会自动越过失败阶段。',
        guidance: '从失败 work 的证据开始排查，再启动新的恢复 action。',
        busy: false,
        recoverable: false,
      };
    default:
      return {
        tone: 'success',
        statusLabel: '实时',
        title: 'Change 正在执行',
        description: '状态来自 Desktop OTLP Receiver 的有序投影。',
        guidance: '界面只读；阶段推进权始终属于 Runtime。',
        busy: true,
        recoverable: false,
      };
  }
}

export function dashboardModelFromShell(
  shell: DesktopShellState,
  selection: DashboardSelection | null = null,
): DashboardModel {
  if (shell.phase === 'starting') return STARTING_MODEL;
  if (shell.phase === 'error') {
    return {
      ...shellModel('error', {
        tone: 'danger',
        statusLabel: 'Host 错误',
        title: 'Desktop Host 无法启动',
        description: shell.message,
        freshnessLabel: '连接失败',
        guidance: '检查错误后重试 Desktop Host；此操作不会改变 change 状态。',
        busy: false,
        recoverable: true,
      }),
    };
  }

  const activeIdentity = selection ?? shell.projection.activeChange;
  const change = activeIdentity
    ? shell.projection.changes.find(
        (candidate) =>
          candidate.workspaceId === activeIdentity.workspaceId &&
          candidate.changeId === activeIdentity.changeId,
      )
    : undefined;
  const run = change?.runs.find((candidate) => candidate.runId === change.currentRunId);
  if (!change || !run) {
    if (activeIdentity === null) return readyWithoutRunModel();
    const launchRunId =
      shell.launchContext?.workspaceId === activeIdentity.workspaceId &&
      shell.launchContext.changeId === activeIdentity.changeId
        ? shell.launchContext.runId
        : null;
    return {
      ...shellModel('sparse', {
        ...stateCopy('sparse'),
        freshnessLabel: '等待首条事件',
      }),
      workspaceId: activeIdentity.workspaceId,
      changeId: activeIdentity.changeId,
      runId: launchRunId,
    };
  }

  const phaseStatus = new Map(run.phases.map((phase) => [phase.phase, phase.status]));
  const failedPhase = run.status === 'failed' ? run.currentPhase : null;
  const phases: DashboardPhaseModel[] = DASHBOARD_PHASES.map((phase) => ({
    phase,
    label: PHASE_LABELS[phase],
    status: failedPhase === phase ? 'failed' : (phaseStatus.get(phase) ?? 'not-started'),
    history:
      run.phases
        .find((candidate) => candidate.phase === phase)
        ?.history.map((entry) => ({
          event: entry.event,
          sequence: entry.sequence,
          observedAt: entry.observedAt,
          recoverySourcePhase: entry.recoverySourcePhase,
        })) ?? [],
  }));
  const state: DashboardSemanticState =
    shell.projection.freshness.status === 'gap'
      ? 'gap'
      : run.status === 'failed'
        ? 'failed'
        : run.status === 'completed'
          ? 'completed'
          : run.blocker?.kind === 'human-decision'
            ? 'waiting-human'
            : phases.some((phase) => phase.status === 'rework')
              ? 'rework'
              : phases.some((phase) => phase.status === 'blocked')
                ? 'blocked'
                : run.currentPhase === null
                  ? 'sparse'
                  : 'live';
  const copy = stateCopy(state);

  const workModel = (work: (typeof run.works)[number]): DashboardWorkModel => ({
    id: work.id,
    kind: work.kind,
    attempt: work.attempt,
    status: work.status,
    phase: work.phase,
    task: work.task ? { ...work.task } : null,
    host: work.host ? { ...work.host } : null,
    validator: work.validator ? { ...work.validator } : null,
    continuation: work.continuation,
    skills: work.skills.map((skill) => ({
      name: skill.name,
      role: skill.role,
      status: skill.status,
    })),
  });

  return {
    state,
    ...copy,
    workspaceId: change.workspaceId,
    changeId: change.changeId,
    runId: run.runId,
    workflowName: run.workflowName,
    freshnessLabel:
      shell.projection.freshness.status === 'gap'
        ? `缺少 ${shell.projection.freshness.missingSequences.length} 个事件`
        : 'OTLP 已同步',
    lastObservedAt: run.latestObservedAt,
    phases,
    currentWork: run.currentWork ? workModel(run.currentWork) : null,
    executionHistory: [...run.works]
      .sort(
        (left, right) =>
          right.lastSequence - left.lastSequence ||
          right.attempt - left.attempt ||
          left.id.localeCompare(right.id),
      )
      .map(workModel),
    evidenceAttempts: run.evidenceAttempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      status: attempt.status,
      gate: attempt.gate ? { ...attempt.gate } : null,
      artifacts: attempt.artifacts.map((artifact) => ({ ...artifact })),
    })),
    decisions: run.decisions.map((decision) => ({
      id: decision.id,
      kind: decision.kind,
      status: decision.status,
      result: decision.result,
    })),
    blocker: run.blocker ? { ...run.blocker } : null,
    nextAction: run.nextAction,
  };
}
