# desktop-observability-dashboard Delta

## ADDED Requirements

### Requirement: 桌面应用展示 TDD 方法验证状态

桌面应用 MUST 从标准 OTLP 展示当前 package 的 TDD layer consumed、cycle incomplete、method verified、rejected 或 invalidated，并显示有界失败类别；界面 MUST NOT 展示命令输出或把最终测试成功等同于 TDD。

#### Scenario: TDD layer 已消费但 RED 无效

- **WHEN** Dashboard 收到 consumed 和 `infrastructure_failure` method rejection
- **THEN** 同时显示内容已消费和 TDD 方法失败，Work 不显示为 TDD 已验证
