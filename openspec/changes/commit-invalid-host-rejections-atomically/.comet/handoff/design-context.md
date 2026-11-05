# Comet Design Handoff

- Change: commit-invalid-host-rejections-atomically
- Phase: design
- Mode: compact
- Context hash: 55b1ac737cefb8c8411084644b7bc8e0e781e741632fd6895334feea305db583

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/commit-invalid-host-rejections-atomically/proposal.md

- Source: openspec/changes/commit-invalid-host-rejections-atomically/proposal.md
- Lines: 1-26
- SHA256: 709328da988303f5e39e04012875f12ab97b352b907b18450af9199b6f0799e5

```md
# Proposal

## Why

Runtime 在两次 Run 写入中分别保存非法 Host 提交和拒绝结论。如果进程在两次写入之间退出，恢复入口可能把用于审计的 `failed` 投影当作真实执行失败接受，原 invocation 随即失去补交机会。

## What Changes

- 用一次 Run 提交记录可归属且有界的非法 Host 输入与拒绝结论，使冷恢复仍暴露同一 invocation 的补交入口。
- 让内嵌 Host、外部 Runner 与 reconciliation 返回的结果遵循同一拒绝写入规则。
- 以中断恢复测试验证没有非法终态 Outcome，原 invocation 可补交，合法结果只被接受一次。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。现有 `managed-work-execution` 已约束拒绝、身份重放和进程重启后的可纠正性，本 change 修复实现与既有规格的偏差。

## Impact

- 影响 Host 结果处理、Run Store 写入和相关恢复测试。
- 范围限于当前 invocation 的拒绝提交。旧的验收 Run 仅作缺陷证据，新一轮多仓验收在修复交付后独立执行。

```

## openspec/changes/commit-invalid-host-rejections-atomically/design.md

- Source: openspec/changes/commit-invalid-host-rejections-atomically/design.md
- Lines: 1-37
- SHA256: 6fdfc794ad1e624706b9368cf381d9c75f212adf2707f205a3d84a62602dbdd9

```md
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

```

## openspec/changes/commit-invalid-host-rejections-atomically/tasks.md

- Source: openspec/changes/commit-invalid-host-rejections-atomically/tasks.md
- Lines: 1-16
- SHA256: dc397d398bb79d859f25364478e79b52cc87b1c2c3e2b9148e808cec7920735e

```md
# Tasks

## 1. 复现与原子拒绝

- [ ] 1.1 新增 Host 输入落盘与拒绝之间的中断回归，确认旧实现恢复时会尝试终态化非法候选。 <!-- comet-task:dc303f36-9a1a-433d-9bc8-fc9aef6804e6 -->
- [ ] 1.2 在同一次 Run 提交中记录直接拒绝，验证历史、等待补交状态与事件同时提交，原 claim 和 invocation 保持，重复或冲突 ID 按原规则处理。 <!-- comet-task:6b380055-6255-416a-8491-e69945a9e0e8 -->
- [ ] 1.3 内嵌 Host、外部 Runner 与 reconciliation 共用已分类提交入口，验证非法输入无法出现在待接受状态，真实 Host 失败继续按原失败协议处理。 <!-- comet-task:d6b1e1cb-6a59-496e-94a0-9aa1640d7c8e -->

## 2. 恢复验证

- [ ] 2.1 从持久化 Run 重新启动，确认同一 invocation 可用新 submission ID 补交，合法结果只接受一次。 <!-- comet-task:f8261879-1535-4fd9-97d5-16a1eb2b095d -->
- [ ] 2.2 完成独立审查和全量门禁，记录包身份和实际中断恢复证据。 <!-- comet-task:db5f39ba-1f8a-41bf-9770-1562c57df383 -->

## Workflow follow-up

- 归档和合入后，使用更新的 Runtime 继续下一轮小型多仓验收。

```

## openspec/changes/commit-invalid-host-rejections-atomically/.openspec.yaml

- Source: openspec/changes/commit-invalid-host-rejections-atomically/.openspec.yaml
- Lines: 1-3
- SHA256: 12f3bb1c9fc7f0fc79e906b3ac658f23fecd3fce89b581ead10be2029295a381

```md
schema: spec-driven
created: 2026-11-06
skip_specs: true

```
