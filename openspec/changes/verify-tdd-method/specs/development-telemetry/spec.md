# development-telemetry Delta

## ADDED Requirements

### Requirement: TDD 方法验证必须形成可重放观测事实

Repoctopus MUST 在本地 Trajectory 持久化后，为 TDD cycle submitted、accepted、rejected 和 invalidated 生成版本化 Event/Span，关联 Run、Work、package、method、Validator、结果和有界原因。命令输出、源码片段、本机路径和自由测试名 MUST NOT 导出或成为 Metric label。

#### Scenario: TDD Receipt 被拒绝

- **WHEN** RED 属于基础设施失败或 GREEN 绑定旧代码输入
- **THEN** Trace 记录有界拒绝分类，远端不得把 consumed 或最终测试成功显示为 method verified
