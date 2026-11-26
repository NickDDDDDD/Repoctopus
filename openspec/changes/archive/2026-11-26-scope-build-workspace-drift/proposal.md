# Proposal

## Why

[Issue #114](https://github.com/NickDDDDDD/Repoctopus/issues/114) 报告 Framework 工作包完成时，另一个团队同步只读 Web Front 仓，导致验收被拒。[Issue #115](https://github.com/NickDDDDDD/Repoctopus/issues/115) 报告同一执行工作区内，包写集以外的 Backend 业务提交也触发了相同的阻塞。当前 Build 恢复和 Outcome 验收将登记仓库的 HEAD 当作统一的进度锁。Runtime 需要继续严格校验 checkout、写入授权和实际输入，同时允许能证明与当前工作无关的仓库正常前进。

## What Changes

- 统一 Build 的 `run resume`、`run next`、Execute Outcome 和 Build Check 对工作区变化的判定。区分 checkout 身份冲突、受管实现提交、无关的外部 fast-forward 和受管输入变化。
- 对于能证明无关的外部 fast-forward，同一 Run 保留现有 Plan、审批和有效 Completion。该提交不计为当前包的实现或发布结果。
- 对于已确认的相关变化，只复核受影响的包、依赖这些包的后续工作和证据。存在未结算执行、不能证明输入范围、出现越权或重写历史时，保留可恢复进度并返回明确原因。
- 用实际候选安装包在 Windows 模拟多仓验证两条 Issue、真实输入变化、不同进程恢复、写入边界及最终发布内容。

## Capabilities

### New Capabilities

### Modified Capabilities

- `managed-work-execution`：区分 Package 写入推进和外部 Git 观察，要求 Runtime 按实际依赖校验 Outcome。
- `change-lifecycle`：让 Execute 与 Build Check 复用同一漂移判定，按受影响的输入收敛恢复范围。

## Impact

影响 Runtime 的 Build workspace checkpoint、Git 观察、Outcome 验收及证据恢复路径。沿用现有 Build 策略、Git 隔离和 OpenSpec 权威。Issue #105 单独只读排查，目前缺少其版本和恢复日志，无法确认属于同一故障。本 Change 的验收以 #114、#115 及相邻恢复边界为准。
