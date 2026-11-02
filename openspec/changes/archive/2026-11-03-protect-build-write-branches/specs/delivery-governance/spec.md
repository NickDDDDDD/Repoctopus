# Spec Delta

## ADDED Requirements

### Requirement: 开发授权与交付检查必须共用受保护分支语义

Build Plan 的 source branch 授权与 Delivery checkpoint 的 protected branch 检查 MUST 使用同一纯领域模式匹配语义。精确名称、`*` 和 `?` pattern 在两个边界 MUST 返回相同结果，不得由平台 Adapter 与 Runtime Service 各自维护实现。

#### Scenario: release 通配模式

- **WHEN** 团队策略包含 `release/*` 且 branch 为 `release/2026.11`
- **THEN** Build Plan 写授权与 Delivery checkpoint 均把该 branch 判定为受保护

#### Scenario: 合法功能分支

- **WHEN** branch 为 `codex/change-a` 且不匹配任何 protected pattern
- **THEN** 两个边界均不因 protected branch policy 拒绝该 branch
