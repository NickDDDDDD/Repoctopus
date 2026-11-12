# Spec Delta

## ADDED Requirements

### Requirement: 首次配置 Verify Profile 可从原 Run 继续

Runtime MUST 允许最小 Workspace 的 Change 通过原有 Open、Design 和 Build 门禁。选定 Verify Profile 尚未配置时，Runtime MUST 在需要正式验证的边界保留原 Run 并返回可执行的配置指引。批准配置后 MUST 从同一 Run 继续验证，按真实依赖保留仍有效的批准、Plan 和 Build 完成事实。进入 Archive MUST 具有当前有效 Acceptance Gate。

#### Scenario: 未配置 Verify Profile 时完成 Build

- **WHEN** 最小 Workspace 的 Change 已满足 Build Check，选定 Verify Profile 缺席
- **THEN** Runtime 返回可恢复的待配置状态
- **AND** 不创建假 Evidence、不进入 Archive、不重置有效 Build 成果

#### Scenario: 从新进程恢复同一 Run

- **WHEN** 用户批准添加选定 Profile，正常提交配置，然后从新进程恢复
- **THEN** Runtime 从原 checkpoint 冻结当前真实 Verification Input 并执行验证
- **AND** 有效工作包保持完成，真实仓库、规划或实现漂移仍按正常规则处理
