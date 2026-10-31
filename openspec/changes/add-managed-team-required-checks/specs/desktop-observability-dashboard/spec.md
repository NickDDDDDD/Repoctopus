# desktop-observability-dashboard Delta

## ADDED Requirements

### Requirement: 桌面应用展示独立团队检查

桌面应用 MUST 从标准 OTLP 投影当前 checkpoint 的 required check，并展示 binding、Work 状态、Validator 结果和有界阻断原因；它 MUST NOT 把检查显示成核心 Action、额外 phase 或普通 guidance。

#### Scenario: required check 阻断流程

- **WHEN** 当前 checkpoint 的团队检查失败并阻止后续核心 Action
- **THEN** Dashboard 显示独立检查卡片、失败阶段和可恢复动作，核心 Action 保持自身状态
