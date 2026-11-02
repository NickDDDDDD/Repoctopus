# Spec Delta

## MODIFIED Requirements

### Requirement: Checkpoint 支持中断后幂等恢复

Runtime MUST 使用转换 Journal 和原子替换协调 Trajectory、Run State 与 Checkpoint，并在进程于任一写入边界中断后恢复为同一最终状态或明确的人工修复状态。恢复时重新探测的 Project snapshot MUST 区分内容变化与 repository identity/ownership/topology 变化：内容变化必须报告并交给依赖该内容的 phase authority 精确重验，只有身份级变化才能设置全局 `reconciliationRequired`。

#### Scenario: 状态写入中途进程退出

- **WHEN** 进程在 Trajectory、Run State 或 Checkpoint 的任一写入边界退出
- **THEN** 下一次 `run resume` 根据 Journal 完成或回滚同一转换，不重复产生业务结果

#### Scenario: 外部仓库事实已经变化

- **WHEN** 恢复时仓库 HEAD、分支、路径或工作树摘要与 Checkpoint 不同
- **THEN** Runtime 报告逐仓差异与 `content|identity` 分类，只使依赖已变化内容的决定或 Evidence精确失效；仅 identity级差异设置全局 reconciliation

#### Scenario: 当前 Work 产生正常内容提交

- **WHEN** 已授权 Work 写入并提交规格或实现，使 repository HEAD/worktree 相对 Run 启动快照变化，但 repository identity、remote、branch、path 与 topology 保持一致
- **THEN** `run resume` 返回 `content` drift observation且不设置全局 reconciliation，保留原持久 continuation，由当前 planning、binding、Evidence 或 closure authority重新验证依赖

#### Scenario: 内容由外部参与者改变

- **WHEN** 同事或 CI 在相同 repository identity、remote、branch 与 topology 上产生新的 HEAD/worktree 内容
- **THEN** Runtime 同样分类为 `content`，不得用作者或进程身份猜测所有权；受影响 phase authority必须在接受后继状态前检测摘要变化并精确失效相关决定或 Evidence

#### Scenario: 仓库身份事实已经变化

- **WHEN** 恢复时 repository add/remove、project/root identity、remote identity、branch、path、ownership 或 topology 与 Checkpoint 不同，或差异无法安全分类
- **THEN** Runtime 返回 `identity` reconciliation、设置全局 `reconciliationRequired` 并阻止后继 Action，直到显式恢复原绑定或开始合法的新 Run

#### Scenario: content drift 与 Open reobserve 同时存在

- **WHEN** Open Work 已持久化 `validated + reobserve`，且其规格提交使 HEAD 相对启动快照变化
- **THEN** `run resume` 保留 `reobserve` 为合法下一步；后续 `run next` 重试 Open planning gate，不要求重放 Host、恢复旧 HEAD或创建新 Run

