# Spec Delta

## ADDED Requirements

### Requirement: Open 重观察与仓库漂移分类必须可审计

Runtime MUST 从权威 checkpoint/trajectory 导出 Open observation stage 与 Project reconciliation class，使团队能够区分第一层 Provider validation、第二层 planning gate、内容变化和身份变化。公开 Metric attributes MUST 使用固定低基数枚举；branch、path、remote、OID、digest、错误正文与 changeId 不得进入 Metric label。

#### Scenario: planning gate 暂时不可用后恢复

- **WHEN** 同一 Work 在 `validated` 后经历 planning observation unavailable并在后续 pull恢复
- **THEN** telemetry 以相同 run/work/attempt/checkEpoch 关联 unavailable 与 recovered，记录 `host_replayed=false`，且不新增 Skill invocation、Skill consumed 或 workflow failure 逻辑计数

#### Scenario: resume 观察到内容变化

- **WHEN** `run resume` 只观察到 HEAD/worktree 内容变化
- **THEN** Event/Trace 记录有界 `project_change_class=content` 并保留当前 continuation，Metric 不包含变化仓库身份或内容摘要

#### Scenario: resume 观察到身份变化

- **WHEN** `run resume` 观察到 branch、remote、path、repository identity 或 topology 变化
- **THEN** Event/Trace 记录有界 `project_change_class=identity` 与 reconciliation required，且不导出具体 branch、remote、path或摘要作为 Metric label

