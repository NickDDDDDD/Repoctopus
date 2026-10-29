# Proposal

## Why

`build.plan` Host 已经只能提交结构化候选，但当前执行顺序先把 Host 提交绑定成终态 Action Outcome，再由 `WorkflowRuns.next()` 创建并校验 Build Plan。候选遗漏 Task、引用非法或 Validator 拒绝时，终态 Outcome 已不可覆盖，原 Work 又仍是 lifecycle current Work，Run 因而永久阻塞，只能依赖手改 Store。这不是 Plan 重试策略不足，而是“收到 Host 提交”和“Runtime 接受 Outcome”之间缺少明确边界。

Comet 0.5.0 已有成熟处理：Runtime 在同一次权威提交中先执行 Outcome contract、schema、step validator 与 transition；拒绝时保留原 Action/claim/attempt，把提交记录到 `rejectedOutcomes`，Host 使用新的 Outcome identity 为同一 Action 提交修正版。Comet 0.5.1 又把这套语义扩展到 Builder recovery，仍不通过创建新 Action 掩盖首次候选错误。

## What Changes

- 将 Host submission 与 accepted Action Outcome 分离：提交是不可变输入事实，只有通过当前 Work 的领域校验后才可绑定终态 Outcome 并推进生命周期。
- 对可纠正的 Build Plan candidate/schema/Validator 拒绝，保留同一 Work、claim、attempt、`checkEpoch`、invocation 与冻结输入，追加有界 rejected submission；不得创建新 Plan Work。
- 修正版必须使用新的 submission identity；相同 identity 的完全相同重放幂等，相同 identity 的不同内容冲突。
- 为外部 Host 返回明确的 `awaiting-correction` continuation 与拒绝诊断；不得静默重放可能有副作用的 Host 调用。
- 增加预修复卡住 Run 的显式兼容恢复：把“已终态化但未被 lifecycle 接受”的 Plan Outcome 原样转存为 rejected submission，并恢复原 Work 的纠正入口，不修改或删除历史事实。
- 增加领域、Service、进程重启、兼容恢复与 OTLP 回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `managed-work-execution`: 明确 Host submission、rejected submission 与 accepted Outcome 的两阶段边界和纠正语义。

## Impact

- 主要影响 `domains/work-execution`、`services/managed-work-executor`、`services/work-execution-authority`、`services/workflow-runs`、Run checkpoint/trajectory、CLI/adapter continuation、OTLP 与相应测试。
- WorkExecution checkpoint 需要有界保存 rejected submissions，但不增加第二套 lifecycle、Plan revision 或 Task 权威。
- 当前被卡住的预发布 desktop Run 通过 Runtime 受控迁移恢复，不直接编辑 `.repoctopus/runs`。
- Comet 仅作为行为与失败边界参考，不复制第三方源码，不产生新的许可证影响。

## 非目标

- 自动替 Agent 补齐缺失 Task、放宽 Plan Validator 或修改 OpenSpec Tasks。
- 对已被接受的 Plan 做原地覆盖；已接受 Plan 的后续变更仍走显式 revision 语义。
- 为任意失败无限重跑 Host，或把 Store、Provider、CAS、程序错误伪装成可纠正候选。
- 修改 Build Configuration、人工暂停策略、执行模式或 Execute/Check 语义。
