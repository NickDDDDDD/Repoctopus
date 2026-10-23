import type { DesktopShellState } from '../../shared/renderer-contract.js';
import type { DesktopRunContext } from '../../shared/activation-protocol.js';
import type { ChangeProjectionContext } from '../../../../domains/telemetry/change-projection.js';

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
  id: string | null;
  workspaceId: string | null;
  changeId: string | null;
}

export interface DashboardNavigationChange {
  id: string;
  changeId: string;
  status: string;
  tone: StatusTone;
  lastObservedAt: string;
}

export interface DashboardNavigationWorkspace {
  workspaceId: string;
  changes: readonly DashboardNavigationChange[];
}

export interface DashboardSummaryItem {
  label: string;
  value: string;
  numeric?: boolean;
}

export interface DashboardExecutionSubject {
  kind: string;
  id: string;
  provider: string | null;
}

export interface DashboardTaskProgress {
  total: number;
  completed: number;
  failed: number;
  unknown: number;
  active: number;
}

export interface DashboardActiveTask {
  id: string;
  label: string;
  type: string | null;
  status: 'pending' | 'blocked';
  stageName: string | null;
  subject: DashboardExecutionSubject | null;
}

export interface DashboardExecutionModel {
  stageName: string | null;
  subjects: readonly DashboardExecutionSubject[];
  taskProgress: DashboardTaskProgress | null;
  activeTasks: readonly DashboardActiveTask[];
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
  navigation: readonly DashboardNavigationWorkspace[];
  selectedContextId: string | null;
  summary: readonly DashboardSummaryItem[];
  execution: DashboardExecutionModel;
  lastObservedAt: string | null;
  ariaBusy: boolean;
  canRetry: boolean;
}

const noContext: DashboardContext = { id: null, workspaceId: null, changeId: null };
const noExecution: DashboardExecutionModel = {
  stageName: null,
  subjects: [],
  taskProgress: null,
  activeTasks: [],
};

function shellModel(
  state: DashboardState,
  values: Omit<
    DashboardViewModel,
    | 'state'
    | 'context'
    | 'navigation'
    | 'selectedContextId'
    | 'summary'
    | 'execution'
    | 'lastObservedAt'
  >,
): DashboardViewModel {
  return {
    state,
    context: noContext,
    navigation: [],
    selectedContextId: null,
    summary: [],
    execution: noExecution,
    lastObservedAt: null,
    ...values,
  };
}

export function dashboardContextId(workspaceId: string, changeId: string): string {
  return `${encodeURIComponent(workspaceId)}/${encodeURIComponent(changeId)}`;
}

export function reconcileDashboardSelection(
  current: string | null,
  contexts: readonly ChangeProjectionContext[],
  activation: DesktopRunContext | null = null,
): string | null {
  const ids = new Set(
    contexts.map((context) => dashboardContextId(context.workspaceId, context.change.id)),
  );
  if (current !== null && ids.has(current)) return current;
  if (activation?.changeId !== undefined) {
    const requested = dashboardContextId(activation.workspaceId, activation.changeId);
    if (ids.has(requested)) return requested;
  }
  const first = contexts[0];
  return first === undefined ? null : dashboardContextId(first.workspaceId, first.change.id);
}

function navigationTone(status: ChangeProjectionContext['change']['status']): StatusTone {
  if (status === 'failed') return 'danger';
  if (status === 'active') return 'success';
  return 'neutral';
}

function dashboardNavigation(
  contexts: readonly ChangeProjectionContext[],
): DashboardNavigationWorkspace[] {
  const workspaces = new Map<string, DashboardNavigationChange[]>();
  for (const context of contexts) {
    const changes = workspaces.get(context.workspaceId) ?? [];
    changes.push({
      id: dashboardContextId(context.workspaceId, context.change.id),
      changeId: context.change.id,
      status: context.change.status,
      tone: navigationTone(context.change.status),
      lastObservedAt: context.lastObservedAt,
    });
    workspaces.set(context.workspaceId, changes);
  }
  return [...workspaces].map(([workspaceId, changes]) => ({ workspaceId, changes }));
}

export function dashboardModelFromShell(
  state: DesktopShellState,
  selectedContextId: string | null = null,
  activation: DesktopRunContext | null = null,
): DashboardViewModel {
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
  if (projection.contexts.length === 0) {
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

  const selectedId = reconcileDashboardSelection(
    selectedContextId,
    projection.contexts,
    activation,
  );
  const selected = projection.contexts.find(
    (context) => dashboardContextId(context.workspaceId, context.change.id) === selectedId,
  );
  if (selected === undefined) throw new Error('Dashboard selection did not resolve');
  const change = selected.change;
  const context: DashboardContext = {
    id: selectedId,
    workspaceId: selected.workspaceId,
    changeId: change.id,
  };
  const summary: DashboardSummaryItem[] = [
    { label: 'Run', value: selected.run.id },
    {
      label: 'Run 状态',
      value: selected.run.status === 'unknown' ? '尚未上报' : selected.run.status,
    },
    { label: 'Workflow', value: selected.workflow?.name ?? '尚未上报' },
    {
      label: '事件序列',
      value: String(selected.latestSequence),
      numeric: true,
    },
  ];
  const execution: DashboardExecutionModel = {
    stageName: selected.stage?.name ?? null,
    subjects: selected.executionSubjects,
    taskProgress:
      selected.tasks === null
        ? null
        : {
            total: selected.tasks.total,
            completed: selected.tasks.completed,
            failed: selected.tasks.failed,
            unknown: selected.tasks.unknown,
            active: selected.tasks.active.length,
          },
    activeTasks: (selected.tasks?.active ?? []).map((task) => ({
      id: task.id,
      label: task.ref ?? task.id,
      type: task.type,
      status: task.status === 'blocked' ? 'blocked' : 'pending',
      stageName: task.stageName,
      subject: task.subject,
    })),
  };
  const common = {
    context,
    navigation: dashboardNavigation(projection.contexts),
    selectedContextId: selectedId,
    summary,
    execution,
    lastObservedAt: selected.lastObservedAt,
    ariaBusy: false,
    canRetry: false,
  } as const;

  if (selected.gap.detected) {
    const ranges = selected.gap.ranges
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

  if (change.status === 'completed' || selected.run.status === 'completed') {
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

  if (change.status === 'failed' || selected.run.status === 'failed') {
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

  if (selected.freshness === 'stale') {
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

  if (change.status === 'unknown' || selected.run.status === 'unknown' || selected.stage === null) {
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
