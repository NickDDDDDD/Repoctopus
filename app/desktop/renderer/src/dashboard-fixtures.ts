import type { DashboardState, DashboardViewModel } from './dashboard-model.js';

const observedAt = '2026-10-23T08:15:42.000Z';

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
      workspaceId: 'repoctopus',
      changeId: 'add-windows-desktop-dashboard',
    },
    summary: [
      { label: 'Change 状态', value: 'active' },
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: '阶段', value: 'implementation' },
      { label: '事件序列', value: '42', numeric: true },
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
    context: { workspaceId: null, changeId: null },
    summary: [],
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
    context: { workspaceId: null, changeId: null },
    summary: [],
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
      { label: 'Change 状态', value: '尚未上报' },
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: '阶段', value: '尚未上报' },
      { label: '事件序列', value: '1', numeric: true },
    ],
  }),
  live: observed('live', {}),
  'catching-up': observed('catching-up', {
    tone: 'accent',
    eyebrow: '正在追平',
    description: '正在重放 Dashboard 关闭期间积压的 OTLP envelope；已确认事实会持续更新。',
    statusLabel: '追平中',
    statusDetail: '正在重放 18 条积压上报',
    ariaBusy: true,
  }),
  stale: observed('stale', {
    tone: 'warning',
    eyebrow: '状态已过期',
    description: '最近一次上报已超过新鲜度阈值。这里显示的是已确认事实，不代表当前仍在运行。',
    statusLabel: '已过期',
    statusDetail: '等待新的 OTLP 上报',
    lastObservedAt: '2026-10-23T07:52:11.000Z',
  }),
  gap: observed('gap', {
    tone: 'warning',
    eyebrow: '数据不完整',
    description: '缺少事件序列 18–20。界面只保留已确认事实，等待重放补齐。',
    statusLabel: '存在缺口',
    statusDetail: '缺少序列 18–20',
  }),
  error: {
    state: 'error',
    tone: 'danger',
    eyebrow: '接收端错误',
    title: 'Desktop Host 无法启动',
    description: 'Receiver 端口初始化失败。',
    statusLabel: '需要处理',
    statusDetail: '本地 Receiver 不可用；工作流与远端遥测不受阻塞',
    context: { workspaceId: null, changeId: null },
    summary: [],
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
      { label: 'Change 状态', value: 'completed' },
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: '阶段', value: 'verification' },
      { label: '事件序列', value: '96', numeric: true },
    ],
  }),
  failed: observed('failed', {
    tone: 'danger',
    eyebrow: 'Run 已失败',
    description: '已收到明确的失败事实。查看阻塞与最近事件以定位下一步。',
    statusLabel: '失败',
    statusDetail: 'Run 已进入失败终态',
    summary: [
      { label: 'Change 状态', value: 'failed' },
      { label: 'Run', value: 'run-desktop-dashboard' },
      { label: '阶段', value: 'verification' },
      { label: '事件序列', value: '67', numeric: true },
    ],
  }),
};

export interface DashboardFixtureLocation {
  protocol: string;
  search: string;
}

export function dashboardFixtureFromLocation(
  location: DashboardFixtureLocation,
): DashboardViewModel | null {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  const fixture = new URLSearchParams(location.search).get('fixture');
  if (fixture === null || !(fixture in desktopDashboardFixtures)) {
    return desktopDashboardFixtures.live;
  }
  return desktopDashboardFixtures[fixture as DashboardState];
}
