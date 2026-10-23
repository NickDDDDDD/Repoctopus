# delivery-governance Specification

## ADDED Requirements

### Requirement: Delivery 作为 Archive 执行能力而非生命周期权威

Repoctopus MUST 把 Delivery plan、Git/MR Intent、Receipt、平台事实和并发栅栏作为 Change Run Archive Work 的输入与执行结果；Delivery 不得拥有与 Change Run 平行的 phase、实施准入、规划批准、验证完成或规格关闭状态。策略要求的危险远端动作批准只能授权对应 Action，不能替代 Design approval 或 Verify Gate。

#### Scenario: Delivery 已准备但 Design 未批准

- **WHEN** 调用方准备了仓库和 MR 草案但 Change Run 仍处于未批准 Design
- **THEN** Runtime 可以返回只读计划诊断，但不得发布分支、创建 Business MR 或把 Delivery 状态解释为实施准入

#### Scenario: 远端发布动作需要人工确认

- **WHEN** 项目策略要求用户确认一个已验证 Archive 发布计划
- **THEN** Human Decision 只绑定该 Action 的输入和副作用，确认后仍由同一 Archive Work 推进，不建立独立 Delivery lifecycle

## MODIFIED Requirements

### Requirement: Delivery 以公开 Change 分支承载规划和收尾

Repoctopus MUST 在 Design approval 前登记 Workspace Repository 中已发布的 Change 分支、目标分支、远端和精确远端 OID，并把该分支作为规划产物、规格关闭结果和远端并发控制的载体；此阶段不得要求或创建 Change MR。Change 分支 OID 是 publication provenance 和远端并发栅栏，不得替代 Specification Provider 的规划语义摘要。

#### Scenario: 规划分支已公开但尚无 Change MR

- **WHEN** 四类规划产物通过 Provider 校验且 Change 分支已普通 push 并核对远端 OID
- **THEN** Change Run 可以请求 Design approval，且远端动作计划不包含 Change MR 创建

#### Scenario: Change 分支尚未公开

- **WHEN** Change 只有本地分支或远端 OID 无法核对
- **THEN** Runtime 阻断 Design approval 和后续 Archive 发布，并返回需要发布 Change 分支的诊断

#### Scenario: Change 分支远端发生漂移

- **WHEN** Archive Action 读取到的远端 Change 分支 OID 不等于该 Action 锁定的发布输入
- **THEN** Runtime 使相关 Action authorization 或发布计划失效，不执行隐式 rebase、force push 或覆盖；Design approval 仅在规划语义同时变化时失效

### Requirement: 最终 Change MR 只在规格关闭后创建

Repoctopus MUST 只在同一 Change Run 的 Archive 阶段确认全部 Business MR 合入、精确 merge commit Evidence Gate 满足、主规格同步且 Change 已归档后，通过平台端口创建或幂等恢复一个最终 Change MR；该 MR 只承载允许的规格、验证和关闭结果，Runtime 不得自动合入。

#### Scenario: Change 仍在实施

- **WHEN** 任一 Business MR 未登记、未合入或合入后验证尚未满足
- **THEN** Runtime 保持当前 Build、Verify 或 Archive 状态且不创建最终 Change MR

#### Scenario: Change 已完成规格关闭

- **WHEN** Archive Work 已核对全部 Business MR 的 merge commit 并取得有效规格关闭结果
- **THEN** Runtime 从登记的 Change 分支和目标分支创建最终 Change MR，把 Receipt 写入同一 Change Run

#### Scenario: 最终 MR 创建响应丢失

- **WHEN** 平台已经创建最终 Change MR但 Runtime 没有持久化成功响应
- **THEN** Adapter 按仓库、源分支和目标分支查询并复用唯一匹配 MR，不创建重复 MR

#### Scenario: 最终 MR 差异包含业务代码

- **WHEN** 最终 Change MR 相对目标分支包含允许规格、验证和关闭路径之外的修改
- **THEN** Archive Guardrail 拒绝发布并保留可定位的越权路径诊断
