import { useState } from 'react';

import type { ProjectedChange } from '../../../../domains/trajectory/projection.js';

export const PHASE_NAMES = {
  open: '需求确认',
  design: '设计',
  build: '实现',
  verify: '验证',
  archive: '归档',
} as const;

const ACTIVE_WORK = {
  configure: '确定执行配置',
  plan: '制定工作包计划',
  'plan-evidence': '核对计划证据',
  execute: '执行工作包',
  check: '检查实现结果',
} as const;

const BLOCKED_REASONS: ReadonlyMap<string, string> = new Map([
  ['planning-invalid', '请回到 Agent 查看未通过校验的规格或计划。'],
  ['verification-input-pending', '请回到 Agent 补齐此 Run 的验证配置或输入。'],
  ['retry-exhausted', '请回到 Agent 查看失败检查和恢复选项。'],
  ['publication-incomplete', '请回到 Agent 核对原发布结果并按提示继续。'],
  ['reconciliation-required', '请回到 Agent 核对当前工作环境和上一次操作的结果。'],
  ['migration-required', '请回到 Agent 核对当前版本是否能恢复此 Run。'],
]);

function approvalGuidance(change: ProjectedChange) {
  const { lifecycle } = change;
  if (lifecycle?.status !== 'waiting' || !lifecycle.decisionId) return null;
  if (
    change.decisions.some(
      (item) => item.decisionId === lifecycle.decisionId && item.state !== 'waiting',
    )
  )
    return null;
  const title =
    lifecycle.phase === 'design'
      ? '请审核设计方案'
      : lifecycle.phase === 'open'
        ? '请审核需求范围'
        : lifecycle.phase === 'build' && lifecycle.reason === 'build-plan'
          ? '请审核执行计划'
          : '需要人工决定';
  const description =
    lifecycle.phase === 'design'
      ? '在当前 Agent 会话审阅方案和推荐执行策略。批准后进入实现。'
      : lifecycle.phase === 'open'
        ? '在当前 Agent 会话审阅需求、验收标准和变更范围。批准后进入设计。'
        : '在当前 Agent 会话查看当前请求、相关材料和可选操作。';
  return { title, description, decisionId: lifecycle.decisionId };
}

export function workflowGuidance(change: ProjectedChange): {
  title: string;
  description: string;
  decisionId?: string;
} {
  const { lifecycle, displayState, phase } = change;
  const stage = phase ? PHASE_NAMES[phase] : null;
  switch (displayState) {
    case 'catching-up':
    case 'gap':
    case 'stale':
    case 'error':
      return {
        title: displayState === 'catching-up' ? '正在同步工作状态' : '当前状态暂未确认',
        description: stage
          ? `上次观测到${stage}阶段。需要继续时，请先在 Agent 会话读取当前 Run 状态。`
          : '请等本地接收恢复，或在 Agent 会话查看当前 Run。',
      };
    case 'complete':
      return {
        title: '归档完成',
        description: 'Runtime 已确认此 Run 完成。可展开详情查看交付与验证记录。',
      };
    case 'failed':
      return {
        title: '工作流失败',
        description: '请回到 Agent 会话查看失败原因与可用的恢复方式。',
      };
    case 'blocked':
      return {
        title: stage ? `${stage}受阻` : '工作流受阻',
        description:
          BLOCKED_REASONS.get(
            change.workspaceReconciliationRequired
              ? 'reconciliation-required'
              : (lifecycle?.reason ?? ''),
          ) ?? '请回到 Agent 查看当前阻塞原因及可用的恢复选项。',
      };
    case 'stalled':
      return {
        title: '暂未收到执行进展',
        description: '请在当前 Agent 会话核对 Work 是否仍在运行。',
      };
    case 'rework': {
      const last = change.recoveries.findLast((item) => item.kind === 'fallback');
      return {
        title:
          last?.fromPhase && stage
            ? `已从${PHASE_NAMES[last.fromPhase]}返回${stage}`
            : '工作流已进入返工',
        description: '请查看详情中的回退记录，并在当前 Agent 会话跟进后续工作。',
      };
    }
    case 'waiting':
      return (
        approvalGuidance(change) ?? {
          title:
            lifecycle?.reason === 'external-fact' && phase === 'archive'
              ? '等待发布结果确认'
              : '工作流正在等待',
          description: '请在 Agent 会话查看当前等待条件和恢复指引。',
        }
      );
    default:
      if (!stage || !lifecycle)
        return {
          title: '等待工作流状态',
          description: '运行 Change 后，当前阶段和下一步会在这里出现。',
        };
      if (phase === 'build' && change.buildAction) {
        const work = ACTIVE_WORK[change.buildAction];
        const current = change.currentWork;
        const description =
          current?.state === 'pending'
            ? `等待 Agent 领取工作，以${work}。`
            : current?.state === 'running' && current.hostId
              ? `Agent 正在${work}。`
              : current?.state === 'completed'
                ? '当前工作已完成，等待 Runtime 推进。'
                : current?.state === 'failed'
                  ? '请在 Agent 会话查看当前工作的失败原因。'
                  : `当前步骤为${work}，请在 Agent 会话查看执行状态。`;
        return { title: '实现进行中', description };
      }
      return {
        title: `${stage}进行中`,
        description:
          change.currentWork?.state === 'running' && change.currentWork.hostId
            ? 'Agent 正在处理当前工作。'
            : '可在 Agent 会话查看当前工作。这里会随 Run 更新。',
      };
  }
}

function ApprovalHandoff({ runId, decisionId }: { runId: string; decisionId: string }) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');
  const prompt = `请读取 Repoctopus Run ${JSON.stringify(runId)} 的当前审批请求。桌面上报的请求为 ${JSON.stringify(decisionId)}。请先核对它仍是待处理请求，再展示材料并等待我的选择。`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setResult('copied');
    } catch {
      setResult('failed');
    }
  };
  return (
    <div className="approval-handoff">
      <button type="button" className="primary-action" onClick={() => void copy()}>
        复制给 Agent
      </button>
      {result === 'copied' ? <span role="status">已复制，回到当前 Agent 会话粘贴</span> : null}
      {result === 'failed' ? (
        <label role="status">
          自动复制失败，请手动复制
          <textarea readOnly rows={3} value={prompt} />
        </label>
      ) : null}
    </div>
  );
}

export function NextStep({ change }: { change: ProjectedChange }) {
  const guidance = workflowGuidance(change);
  const strategy = change.phase === 'build' ? change.buildStrategy : null;
  const progress = change.phase === 'build' ? change.buildProgress : null;
  const progressLabel = ['gap', 'stale', 'catching-up', 'error'].includes(change.displayState)
    ? '上次确认的工作包进度'
    : '工作包已完成';
  const isolation = { current: '当前分支', branch: '分支隔离', worktree: 'Worktree 隔离' } as const;
  return (
    <section
      className="next-step"
      data-state={change.displayState}
      aria-labelledby="next-step-heading"
    >
      <p className="next-step__label">现在要做什么</p>
      <div aria-live="polite">
        <h2 id="next-step-heading">{guidance.title}</h2>
        <p>{guidance.description}</p>
      </div>
      {guidance.decisionId ? (
        <ApprovalHandoff
          key={guidance.decisionId}
          runId={change.runId}
          decisionId={guidance.decisionId}
        />
      ) : null}
      {strategy ? (
        <p className="next-step__strategy">
          {strategy.executionMode === 'autonomous' ? '自主执行' : '多 Agent 协作'}
          {' · '}
          {strategy.tddMode === 'tdd' ? 'TDD' : '直接验证'}
          {' · '}
          {isolation[strategy.isolation]}
        </p>
      ) : null}
      {progress ? (
        <label className="next-step__progress">
          <span>
            {progressLabel} {progress.completed}/{progress.total}
          </span>
          <progress max={progress.total} value={progress.completed} aria-label="工作包完成进度" />
        </label>
      ) : null}
    </section>
  );
}
