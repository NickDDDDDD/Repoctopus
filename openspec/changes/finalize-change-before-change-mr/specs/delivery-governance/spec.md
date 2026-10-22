# Spec Delta

## ADDED Requirements

### Requirement: Delivery 以公开 Change 分支承载规划和收尾

Repoctopus MUST 在实施前登记 Workspace Repository 中已发布的 Change 分支、目标分支、远端和精确远端 OID，并把该分支作为规划产物、规格关闭结果和远端并发控制的唯一载体；此阶段不得要求或创建 Change MR。

#### Scenario: 规划分支已公开但尚无 Change MR

- **WHEN** 四类规划产物通过 Provider 校验且 Change 分支已普通 push 并核对远端 OID
- **THEN** Delivery 可以进入规划批准与实施阶段，且远端动作计划不包含 Change MR 创建

#### Scenario: Change 分支尚未公开

- **WHEN** Change 只有本地分支或远端 OID 无法核对
- **THEN** Runtime 阻断规划批准和业务交付准备，并返回需要发布 Change 分支的诊断

#### Scenario: Change 分支远端发生漂移

- **WHEN** 实施或收尾前读取到的远端 Change 分支 OID 不等于已批准或已锁定的 OID
- **THEN** Runtime 使相关批准或发布计划失效，不执行隐式 rebase、force push 或覆盖

### Requirement: Business MR 默认一个并允许显式完整集合

Repoctopus MUST 默认把一个 Change 规划为一个 Business MR；需要多个时，Delivery MUST 记录非空拆分理由和有限、完整的 Business MR 集合，并把集合身份、仓库、源分支、目标分支与远端动作绑定到批准快照。

#### Scenario: 单仓 Change 使用默认交付

- **WHEN** Change 没有声明多仓或分阶段拆分理由
- **THEN** Runtime 生成只包含一个 Business MR 的交付计划

#### Scenario: Change 显式使用多个 Business MR

- **WHEN** Change 因多仓、独立可验证的有序交付或必要补充修复声明多个 Business MR，并给出拆分理由和完整集合
- **THEN** Runtime 接受该集合并分别跟踪每个 MR，不把任务列表自动拆成多个 MR

#### Scenario: 多 MR 计划缺少拆分理由

- **WHEN** Delivery 声明多个 Business MR 但没有非空拆分理由
- **THEN** Runtime 拒绝准备批准快照并要求确认是否缩减为默认单 MR

#### Scenario: 批准后追加 Business MR

- **WHEN** 已批准交付快照的 Business MR 集合新增、删除或替换成员
- **THEN** Runtime 使旧批准失效并要求对新的完整集合重新验证和批准

### Requirement: 最终 Change MR 只在规格关闭后创建

Repoctopus MUST 只在全部 Business MR 合入、合入后 Evidence Gate 满足、主规格同步且 Change 已归档后，通过平台端口创建或幂等恢复一个最终 Change MR；该 MR 只承载允许的规格、验证和关闭结果，Runtime 不得自动合入。

#### Scenario: Change 仍在实施

- **WHEN** 任一 Business MR 未登记、未合入或合入后验证尚未满足
- **THEN** Runtime 不创建最终 Change MR

#### Scenario: Change 已完成规格关闭

- **WHEN** Post-merge Run 已核对全部 Business MR 的 merge commit 并取得有效规格关闭结果
- **THEN** Runtime 从登记的 Change 分支和目标分支创建最终 Change MR，并记录平台返回的稳定身份

#### Scenario: 最终 MR 创建响应丢失

- **WHEN** 平台已经创建最终 Change MR 但 Runtime 没有持久化成功响应
- **THEN** Adapter 按仓库、源分支和目标分支查询并复用唯一匹配 MR，不创建重复 MR

#### Scenario: 最终 MR 差异包含业务代码

- **WHEN** 最终 Change MR 相对目标分支包含允许规格、验证和关闭路径之外的修改
- **THEN** Delivery Guardrail 拒绝发布并保留可定位的越权路径诊断

### Requirement: Change 协作不由动作身份独占

Repoctopus MUST 把 change 视为团队共享工作单元，允许不同成员或 Agent 继续实现、修复、验证与收尾；系统不得从 Change 分支作者、Business MR 作者、最终 Change MR 作者、Git 作者、Bot 身份或 Runner 身份推导独占 Change owner。动作身份只用于授权、审计和诊断。

#### Scenario: 成员代为发布 Change 分支

- **WHEN** 一个成员提交规划产物并发布 Change 分支，但业务特性由其他成员实现
- **THEN** 系统仍按 change 与交付角色建立关系，不把分支发布者视为特性所有者或个人补偿筛选条件

#### Scenario: 其他成员修复已有 Change

- **WHEN** 另一成员在已经登记的 change 中修复 Bug、补测试或更新规格
- **THEN** Repoctopus 接受该成员产生的受审计动作，不因 change 最初由其他人创建而拒绝

#### Scenario: 配置尝试按动作身份独占 Change

- **WHEN** 团队配置声明 `changeOwner`、`mrAuthor`、`branchAuthor`、`runnerOwner` 或等价候选过滤字段
- **THEN** 配置校验拒绝未知所有权字段，不把动作身份升级为 Change 发现或执行权限

#### Scenario: 团队替换 Runner identity

- **WHEN** 团队替换部署中的 Runner identity，且新 Runner 读取同一持久 Delivery 与平台权威事实
- **THEN** Repoctopus 允许新 Runner 继续查询和恢复，不因执行身份变化转移或丢失 Change 所有权

### Requirement: 旧 Delivery 只能生成显式只读迁移计划

Repoctopus MUST 允许查询 v2 Delivery 状态和权威旧 Change MR 事实，但 MUST NOT 复用旧批准、Evidence Bundle 或平台副作用直接写成 v3 状态；Built-in Provider 必须拒绝 v2 的决定、刷新、协调、发布和 Post-merge 写操作。

#### Scenario: 尚未尝试远端交付动作

- **WHEN** v2 Delivery 仍处于发布前状态且全部动作尝试次数为零
- **THEN** Runtime 返回 `reprepare_required` 计划，列出 v3 草案缺失字段和新的规划、验证与交付批准，不修改 Delivery Store 或平台 MR

#### Scenario: 旧 Change MR 仍开放

- **WHEN** v2 Delivery 已产生远端交付事实且权威查询确认旧 Change MR 仍开放
- **THEN** Runtime 返回 `manual_decision_required`，要求人决定保留旧流程还是人工关闭后迁移，不自动关闭、更新或替换该 MR

#### Scenario: 旧 Change MR 已关闭、已合入或映射漂移

- **WHEN** 权威查询发现旧 Change MR 已关闭、已合入、head 无法核对或源目标分支不匹配
- **THEN** Runtime 返回 `repair_required`，保留旧 Change 分支、Business MR identity 和目标 OID 供人工修复，不生成可直接执行的 v3 Intent

## REMOVED Requirements

### Requirement: Delivery 声明 Change MR 与业务 MR 关系

**Reason**: Change MR 不再是实施期间的协调或并发边界；提前创建 MR 与“MR 表示完整可合入交付”的产品语义冲突。

**Migration**: 将活动 Delivery 中的 Change MR 源分支、目标分支和已核对 head OID 迁移为 Change 分支事实；尚未合入的旧 Change MR 进入人工迁移，不得由 Runtime 自动关闭或复用为最终 MR。

### Requirement: Change 协作不由 MR 作者独占

**Reason**: Change 在实施阶段不再存在 Change MR，协作所有权需要覆盖 Change 分支、Business MR 和最终 Change MR 的不同动作身份。

**Migration**: 保留团队共享 Change 语义，把旧的 Change MR 作者审计字段映射为历史动作身份；不得由此推导 Change owner。
