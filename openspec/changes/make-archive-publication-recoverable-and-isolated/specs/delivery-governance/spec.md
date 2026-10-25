# delivery-governance Delta

## ADDED Requirements

### Requirement: 规格发布与调用者工作树隔离

Repoctopus MUST 只在 Closure Receipt 指定的隔离 candidate checkout 中为最终规格项创建 commit，并使用独立 archive source branch 发布；同一物理仓中的 Business Delivery MUST 继续从已验证实现 branch/OID 和完全 clean 的对应 worktree 发布，不得把 Closure changedFiles 作为调用者工作树的临时脏路径例外。

#### Scenario: Workspace 仓同时承载业务实现与规格

- **WHEN** Business Delivery 与 Specification publication 使用同一 repositoryId 和物理 Git 仓
- **THEN** 业务项从验证过的 source branch/OID 发布，规格项从 detached candidate commit 发布，两者不会改变对方的 branch、HEAD 或 index

#### Scenario: 调用者工作树已有额外修改

- **WHEN** Business source worktree 在 Archive 时包含任何 staged、unstaged 或 untracked 修改
- **THEN** Business Delivery 仍因不 clean 而阻断，不因路径与 Closure Receipt 重合而放行

### Requirement: 规格发布使用可恢复完成 Journal

Repoctopus MUST 在创建规格 commit 前持久化稳定 Publication intent，并以 canonical CAS Journal 单调记录 `prepared`、`committed`、`pushed` 和 `completed`；每次重试 MUST 先观察 candidate commit、remote branch OID 和精确 MR identity，等价则采纳、缺失才执行、漂移或歧义则 fail-closed。

#### Scenario: commit 成功后进程中断

- **WHEN** candidate checkout 已产生精确 archive commit，但 Journal 仍为 prepared
- **THEN** 重试核对单一 parent、changedFiles 和 commit message 后采纳该 OID，不创建第二个 commit

#### Scenario: push 响应丢失

- **WHEN** archive remote branch 已指向 Journal commit，但本地尚未记录 pushed
- **THEN** 重试通过 `ls-remote` 采纳相同 OID，不重复或 force push

#### Scenario: MR 创建响应丢失

- **WHEN** 平台已有唯一 repository/head/base/head OID 完全匹配的 MR，但 Journal 尚未 completed
- **THEN** 重试采纳该 MR 并记录 recovered provenance；零个才创建，多个或任一身份漂移均阻断

#### Scenario: completed Journal 重放

- **WHEN** checkout 已清理但 Journal、remote branch 和 MR 仍精确匹配
- **THEN** 重试返回 Journal 保存的同一 Publication item，不生成新 commit、分支、MR 或不稳定 Receipt 字段

## MODIFIED Requirements

### Requirement: 多仓发布计划可恢复且幂等

Repoctopus MUST 为 Business Delivery 与最终 Specification publication 分别保存其职责范围内的稳定意图和结果，按稳定顺序执行普通 push 和 MR create-or-recover/create-or-adopt，并由最终 Publication Receipt 组合所有项；跨仓步骤部分完成后不得自动回滚已发布远端事实，对同一 Run 的显式重试 MUST 先查询远端并从第一个未确认项继续。规格候选 checkout 只能在其发布 Journal completed 后清理；计划完成不要求任一 MR 合入。

#### Scenario: 中途发布失败

- **WHEN** 一个仓库的远端动作失败且此前仓库已有动作成功
- **THEN** Runtime 保存部分 Publication Intent/Receipt、停止后续动作并明确说明不存在跨仓事务回滚

#### Scenario: 从失败点继续

- **WHEN** 失败原因解决后恢复同一交付计划
- **THEN** Runtime 核对已完成动作并从第一个未确认发布项继续

#### Scenario: 规格关闭与业务发布使用同一工作树

- **WHEN** Workspace 仓同时承载业务 source branch 与已验证的隔离 Specification Closure candidate
- **THEN** Delivery 要求业务 worktree 完全 clean，并只从隔离 checkout 发布规格项；不得把 Closure changedFiles 排除在业务清洁范围之外

#### Scenario: MR 创建响应丢失

- **WHEN** 托管平台已经创建 MR 但 Runtime 未持久化成功响应
- **THEN** Adapter 以仓库、源分支、目标分支和精确 head OID 查询并复用唯一 MR identity

#### Scenario: 业务 MR 已发布但规格 push 失败

- **WHEN** 一个或多个 Business Delivery 已有精确 Receipt，而 Specification publication 尚未完成
- **THEN** Run 保持 Archive 可重试；重试复用业务 Receipt 并从规格 Journal 继续，不重复创建业务 MR
