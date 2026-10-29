# Proposal

## Why

`build.plan` Host 已经只能提交结构化候选，但当前 Service 在候选缺失 Task、验收引用非法或 Plan Validator 拒绝时直接抛错。Host Outcome 已按不可变事实持久化，原 Work 又仍是当前 Work，因此同一 Run 不能重新提交候选，也不能通过 `resume` 或 `work-reconcile` 合法恢复。这把一个可预期的 Agent 计划错误变成了只能手改 Run Store 的永久阻塞，违反 Runtime 负责验证 Outcome 并选择下一 Action 的设计。

## What Changes

- 将 Build Plan candidate 的结构、Task/acceptance 覆盖、包依赖和 Plan Validator 拒绝统一建模为可审计的 Plan retry，而不是未处理异常。
- 保留旧 Work、Host invocation 和 Outcome 为不可变历史；Runtime 递增 `checkEpoch` 与 Plan action attempt，创建绑定同一冻结 Build Configuration 的全新 `build.plan` Work。
- 向新 Plan Work 交付有界拒绝原因，使 Host 能修正候选；不得覆盖旧 Outcome、复用旧 invocation 或绕过 Validator。
- 增加领域、Service 和进程恢复回归测试，证明重启后仍只能领取新 Work，修正候选通过后正常进入 Plan Evidence/Execute。
- 本 Change 不修改 Build Plan 的 Task 权威、人工暂停策略、执行模式或生命周期阶段。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `managed-work-execution`: 明确无效 Build Plan candidate 的拒绝、审计和同一 Action 重试语义。

## Impact

- 主要影响 `domains/change-lifecycle`、`services/workflow-runs`、Work Execution checkpoint、Trajectory/OTLP 诊断与相应测试。
- Run Store 不增加第二套状态；重试继续使用已有 `build-plan-retry-required` observation 和 `actionAttempt/checkEpoch`。
- 不采用第三方源码，不产生新的许可证影响；Comet 只作为 Runtime-authoritative Action 与不可变 Outcome 边界的参考。
- 现有被永久卡住的预发布 Run 不通过状态手术迁移；修复后的 frozen runtime 可按显式恢复流程为兼容 Run 生成新的 Plan Work。

## 非目标

- 自动替 Agent 补齐缺失 Task 或修改候选内容。
- 允许对同一 invocation 覆盖或重复提交不同 Outcome。
- 为任意未知 Runtime 异常无限重试。
- 修改 OpenSpec Tasks、Build Configuration、Plan 风险审批或 Execute/Check 语义。
