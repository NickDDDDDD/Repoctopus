# Spec Delta

## ADDED Requirements

### Requirement: Archive 终态绑定最终 Change MR 合入证明

Change Run MUST 只在最终 Change MR 的平台权威状态证明其冻结 head 已合入登记目标分支，并且 merge commit、关闭摘要和审计摘要与当前 Archive input 一致后进入 `completed`；创建、更新或发现开放的最终 Change MR 只能使 Run 保持 `phase=archive` 和 `status=waiting`。

#### Scenario: 最终 Change MR 已创建但尚未合入

- **WHEN** Runtime 已发布关闭提交并恢复唯一最终 Change MR，但平台报告 MR 仍然开放
- **THEN** Run 保持 `archive/waiting`，记录稳定等待条件且不生成终态完成事实

#### Scenario: 最终 Change MR 精确版本已合入

- **WHEN** 平台报告最终 Change MR 已合入，且 head、目标分支、merge commit、关闭摘要和审计摘要均匹配冻结 Archive input
- **THEN** Runtime 追加终态 Receipt 并把同一 Change Run 转换为 `completed`

### Requirement: Tracked Task 只表达 Build 阶段可完成工作

Repoctopus MUST 只把无需未来 Verify、Archive、MR 合入或终态事实即可证明完成的官方 Tasks checkbox 映射为 Build Work；跨阶段步骤必须由 lifecycle definition 的固定 Work、Validator、等待条件或退出条件表达，不得要求 Agent 提前勾选未来事实。

#### Scenario: Tasks 包含归档后才能完成的 checkbox

- **WHEN** 规划清单把最终 MR 合入、规格归档或 Archive 清理写成 tracked checkbox
- **THEN** Design 校验阻断批准并要求把该步骤改为 lifecycle Work 或非跟踪的 Workflow follow-up

#### Scenario: Build 任务包含可立即执行的验证

- **WHEN** checkbox 的实现和验收命令都能在 Build 阶段当前输入上完成
- **THEN** Runtime 将其映射为 Build Work，并由对应 Validator 决定是否完成任务

### Requirement: Attempt 与执行身份由 Runtime 稳定管理

Runtime MUST 为每个 Work 的新执行单调分配 attempt，并用项目配置或主机登记的稳定 Runner identity 绑定 claim；进程 PID、CLI invocation 和用户提供的 attempt 编号只能作为租约或诊断信息，不得参与幂等身份或要求用户手动递增。

#### Scenario: 新进程恢复失败 Work

- **WHEN** 原进程退出后同一 Runner identity 或另一受信 Runner 恢复未完成 Work
- **THEN** Runtime 根据 Journal 与 Receipt 分配或复用合法 attempt，调用方无需提供下一个编号

#### Scenario: 调用方伪造更大的 attempt

- **WHEN** CLI、Agent 或 Adapter 提交未由当前 Run 分配的 attempt 编号
- **THEN** Runtime 拒绝该 claim 或 Outcome，并保持已持久化的单调序列不变
