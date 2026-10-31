# development-telemetry Delta

## ADDED Requirements

### Requirement: 团队 required check 必须形成可重放观测事实

Repoctopus MUST 在本地 Trajectory 持久化后，为 required check scheduled、claimed、completed、validated 和 gate blocked 生成版本化 Event/Span，并关联 Run、Work、checkpoint、binding、Contributor、Validator、Evidence 与有界结果。自由检查名、digest 和 Evidence identity MUST NOT 成为 Metric label，检查输出、本机路径和凭据 MUST NOT 导出。

#### Scenario: 团队检查失败

- **WHEN** 团队检查 Work 完成但 Validator 或 Gate 拒绝其 Outcome
- **THEN** Trace 关联 checkpoint、Work、Validator 和有界失败分类，Metric 使用固定 `role=required_check,result=failed`
