# development-telemetry Delta

## ADDED Requirements

### Requirement: Open 方法验证必须形成可重放观测事实

Repoctopus MUST 在本地 Trajectory 持久化后，为 Open Method Receipt submitted、accepted、rejected 和 invalidated 生成版本化 Event/Span，关联 Run、Work、method、Validator、结果和有界原因；Receipt payload、事实正文、Prompt、对话、本机路径和个人身份 MUST NOT 导出。

#### Scenario: Open Receipt 被拒绝

- **WHEN** Receipt 未覆盖可访问代码事实或引用旧 planning snapshot
- **THEN** Trace 记录有界拒绝原因，远端不得把 consumed 显示为 method verified
