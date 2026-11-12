# Spec Delta

## ADDED Requirements

### Requirement: CodeBuddy、CodeArts 码道和 TRAE 能原生调用 Repoctopus Skill

Repoctopus MUST 为 CodeBuddy、CodeArts 码道和 TRAE 提供原生发现与显式调用的入口资产，覆盖首次接入、Workspace 新建或恢复 Change 以及单独配置 Verify。各宿主 MUST 使用同一公共 Runtime 协议，并准确报告其实际可用能力。

#### Scenario: 未接入项目的宿主调用 Init

- **WHEN** 用户为相应宿主安装个人级入口，并在未接入项目的新会话显式调用 Init
- **THEN** 宿主实际装填入口 Skill，并向 Runtime 发起接入请求

#### Scenario: 已接入 Workspace 调用入口

- **WHEN** 用户在三种宿主之一打开已接入 Workspace 并调用相应 Skill
- **THEN** 宿主原生发现并加载目标入口，通过公开接口启动或恢复 Run，或启动独立 Verify 配置
- **AND** 当前阶段与 Action 仍以 Runtime continuation 为准

#### Scenario: Skill 被停用或被同名入口覆盖

- **WHEN** 支持宿主中目标 Skill 未实际启用或选中
- **THEN** 验收明确记录发现与调用受限及恢复方式，不将仅写入文件视为成功调用
