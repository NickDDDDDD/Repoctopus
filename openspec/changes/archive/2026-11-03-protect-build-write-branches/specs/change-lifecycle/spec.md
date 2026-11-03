# Spec Delta

## ADDED Requirements

### Requirement: Change Run 必须冻结 Build source branch 授权策略

Change Run MUST 把规范化 protected branch patterns 与已解析 target branch 作为稳定触发输入冻结。Build、恢复和重放 MUST 使用冻结事实，不得在 Plan 或 Execute 时从可变配置文件重新猜测授权策略。配置或 target branch 与已冻结输入不兼容时 MUST fail closed并通过正式 Runtime identity/Binding 修订处理。

#### Scenario: 启动时冻结团队策略

- **WHEN** Runner 使用包含 `main`、`master` 和 `release/*` 的有效项目配置启动 Change
- **THEN** Runtime 把规范化模式和本次 target branch 纳入 trigger identity，后续 Plan 校验使用同一事实

#### Scenario: 执行前配置文件被修改

- **WHEN** Run 启动后本地 YAML 的 protected branch patterns 发生变化，但 Run 尚未按正式入口修订
- **THEN** Runtime 不静默采用可变文件绕过或扩大旧授权，并返回配置身份不兼容或正式恢复入口
