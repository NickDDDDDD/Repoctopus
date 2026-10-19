# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Evidence Gate 只能通过唯一 Runtime 推进工作流`
- TO: `### Requirement: Evidence Gate 只能由 WorkflowRuns 在事务内接受`

## MODIFIED Requirements

### Requirement: Evidence Gate 只能由 WorkflowRuns 在事务内接受

Repoctopus MUST 由 EvidenceCoordinator 把当前 Bundle 投影为绑定 Workflow Run、Action、Step、状态版本、Evidence Profile、composition digest 和输入指纹的 Gate，并由 WorkflowRuns 在持有 RunStore 转换锁时重新验证；Evidence Provider、CLI 或 Adapter 不得维护独立工作流状态权威，也不得用普通成功文本替代 Gate。

#### Scenario: Verify 步骤收到普通成功结果

- **WHEN** 当前步骤要求 `verify` Profile 且记录请求没有绑定有效 Gate
- **THEN** WorkflowRuns 拒绝推进并返回缺少或失效 Evidence 的诊断

#### Scenario: 当前输入具有有效 Bundle

- **WHEN** Gate 的 Run、Action、Step、状态版本、Profile、composition、Bundle 和输入指纹与锁内重新读取的当前事实一致且状态为 `satisfied`
- **THEN** WorkflowRuns 把 Bundle 接受事实、下一 Run State、Trajectory 和 Checkpoint 写入同一可恢复事务

#### Scenario: Gate 校验后出现竞争转换

- **WHEN** 另一个执行者尝试在当前 Gate 校验与状态提交之间推进同一 Run
- **THEN** RunStore 转换锁串行化两个写入，后一个执行者基于新的状态版本重新校验证据

#### Scenario: Evidence Provider 尝试直接推进

- **WHEN** Evidence Provider 完成 Bundle 并请求改变工作流状态
- **THEN** Provider 只能公开 Gate Projection，不能直接写入 Run State、Trajectory 或 Checkpoint

## ADDED Requirements

### Requirement: Evidence 保持独立持久化生命周期

EvidenceCoordinator MUST 独立持久化 Attempt、Node Journal、Receipt、Artifact、Bundle 和 Gate Projection，并通过恢复规则完成未结束采集；这些事实不得与 Cordis Fiber 内存或 Run State 合并为一个存储模型。

#### Scenario: 采集进程在节点执行后退出

- **WHEN** Node Journal 已记录执行且 Receipt 尚未完整提交时进程退出
- **THEN** 新进程从 Evidence Journal 恢复或明确重试该节点，不以 Run 状态推断命令已经成功

#### Scenario: Evidence 插件卸载

- **WHEN** Evidence Contributor 被重新加载或关闭
- **THEN** 临时进程和监听器被 Effect 清理，已持久化的 Receipt 与 Artifact 保持可审计

### Requirement: Evidence 类型由 Contributor 提供稳定能力

命令、服务、浏览器、视觉和后续 Evidence 类型 MUST 通过版本化 Contributor 登记配置 Schema、执行端口、Receipt 类型、资源需求和清理逻辑；EvidenceCoordinator 只允许计划引用当前 composition 实际提供的能力。

#### Scenario: Profile 引用未安装的 Evidence 类型

- **WHEN** Evidence Profile 声明一个没有活动 Contributor 的节点类型
- **THEN** 计划在执行任何节点前失败并报告缺失的能力标识

#### Scenario: Contributor 在运行期间卸载

- **WHEN** 一个 Evidence Attempt 已接纳操作后对应 Contributor 开始卸载
- **THEN** 新节点不再分派给该 Contributor，进行中节点取消或完成到可恢复 Journal 边界

### Requirement: Evidence Attempt 绑定采集实现身份

每个 Evidence Attempt 和 Receipt MUST 记录实际采集 Contributor 的稳定标识、版本、配置摘要与代码摘要；采集实现变化后不得把旧 Receipt 当作同一实现产生的当前事实。

#### Scenario: 命令采集器版本变化

- **WHEN** 输入源码未变化但 Command Evidence Contributor 代码摘要发生变化
- **THEN** 新 Attempt 不复用旧 Receipt，并在 composition 差异中说明采集实现已变化
