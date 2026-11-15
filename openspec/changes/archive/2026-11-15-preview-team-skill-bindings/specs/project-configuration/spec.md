# Workspace 团队 Skill 教程规范

## ADDED Requirements

### Requirement: 初始化引导提供可照做的团队 Skill 示例

Workspace 本地教程 MUST 提供团队 Skill 的完整示例，包括项目默认查找目录、带有效元数据的 Skill、用现有 `lifecycle.skillBindings` 添加指导的 YAML、绑定预览命令及团队提交清单。

#### Scenario: 维护者首次添加项目团队 Skill

- **WHEN** 维护者照 Workspace 教程创建 Skill 文件并合并示例配置
- **THEN** 可以通过实际公开预览命令看到示例 Skill 的 Work、来源和顺序
- **AND** 教程说明把共享 YAML、Skill 正文及其所需资源一同提交

#### Scenario: 维护者从旧版 Workspace 获取教程

- **WHEN** 维护者用获批的引导刷新更新现有 Workspace
- **THEN** 受管教程包含团队 Skill 示例，区块外的团队内容保留
