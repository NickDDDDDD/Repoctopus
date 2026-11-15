# Skill 绑定预览规范

## ADDED Requirements

### Requirement: 启动 Run 前可以预览团队 Skill 组合

Repoctopus MUST 提供共享配置下的只读预览，使用与 Run 相同的生命周期定义、Skill Provider 解析与组合规则。有效结果 MUST 按 Work 展示 Skill 名称、角色、实际 Provider 与来源类别、实际装填顺序及适用的绑定 ID 或方法 slot。随执行配置变化的层 MUST 标明适用条件。

#### Scenario: 团队查看多个 Work 的生效绑定

- **WHEN** 维护者为 Build Check 添加团队指导，并通过已公开的 Design slot 替换默认方法
- **THEN** 预览分别显示两个 Work 的实际组合和顺序，保留各 Work 的 Action 层，并列出其余 Work 的默认组合
- **AND** 每个自定义层可追溯到 YAML 绑定与当前 Workspace 实际解析出的 Provider 和来源

#### Scenario: Build Execute 的 TDD 层取决于执行配置

- **WHEN** 维护者在任何 Run 创建前查看 Build Execute
- **THEN** 预览明确显示只有 TDD 模式会装填 TDD 方法，并反映该层与团队指导之间的实际顺序

#### Scenario: 配置或来源无效

- **WHEN** YAML 无效、目标 Work 或 slot 不存在、Skill 无法解析，或解析到禁止参与生命周期的来源
- **THEN** 预览返回非零退出码和可定位的诊断，并指明错误对应的配置字段、绑定或 Skill
- **AND** 响应不把无效配置列为可用组合

#### Scenario: Workspace 尚未创建任何 Run

- **WHEN** 维护者在新接入的 Workspace 或已有 Run 的 Workspace 查看预览
- **THEN** 命令不创建或推进 Run，不执行 Skill，不写入项目配置、Skill 文件或投影，也不需要 Run ID
- **AND** 输出提供装填元数据，省略 Skill 正文、资源内容和本机绝对路径
