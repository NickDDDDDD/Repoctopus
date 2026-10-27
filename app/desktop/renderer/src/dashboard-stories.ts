import {
  DASHBOARD_PHASES,
  emptyDashboardPhases,
  type DashboardModel,
  type DashboardPhase,
  type DashboardPhaseStatus,
  type DashboardSemanticState,
  type DashboardTone,
} from './dashboard-model.js';

export type { DashboardSemanticState } from './dashboard-model.js';

const labels: Record<DashboardPhase, string> = {
  open: 'Open',
  design: 'Design',
  build: 'Build',
  verify: 'Verify',
  archive: 'Archive',
};

function phases(statuses: readonly DashboardPhaseStatus[]): DashboardModel['phases'] {
  return DASHBOARD_PHASES.map((phase, index) => ({
    phase,
    label: labels[phase],
    status: statuses[index] ?? 'not-started',
    history: [],
  }));
}

function story(state: DashboardSemanticState, overrides: Partial<DashboardModel>): DashboardModel {
  const tone: DashboardTone =
    state === 'error' || state === 'failed'
      ? 'danger'
      : state === 'completed'
        ? 'success'
        : ['gap', 'stale', 'waiting-human', 'blocked', 'rework'].includes(state)
          ? 'warning'
          : state === 'empty'
            ? 'neutral'
            : 'info';
  return {
    state,
    tone,
    statusLabel: state,
    title: 'add-windows-desktop-dashboard',
    description: '当前状态由 Repoctopus OTLP 事件构建。',
    workspaceId: 'team-platform',
    changeId: 'add-windows-desktop-dashboard',
    runId: 'run-2026-10-27-01',
    workflowName: 'openspec-change',
    freshnessLabel: 'OTLP 已同步',
    lastObservedAt: '2026-10-27T08:18:00.000Z',
    phases: phases(['completed', 'completed', 'running']),
    currentWork: {
      id: 'build:5.1:b60a94753a57',
      kind: 'task',
      attempt: 1,
      status: 'active',
      phase: 'build',
      task: { id: '5.1', revision: null },
      host: { id: 'external:cli:codex-root', status: 'running' },
      validator: null,
      continuation: 'execute',
      skills: [
        { name: 'codebase-design', role: 'action', status: 'consumed' },
        { name: 'test-driven-development', role: 'augmentation', status: 'delivered' },
      ],
    },
    executionHistory: [],
    evidenceAttempts: [],
    decisions: [],
    blocker: null,
    nextAction: 'execute',
    guidance: '界面只读；状态推进权属于 Runtime。',
    busy: false,
    recoverable: false,
    ...overrides,
  };
}

export const DASHBOARD_STATE_STORIES: Record<DashboardSemanticState, DashboardModel> = {
  starting: story('starting', {
    statusLabel: '正在启动',
    title: '正在启动 Desktop Host',
    description: '正在建立 OTLP 接收边界并恢复本地队列。',
    workspaceId: null,
    changeId: null,
    runId: null,
    workflowName: null,
    freshnessLabel: '等待连接',
    lastObservedAt: null,
    phases: emptyDashboardPhases(),
    currentWork: null,
    guidance: '启动完成后，当前 change 会自动出现。',
    busy: true,
  }),
  empty: story('empty', {
    statusLabel: '等待数据',
    title: '尚未收到 Change 遥测',
    description: 'Desktop Host 已就绪，正在等待第一个 change run。',
    workspaceId: null,
    changeId: null,
    runId: null,
    workflowName: null,
    freshnessLabel: '无事件',
    lastObservedAt: null,
    phases: emptyDashboardPhases(),
    currentWork: null,
    guidance: '开始 run 后无需刷新。',
  }),
  sparse: story('sparse', {
    statusLabel: '上下文稀疏',
    title: 'Change 已识别，等待阶段事件',
    description: '身份事件先于 phase 与 work 事件到达。',
    phases: emptyDashboardPhases(),
    currentWork: null,
    busy: true,
  }),
  live: story('live', {
    statusLabel: '实时',
    title: 'Build 正在执行',
    description: '事件顺序连续，当前投影可用于判断 run 进度。',
    busy: true,
  }),
  'catching-up': story('catching-up', {
    statusLabel: '正在追平',
    title: '正在重放本地遥测队列',
    description: 'Desktop Receiver 已恢复，历史事件正在按序投影。',
    freshnessLabel: '待追平 18 个事件',
    busy: true,
  }),
  stale: story('stale', {
    statusLabel: '数据过期',
    title: '最近一次观测已超过新鲜度阈值',
    description: 'Run 可能仍在执行，但 Desktop 尚未收到后续事件。',
    freshnessLabel: '8 分钟前',
    guidance: '检查 producer 与 Desktop Host 是否仍在运行。',
  }),
  gap: story('gap', {
    statusLabel: '事件不连续',
    title: '遥测序列存在 gap',
    description: '缺失序列恢复前，不将当前投影标记为完全可信。',
    freshnessLabel: '缺少序列 42–44',
    busy: true,
  }),
  'waiting-human': story('waiting-human', {
    statusLabel: '等待人工',
    title: 'Open 已完成，等待审批',
    description: 'Runtime 已停止自动推进，等待明确的人类决定。',
    phases: phases(['completed']),
    currentWork: null,
    guidance: '在原工作入口批准或要求修改；Dashboard 不代替审批入口。',
  }),
  blocked: story('blocked', {
    statusLabel: '已阻塞',
    title: 'Build 无法继续',
    description: '当前 outcome 未满足 Runtime 的推进条件。',
    phases: phases(['completed', 'completed', 'blocked']),
    guidance: '解决 work 报告的阻塞原因后重新运行当前 action。',
  }),
  rework: story('rework', {
    statusLabel: '正在返工',
    title: 'Verify 已将 Change 送回 Build',
    description: '已验证的失败证据触发了合法的反向流转。',
    phases: phases(['completed', 'completed', 'rework', 'not-started']),
    guidance: '只修复当前 action 指向的问题，再由 Runtime 重新验证。',
  }),
  error: story('error', {
    statusLabel: 'Host 错误',
    title: 'Desktop Host 无法启动',
    description: '本机 OTLP Receiver 端口被其他进程占用。',
    workspaceId: null,
    changeId: null,
    runId: null,
    workflowName: null,
    freshnessLabel: '连接失败',
    lastObservedAt: null,
    phases: emptyDashboardPhases(),
    currentWork: null,
    guidance: '释放端口后重试 Desktop Host；不会改变 workflow 状态。',
    recoverable: true,
  }),
  completed: story('completed', {
    statusLabel: '已完成',
    title: 'Change lifecycle 已完成',
    description: '五个阶段均已留下经过 Runtime 验证的 outcome。',
    phases: phases(['completed', 'completed', 'completed', 'completed', 'completed']),
    currentWork: null,
  }),
  failed: story('failed', {
    statusLabel: '失败',
    title: 'Verify run 已失败',
    description: 'Runtime 已记录失败 outcome，并停止生命周期推进。',
    phases: phases(['completed', 'completed', 'completed', 'failed']),
    currentWork: {
      id: 'verify:acceptance',
      kind: 'verification',
      attempt: 2,
      status: 'failed',
      phase: 'verify',
      task: null,
      host: { id: 'external:cli:codex-root', status: 'completed' },
      validator: { id: 'verify.acceptance', status: 'failed' },
      continuation: null,
      skills: [{ name: 'systematic-debugging', role: 'action', status: 'consumed' }],
    },
    guidance: '检查失败证据并启动恢复 action。',
  }),
};
