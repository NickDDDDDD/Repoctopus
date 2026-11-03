# development-telemetry Delta

## ADDED Requirements

### Requirement: Build workspace progress 必须可审计

Repoctopus MUST 从同一 lifecycle/trajectory 事实投影 BuildWorkspaceCheckpoint 的接受与拒绝，并以有界分类表达 `accepted|unauthorized-head-change|non-fast-forward|identity-drift|observation-failed|check-stale`。Metric labels MUST NOT 包含 repository id、branch、HEAD、path、digest、提交消息或诊断正文。

#### Scenario: Package 合法推进两个仓库

- **WHEN** Runtime 接受一个跨两仓 package 的 workspace checkpoint revision
- **THEN** 遥测记录 phase、work kind、checkpoint revision、advanced repository count 和 `accepted` 分类，精确仓库与 revision 只留在本地受保护 trajectory

#### Scenario: 未授权仓变化被拒绝

- **WHEN** Runtime 因非写集仓库 HEAD 变化拒绝 completion
- **THEN** logs/traces 可以关联 Run/Work 和 `unauthorized-head-change`，metrics 只增加对应有界计数且不泄露仓库或 revision
