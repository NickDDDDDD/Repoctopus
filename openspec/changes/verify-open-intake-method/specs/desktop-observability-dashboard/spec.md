# desktop-observability-dashboard Delta

## ADDED Requirements

### Requirement: 桌面应用区分 Open Skill 消费与方法验证

桌面应用 MUST 从标准 OTLP 分别展示 Open Skill 的 consumed、method verified、incomplete、rejected 和 invalidated 状态，并用有界原因解释失败；界面 MUST NOT 展示 Receipt payload、思考过程或把 consumed 描述为已完成代码事实核对。

#### Scenario: grilling 已消费但 Receipt 被拒绝

- **WHEN** Dashboard 收到 consumed 和 Open method rejected 事实
- **THEN** 同时显示“内容已消费”和“方法验证失败”，Open phase 不显示为方法已通过
