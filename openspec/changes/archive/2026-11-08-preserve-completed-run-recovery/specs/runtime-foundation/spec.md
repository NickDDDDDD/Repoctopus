# Spec Delta

## MODIFIED Requirements

### Requirement: Checkpoint 支持中断后幂等恢复

Runtime MUST 使用转换 Journal 和原子替换协调 Trajectory、Run State 与 Checkpoint，并在进程于任一写入边界中断后恢复为同一最终状态或明确的人工修复状态。非终态恢复时重新探测的 Project snapshot MUST 区分内容变化与 repository identity/ownership/topology 变化：内容变化必须报告并交给依赖该内容的 phase authority 精确重验，只有身份级变化才能设置全局 `reconciliationRequired`。已完成 Run MUST 优先保持持久终态，不因当前项目与启动快照的差异重新激活开发阶段 reconciliation；Store 完整性检查与中断事务恢复仍然生效。

#### Scenario: 状态写入中途进程退出

- **WHEN** 进程在 Trajectory、Run State 或 Checkpoint 的任一写入边界退出
- **THEN** 下一次 `run resume` 根据 Journal 完成或回滚同一转换，不重复产生业务结果

#### Scenario: 外部仓库事实已经变化

- **WHEN** 非终态恢复时仓库 HEAD、分支、路径或工作树摘要与适用 Checkpoint 不同
- **THEN** Runtime 报告逐仓差异与 `content|identity` 分类，只使依赖已变化内容的决定或 Evidence 精确失效；仅 identity 级差异设置全局 reconciliation

#### Scenario: 当前 Work 产生正常内容提交

- **WHEN** 已授权 Work 写入并提交规格或实现，使 repository HEAD/worktree 相对 Run 启动快照变化，但 repository identity、remote、branch、path 与 topology 保持一致
- **THEN** `run resume` 返回 `content` drift observation 且不设置全局 reconciliation，保留原持久 continuation，由当前 planning、binding、Evidence 或 closure authority 重新验证依赖

#### Scenario: 内容由外部参与者改变

- **WHEN** 同事或 CI 在相同 repository identity、remote、branch 与 topology 上产生新的 HEAD/worktree 内容
- **THEN** Runtime 同样分类为 `content`，不得用作者或进程身份猜测所有权；受影响 phase authority 必须在接受后继状态前检测摘要变化并精确失效相关决定或 Evidence

#### Scenario: 仓库身份事实已经变化

- **WHEN** 非终态恢复时 repository add/remove、project/root identity、remote identity、branch、path、ownership 或 topology 与适用 Checkpoint 不同，或差异无法安全分类
- **THEN** Runtime 返回 `identity` reconciliation、设置全局 `reconciliationRequired` 并阻止后继 Action，直到显式恢复原绑定或开始合法的新 Run

#### Scenario: content drift 与 Open reobserve 同时存在

- **WHEN** Open Work 已持久化 `validated + reobserve`，且其规格提交使 HEAD 相对启动快照变化
- **THEN** `run resume` 保留 `reobserve` 为合法下一步；后续 `run next` 重试 Open planning gate，不要求重放 Host、恢复旧 HEAD 或创建新 Run

#### Scenario: 已完成多仓 Run 在新进程恢复

- **WHEN** 已接受 PublicationReceipt 的 Run 为 completed，当前仓库包含本次获准开发产生的 branch、HEAD 变化，新进程以任意顺序调用 `run resume` 和 `run next`
- **THEN** 两个入口保持 `done/terminal`，不因与启动快照不同新增 reconciliation、Work 或阶段转换，并保留原 Closure、PublicationReceipt、Evidence、Package Completion 和检查执行次数

#### Scenario: 完成之后出现新的外部仓库变化

- **WHEN** Run 已 completed，随后仓库 checkout 或远端 MR 发生变化，再次请求该 Run 的恢复
- **THEN** 原 Run 仍为 completed 且 continuation 为 `done/terminal`；后续交付影响由独立一致性审查处理，不重新激活原开发生命周期，也不以该终态授权任何新的外部动作

#### Scenario: 持久化终态无法验证

- **WHEN** 恢复时 Store、Checkpoint 或转换 Journal 缺失、损坏或无法恢复为可验证的 completed 事实
- **THEN** Runtime 返回明确错误或恢复诊断并保留现场，不根据目录、MR 或调用者声明推断成功，不用终态优先规则绕过完整性检查
