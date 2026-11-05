---
comet_change: commit-invalid-host-rejections-atomically
role: technical-design
canonical_spec: openspec
---

# Design

## Context

目前 Host 入口先用 `markHostCompleted` 将候选写为 `submitted`，再单独写入拒绝。已有的恢复分支会把 `submitted` 中的 `failed` 结果送给正常失败接受路径。外层解析产生的诊断投影因此会和真正的 Host 失败混淆。

固定版本 Comet 0.5.1（`35c9860b77b42bafa0c2d80d8d695889f888a924`）的 `domains/engine/runtime-service.ts` 中，`recordOutcomeInternal` 在一次 `mutate` 中区分接受与拒绝，拒绝分支保留原 Action 并写入拒绝记录。Comet 的解析入口拒绝无法形成 Runtime Outcome 的输入。Repoctopus 额外保留仍可归属当前 invocation 的有界原始输入，这份数据随拒绝结论一起落盘。

## Goals / Non-Goals

**Goals**

- 进程在拒绝提交前或提交后中断时，Run Store 都不会暴露可被接受的非法候选。
- 拒绝保留原 claim、packet、attempt、checkEpoch 和 invocation。相同 submission 的重放可去重，修正版可使用新的 submission ID。

**Non-Goals**

- 重写 Build 领域验证、Action Receipt 协议或既有生命周期。
- 修写此前已经错误终态化的预发布 Run。

## Decisions

1. Host 入口确认可归属身份后，先分类确定的协议拒绝。已有领域校验继续处理合法的 pending submission。
2. `WorkExecutionAuthority` 在一个 guarded commit 中校验当前 claim 和提交身份，追加带原始内容的有界 rejected submission 与拒绝事件，并设置 `awaiting-correction`。直接拒绝路径不得发布可供接受的 pending submission。保留现有 payload digest 去重与冲突规则，以及 processing error 与可纠正拒绝的区别。
3. Inline、external、reconcile 都使用相同的拒绝写入边界。提交期间若已有别的 pending submission，不得借用当前非法输入清除它。
4. 测试必须在 Runtime 提交边界中断并从保存的 Run 恢复。断言拒绝仍可补交、无非法 Action Outcome 或 Receipt、合法补交仅接受一次。另核对真正的 Host 失败仍走正常失败处理。

## Risks / Trade-offs

- 在恢复入口识别某一种非法投影可以封堵已知案例，但两次写入之间仍存在不可解释的状态。一次 guarded commit 把约束放到写入方，适用于所有读取者。
- 拒绝诊断和审计需要保留。事件与历史仍使用现有边界，检查在进入 Store 锁之前完成，锁内只做身份核对与状态变更。
