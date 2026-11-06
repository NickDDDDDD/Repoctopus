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
