import type { DesktopShellState } from '../../shared/renderer-contract.js';

export const DASHBOARD_STATES = [
  'starting',
  'empty',
  'sparse',
  'live',
  'catching-up',
  'stale',
  'gap',
  'error',
  'completed',
  'failed',
] as const;

export type DashboardState = (typeof DASHBOARD_STATES)[number];
export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface DashboardContext {
  workspaceId: string | null;
  changeId: string | null;
}

export interface DashboardSummaryItem {
  label: string;
  value: string;
  numeric?: boolean;
}

export interface DashboardViewModel {
  state: DashboardState;
  tone: StatusTone;
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: string;
  statusDetail: string;
  context: DashboardContext;
  summary: readonly DashboardSummaryItem[];
  lastObservedAt: string | null;
  ariaBusy: boolean;
  canRetry: boolean;
}

const noContext: DashboardContext = { workspaceId: null, changeId: null };

function shellModel(
  state: DashboardState,
  values: Omit<DashboardViewModel, 'state' | 'context' | 'summary' | 'lastObservedAt'>,
): DashboardViewModel {
  return {
    state,
    context: noContext,
    summary: [],
    lastObservedAt: null,
    ...values,
  };
}

export function dashboardModelFromShell(state: DesktopShellState): DashboardViewModel {
  if (state.phase === 'starting') {
    return shellModel('starting', {
      tone: 'accent',
      eyebrow: '正在连接',
      title: '正在启动桌面观测',
      description: 'Repoctopus 正在启动隔离的 Desktop Host，并检查 OTLP Receiver 是否就绪。',
      statusLabel: '启动中',
      statusDetail: 'Desktop Host 尚未就绪',
      ariaBusy: true,
      canRetry: false,
    });
  }

  if (state.phase === 'error') {
    return shellModel('error', {
      tone: 'danger',
      eyebrow: '接收端错误',
      title: 'Desktop Host 无法启动',
      description: state.message,
      statusLabel: '需要处理',
      statusDetail: '本地 Receiver 不可用；工作流与远端遥测不受阻塞',
      ariaBusy: false,
      canRetry: true,
    });
  }

  const projection = state.snapshot.projection;
  const change = projection.change;
  if (change === null) {
    return shellModel('empty', {
      tone: 'neutral',
      eyebrow: '等待数据',
      title: '还没有可显示的 Change',
      description:
        'Desktop Host 与 Receiver 已就绪。首个 Repoctopus OTLP 上报到达后，这里会自动更新。',
      statusLabel: '已连接',
      statusDetail: 'Receiver 已就绪，尚未收到观测事实',
      ariaBusy: false,
      canRetry: false,
    });
  }

  const context: DashboardContext = {
    workspaceId: projection.workspaceId,
    changeId: change.id,
  };
  const summary: DashboardSummaryItem[] = [
    { label: 'Change 状态', value: change.status === 'unknown' ? '尚未上报' : change.status },
    { label: 'Run', value: projection.run?.id ?? '尚未上报' },
    { label: '阶段', value: projection.stage?.name ?? '尚未上报' },
    {
      label: '事件序列',
      value: projection.latestSequence === null ? '尚未上报' : String(projection.latestSequence),
      numeric: projection.latestSequence !== null,
    },
  ];
  const common = {
    context,
    summary,
    lastObservedAt: projection.lastObservedAt,
    ariaBusy: false,
    canRetry: false,
  } as const;

  if (projection.gap.detected) {
    const ranges = projection.gap.ranges
      .map((range) => (range.from === range.to ? String(range.from) : `${range.from}–${range.to}`))
      .join('、');
    return {
      state: 'gap',
      tone: 'warning',
      eyebrow: '数据不完整',
      title: change.id,
      description: `缺少事件序列 ${ranges}。界面只保留已确认事实，等待重放补齐。`,
      statusLabel: '存在缺口',
      statusDetail: `缺少序列 ${ranges}`,
      ...common,
    };
  }

  if (change.status === 'completed' || projection.run?.status === 'completed') {
    return {
      state: 'completed',
      tone: 'success',
      eyebrow: 'Run 已完成',
      title: change.id,
      description: '已收到明确的完成事实。最终验证与 Evidence 会在对应区域中呈现。',
      statusLabel: '已完成',
      statusDetail: 'Run 已进入终态',
      ...common,
    };
  }

  if (change.status === 'failed' || projection.run?.status === 'failed') {
    return {
      state: 'failed',
      tone: 'danger',
      eyebrow: 'Run 已失败',
      title: change.id,
      description: '已收到明确的失败事实。查看阻塞与最近事件以定位下一步。',
      statusLabel: '失败',
      statusDetail: 'Run 已进入失败终态',
      ...common,
    };
  }

  if (projection.freshness === 'stale') {
    return {
      state: 'stale',
      tone: 'warning',
      eyebrow: '状态已过期',
      title: change.id,
      description: '最近一次上报已超过新鲜度阈值。这里显示的是已确认事实，不代表当前仍在运行。',
      statusLabel: '已过期',
      statusDetail: '等待新的 OTLP 上报',
      ...common,
    };
  }

  if (
    change.status === 'unknown' ||
    projection.run?.status === 'unknown' ||
    projection.stage === null
  ) {
    return {
      state: 'sparse',
      tone: 'neutral',
      eyebrow: '数据尚不完整',
      title: change.id,
      description: '已收到 Change 身份，但部分运行字段还没有通过 OTLP 上报。未知值不会被推断。',
      statusLabel: '稀疏数据',
      statusDetail: '等待更多观测事实',
      ...common,
    };
  }

  return {
    state: 'live',
    tone: 'success',
    eyebrow: '实时接收',
    title: change.id,
    description: '当前状态由 Desktop Host 接收的标准 OTLP 上报驱动，不读取 Workspace 文件。',
    statusLabel: '实时',
    statusDetail: 'Receiver 正在接收上报',
    ...common,
  };
}
