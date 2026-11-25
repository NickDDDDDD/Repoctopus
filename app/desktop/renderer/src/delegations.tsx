import { useId, useState } from 'react';

import type { ProjectedDelegation } from '../../../../domains/trajectory/projection.js';

const agentRoles = { implementer: '实施 Agent', reviewer: '审查 Agent' } as const;
const agentStages = {
  started: '已派发',
  verifying: '正在验证',
  returned: '已返回结果',
} as const;
const agentResults = {
  succeeded: '完成回执已记录',
  failed: '回执报告失败',
  unknown: '结果待确认',
} as const;

function AgentAvatar({ agent, index }: { agent: ProjectedDelegation; index: number }) {
  return (
    <span
      className="agent-avatar"
      data-color={index % 3}
      data-role={agent.role}
      aria-hidden="true"
    />
  );
}

function AgentFacts({ agent }: { agent: ProjectedDelegation }) {
  return (
    <div className="agent-facts">
      <strong>
        {agentRoles[agent.role]} · {agent.executionId}
      </strong>
      <span>{agent.repositoryId ?? '仓库尚未上报'}</span>
      <span>{agent.taskId ? `任务 ${agent.taskId}` : '任务尚未上报'}</span>
      <span className="agent-milestone">
        {agent.result ? agentResults[agent.result] : agentStages[agent.stage]}
      </span>
    </div>
  );
}

function AgentPreview({ agent, index }: { agent: ProjectedDelegation; index: number }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return (
    <li className="agent-preview" data-pinned={pinned} data-dismissed={dismissed}>
      <button
        type="button"
        className="agent-preview__button"
        aria-label={`查看${agentRoles[agent.role]} ${agent.executionId}`}
        aria-describedby={id}
        onClick={() => {
          setPinned(!pinned);
          setDismissed(pinned);
        }}
        onBlur={() => {
          setPinned(false);
          setDismissed(false);
        }}
        onPointerLeave={() => setDismissed(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          setPinned(false);
          setDismissed(true);
        }}
      >
        <AgentAvatar agent={agent} index={index} />
      </button>
      <div className="agent-preview__popover" id={id} role="tooltip">
        <AgentFacts agent={agent} />
      </div>
    </li>
  );
}

export function AgentStrip({ agents }: { agents: ProjectedDelegation[] }) {
  if (agents.length === 0) return null;
  return (
    <div className="agent-strip">
      <p>{agents.length} 位子 Agent</p>
      <ul aria-label="正在工作的子 Agent">
        {agents.map((agent, index) => (
          <AgentPreview key={agent.executionId} agent={agent} index={index} />
        ))}
      </ul>
    </div>
  );
}

export function AgentList({
  agents,
  history = false,
}: {
  agents: ProjectedDelegation[];
  history?: boolean;
}) {
  const headingId = useId();
  return (
    <section className="agent-list" aria-labelledby={headingId}>
      <h2 id={headingId}>
        {history
          ? '子 Agent 活动记录'
          : agents.length > 0
            ? `子 Agent · ${agents.length} 位在工作`
            : '子 Agent'}
      </h2>
      {agents.length === 0 ? (
        <p className="empty-copy">暂无可确认的子 Agent 活动。</p>
      ) : (
        <ul className="agent-list__grid">
          {agents.map((agent, index) => (
            <li className="focus-agent" key={`${agent.invocationId}:${agent.executionId}`}>
              <AgentAvatar agent={agent} index={index} />
              <div>
                <AgentFacts agent={agent} />
                {history ? (
                  <time dateTime={agent.observedAt}>
                    {new Date(agent.observedAt).toLocaleString('zh-CN')}
                  </time>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
