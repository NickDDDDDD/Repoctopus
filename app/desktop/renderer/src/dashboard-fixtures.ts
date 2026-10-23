import {
  dashboardContextId,
  type DashboardNavigationWorkspace,
  type DashboardState,
  type DashboardViewModel,
} from './dashboard-model.js';

const observedAt = '2026-10-23T08:15:42.000Z';
const noExecution = {
  stageName: null,
  subjects: [],
  taskProgress: null,
  activeTasks: [],
} as const;
const waitingDiagnostics = [
  { label: 'Receiver', value: '尚未就绪', detail: '等待 Desktop Host', tone: 'neutral' },
  { label: '本地目的地', value: '尚未就绪', detail: '等待 Receiver', tone: 'neutral' },
  { label: '新鲜度', value: '尚无数据', detail: '等待首个观测事实', tone: 'neutral' },
  { label: '重放', value: '空闲', detail: '尚无重放批次', tone: 'neutral' },
  { label: '序列', value: '尚无数据', detail: '等待首个事件序列', tone: 'neutral' },
] as const;
const liveDiagnostics = [
  { label: 'Receiver', value: '已就绪', detail: '已接收 8 批、42 条记录', tone: 'success' },
  {
    label: '本地目的地',
    value: '健康',
    detail: 'desktop-local · at-least-once',
    tone: 'success',
  },
  { label: '新鲜度', value: '实时', detail: `最后观测 ${observedAt}`, tone: 'success' },
  { label: '重放', value: '空闲', detail: `最近完成 ${observedAt}`, tone: 'neutral' },
  { label: '序列', value: '完整', detail: '已确认至 42', tone: 'success' },
] as const;
const primaryContextId = dashboardContextId('repoctopus', 'add-windows-desktop-dashboard');
const primaryNavigation: DashboardNavigationWorkspace[] = [
  {
    workspaceId: 'repoctopus',
    changes: [
      {
        id: primaryContextId,
        changeId: 'add-windows-desktop-dashboard',
        status: 'active',
        tone: 'success',
        lastObservedAt: observedAt,
      },
    ],
  },
];

function observed(
  state: DashboardState,
  overrides: Partial<DashboardViewModel>,
): DashboardViewModel {
  return {
    state,
    tone: 'success',
    eyebrow: '实时接收',
    title: 'add-windows-desktop-dashboard',
    description: '当前状态由 Desktop Host 接收的标准 OTLP 上报驱动，不读取 Workspace 文件。',
    statusLabel: '实时',
    statusDetail: 'Receiver 正在接收上报',
    context: {
      id: primaryContextId,
      workspaceId: 'repoctopus',
      changeId: 'add-windows-desktop-dashboard',
    },
    navigation: primaryNavigation,
    selectedContextId: primaryContextId,
    summary: [
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: 'Run 状态', value: 'active' },
      { label: 'Workflow', value: 'self-hosted-development' },
      { label: '事件序列', value: '42', numeric: true },
    ],
    execution: {
      stageName: 'implementation',
      subjects: [{ kind: 'agent', id: 'codex-primary', provider: 'openai' }],
      taskProgress: { total: 6, completed: 4, failed: 0, unknown: 0, active: 2 },
      activeTasks: [
        {
          id: 'task-render-run-view',
          label: 'desktop.render-run-view',
          type: 'call_tool',
          status: 'pending',
          stageName: 'implementation',
          subject: { kind: 'agent', id: 'codex-primary', provider: 'openai' },
        },
        {
          id: 'task-review-layout',
          label: 'desktop.review-layout',
          type: 'checkpoint',
          status: 'blocked',
          stageName: 'implementation',
          subject: null,
        },
      ],
    },
    assurance: {
      verification: {
        id: 'attempt-desktop-dashboard-4',
        attemptId: 'attempt-desktop-dashboard-4',
        bundleId: 'bundle-desktop-dashboard-4',
        status: 'satisfied',
        gateStatus: 'satisfied',
        outcome: 'passed_with_warnings',
      },
      artifacts: [
        {
          digest: `sha256:${'8'.repeat(64)}`,
          type: 'command-stdout',
          mediaType: 'text/plain; charset=utf-8',
          size: 18432,
          redacted: true,
        },
        {
          digest: `sha256:${'9'.repeat(64)}`,
          type: 'browser-screenshot',
          mediaType: 'image/png',
          size: 246810,
          redacted: true,
        },
      ],
      blockers: [{ category: 'human-decision', requestId: 'task-review-layout' }],
      nextActions: [
        {
          id: 'task-review-layout',
          type: 'ask_user',
          ref: 'desktop.review-layout',
          stageName: 'implementation',
        },
      ],
    },
    diagnostics: liveDiagnostics,
    recentEvents: [
      {
        id: 'event-42',
        type: 'action.progressed',
        detail: 'desktop.review-layout',
        streamId: 'run-desktop-dashboard',
        sequence: 42,
        observedAt,
      },
      {
        id: 'event-41',
        type: 'evidence.gate.evaluated',
        detail: 'satisfied',
        streamId: 'evidence-desktop-dashboard',
        sequence: 7,
        observedAt: '2026-10-23T08:15:39.000Z',
      },
    ],
    lastObservedAt: observedAt,
    ariaBusy: false,
    canRetry: false,
    ...overrides,
  };
}

export const desktopDashboardFixtures: Readonly<Record<DashboardState, DashboardViewModel>> = {
  starting: {
    state: 'starting',
    tone: 'accent',
    eyebrow: '正在连接',
    title: '正在启动桌面观测',
    description: 'Repoctopus 正在启动隔离的 Desktop Host，并检查 OTLP Receiver 是否就绪。',
    statusLabel: '启动中',
    statusDetail: 'Desktop Host 尚未就绪',
    context: { id: null, workspaceId: null, changeId: null },
    navigation: [],
    selectedContextId: null,
    summary: [],
    execution: noExecution,
    assurance: null,
    diagnostics: waitingDiagnostics,
    recentEvents: [],
    lastObservedAt: null,
    ariaBusy: true,
    canRetry: false,
  },
  empty: {
    state: 'empty',
    tone: 'neutral',
    eyebrow: '等待数据',
    title: '还没有可显示的 Change',
    description:
      'Desktop Host 与 Receiver 已就绪。首个 Repoctopus OTLP 上报到达后，这里会自动更新。',
    statusLabel: '已连接',
    statusDetail: 'Receiver 已就绪，尚未收到观测事实',
    context: { id: null, workspaceId: null, changeId: null },
    navigation: [],
    selectedContextId: null,
    summary: [],
    execution: noExecution,
    assurance: null,
    diagnostics: [
      { label: 'Receiver', value: '已就绪', detail: '尚未收到 OTLP 批次', tone: 'success' },
      {
        label: '本地目的地',
        value: '等待首批确认',
        detail: 'desktop-local · at-least-once',
        tone: 'neutral',
      },
      { label: '新鲜度', value: '尚无数据', detail: '等待首个观测事实', tone: 'neutral' },
      { label: '重放', value: '空闲', detail: '尚无重放批次', tone: 'neutral' },
      { label: '序列', value: '尚无数据', detail: '等待首个事件序列', tone: 'neutral' },
    ],
    recentEvents: [],
    lastObservedAt: null,
    ariaBusy: false,
    canRetry: false,
  },
  sparse: observed('sparse', {
    tone: 'neutral',
    eyebrow: '数据尚不完整',
    description: '已收到 Change 身份，但部分运行字段还没有通过 OTLP 上报。未知值不会被推断。',
    statusLabel: '稀疏数据',
    statusDetail: '等待更多观测事实',
    summary: [
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: 'Run 状态', value: '尚未上报' },
      { label: 'Workflow', value: '尚未上报' },
      { label: '事件序列', value: '1', numeric: true },
    ],
    execution: noExecution,
    assurance: null,
  }),
  live: observed('live', {}),
  'catching-up': observed('catching-up', {
    tone: 'accent',
    eyebrow: '正在追平',
    description: '正在重放 Dashboard 关闭期间积压的 OTLP envelope；已确认事实会持续更新。',
    statusLabel: '追平中',
    statusDetail: '正在重放 18 条积压上报',
    ariaBusy: true,
    diagnostics: liveDiagnostics.map((item) =>
      item.label === '重放'
        ? {
            ...item,
            value: '追平中',
            detail: '本批次 12 / 18 条',
            tone: 'accent' as const,
          }
        : item,
    ),
  }),
  stale: observed('stale', {
    tone: 'warning',
    eyebrow: '状态已过期',
    description: '最近一次上报已超过新鲜度阈值。这里显示的是已确认事实，不代表当前仍在运行。',
    statusLabel: '已过期',
    statusDetail: '等待新的 OTLP 上报',
    lastObservedAt: '2026-10-23T07:52:11.000Z',
    diagnostics: liveDiagnostics.map((item) =>
      item.label === '新鲜度'
        ? {
            ...item,
            value: '已过期',
            detail: '最后观测 2026-10-23T07:52:11.000Z',
            tone: 'warning' as const,
          }
        : item,
    ),
  }),
  gap: observed('gap', {
    tone: 'warning',
    eyebrow: '数据不完整',
    description: '缺少事件序列 18–20。界面只保留已确认事实，等待重放补齐。',
    statusLabel: '存在缺口',
    statusDetail: '缺少序列 18–20',
    diagnostics: liveDiagnostics.map((item) =>
      item.label === '序列'
        ? { ...item, value: '存在缺口', detail: '缺少序列 18–20', tone: 'warning' as const }
        : item,
    ),
  }),
  error: {
    state: 'error',
    tone: 'danger',
    eyebrow: '接收端错误',
    title: 'Desktop Host 无法启动',
    description: 'Receiver 端口初始化失败。',
    statusLabel: '需要处理',
    statusDetail: '本地 Receiver 不可用；工作流与远端遥测不受阻塞',
    context: { id: null, workspaceId: null, changeId: null },
    navigation: [],
    selectedContextId: null,
    summary: [],
    execution: noExecution,
    assurance: null,
    diagnostics: [
      {
        label: 'Receiver',
        value: '不可用',
        detail: 'Receiver 端口初始化失败',
        tone: 'danger',
      },
      ...waitingDiagnostics.slice(1),
    ],
    recentEvents: [],
    lastObservedAt: null,
    ariaBusy: false,
    canRetry: true,
  },
  completed: observed('completed', {
    eyebrow: 'Run 已完成',
    description: '已收到明确的完成事实。最终验证与 Evidence 会在对应区域中呈现。',
    statusLabel: '已完成',
    statusDetail: 'Run 已进入终态',
    summary: [
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: 'Run 状态', value: 'completed' },
      { label: 'Workflow', value: 'self-hosted-development' },
      { label: '事件序列', value: '96', numeric: true },
    ],
    execution: {
      stageName: 'verification',
      subjects: [{ kind: 'agent', id: 'codex-primary', provider: 'openai' }],
      taskProgress: { total: 6, completed: 6, failed: 0, unknown: 0, active: 0 },
      activeTasks: [],
    },
    assurance: {
      verification: {
        id: 'attempt-desktop-dashboard-final',
        attemptId: 'attempt-desktop-dashboard-final',
        bundleId: 'bundle-desktop-dashboard-final',
        status: 'satisfied',
        gateStatus: 'satisfied',
        outcome: 'passed',
      },
      artifacts: [],
      blockers: [],
      nextActions: [],
    },
  }),
  failed: observed('failed', {
    tone: 'danger',
    eyebrow: 'Run 已失败',
    description: '已收到明确的失败事实。查看阻塞与最近事件以定位下一步。',
    statusLabel: '失败',
    statusDetail: 'Run 已进入失败终态',
    summary: [
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: 'Run 状态', value: 'failed' },
      { label: 'Workflow', value: 'self-hosted-development' },
      { label: '事件序列', value: '67', numeric: true },
    ],
    execution: {
      stageName: 'verification',
      subjects: [{ kind: 'agent', id: 'codex-primary', provider: 'openai' }],
      taskProgress: { total: 6, completed: 4, failed: 1, unknown: 0, active: 1 },
      activeTasks: [
        {
          id: 'task-diagnose-failure',
          label: 'desktop.diagnose-failure',
          type: 'checkpoint',
          status: 'pending',
          stageName: 'verification',
          subject: null,
        },
      ],
    },
    assurance: {
      verification: {
        id: 'attempt-desktop-dashboard-failed',
        attemptId: 'attempt-desktop-dashboard-failed',
        bundleId: 'bundle-desktop-dashboard-failed',
        status: 'blocked',
        gateStatus: 'blocked',
        outcome: 'failed',
      },
      artifacts: [],
      blockers: [{ category: 'evidence-gate', requestId: 'bundle-desktop-dashboard-failed' }],
      nextActions: [
        {
          id: 'task-diagnose-failure',
          type: 'checkpoint',
          ref: 'desktop.diagnose-failure',
          stageName: 'verification',
        },
      ],
    },
  }),
};

const multiNavigation: DashboardNavigationWorkspace[] = [
  {
    workspaceId: 'platform-services',
    changes: [
      {
        id: dashboardContextId('platform-services', 'rotate-deploy-credentials'),
        changeId: 'rotate-deploy-credentials',
        status: 'active',
        tone: 'success',
        lastObservedAt: '2026-10-23T08:17:10.000Z',
      },
      {
        id: dashboardContextId('platform-services', 'retire-legacy-runner'),
        changeId: 'retire-legacy-runner',
        status: 'completed',
        tone: 'neutral',
        lastObservedAt: '2026-10-23T08:03:27.000Z',
      },
    ],
  },
  {
    workspaceId: 'repoctopus',
    changes: [
      {
        id: primaryContextId,
        changeId: 'add-windows-desktop-dashboard',
        status: 'active',
        tone: 'success',
        lastObservedAt: observedAt,
      },
      {
        id: dashboardContextId('repoctopus', 'harden-evidence-retention'),
        changeId: 'harden-evidence-retention',
        status: 'failed',
        tone: 'danger',
        lastObservedAt: '2026-10-23T07:58:04.000Z',
      },
    ],
  },
];

function multiContextModel(selectedContextId: string | null): DashboardViewModel {
  const changes = multiNavigation.flatMap((workspace) =>
    workspace.changes.map((change) => ({ workspaceId: workspace.workspaceId, change })),
  );
  const selected = changes.find(({ change }) => change.id === selectedContextId) ?? changes[0];
  if (selected === undefined) throw new Error('Multi-context fixture is empty');
  const state = selected.change.status === 'failed' ? 'failed' : 'live';
  const tone = state === 'failed' ? 'danger' : 'success';
  return observed(state, {
    tone,
    eyebrow: state === 'failed' ? 'Run 已失败' : '实时接收',
    title: selected.change.changeId,
    description:
      state === 'failed'
        ? '已收到明确的失败事实。查看阻塞与最近事件以定位下一步。'
        : '当前选择保持不变；其他 Change 的新上报只更新导航状态。',
    statusLabel: state === 'failed' ? '失败' : '实时',
    statusDetail: state === 'failed' ? 'Run 已进入失败终态' : 'Receiver 正在接收上报',
    context: {
      id: selected.change.id,
      workspaceId: selected.workspaceId,
      changeId: selected.change.changeId,
    },
    navigation: multiNavigation,
    selectedContextId: selected.change.id,
    lastObservedAt: selected.change.lastObservedAt,
    summary: [
      { label: 'Run', value: `run-${selected.change.changeId}` },
      { label: 'Run 状态', value: selected.change.status },
      { label: 'Workflow', value: 'self-hosted-development' },
      { label: '事件序列', value: state === 'failed' ? '19' : '43', numeric: true },
    ],
    execution: {
      ...desktopDashboardFixtures[state].execution,
      stageName: state === 'failed' ? 'verification' : 'implementation',
    },
  });
}

export interface DashboardFixtureLocation {
  protocol: string;
  search: string;
}

export function dashboardFixtureFromLocation(
  location: DashboardFixtureLocation,
  selectedContextId: string | null = null,
): DashboardViewModel | null {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  const fixture = new URLSearchParams(location.search).get('fixture');
  if (fixture === 'multi-context') return multiContextModel(selectedContextId);
  if (fixture === null || !(fixture in desktopDashboardFixtures)) {
    return desktopDashboardFixtures.live;
  }
  return desktopDashboardFixtures[fixture as DashboardState];
}
