# Spec Delta

## ADDED Requirements

### Requirement: 新增宿主可按需安装 Workspace 入口

Repoctopus MUST 支持显式选择 CodeBuddy、CodeArts 码道和 TRAE，使用对应宿主可发现的项目级目录安装获批的 Repoctopus 入口资产。安装计划 MUST 显示目标和作用域，保留既有团队 Skill 和其他宿主配置。已有 Workspace MUST 可增量补齐所选宿主入口。

#### Scenario: 多仓 Workspace 选择新增宿主

- **WHEN** 用户确认在多仓 Workspace 安装 CodeBuddy、CodeArts 码道或 TRAE 入口
- **THEN** Repoctopus 在批准的 Workspace 目标安装该宿主的受管资产
- **AND** 独立业务仓及未选宿主的配置保持原状

#### Scenario: 已接入团队补装宿主

- **WHEN** 现有团队只选择新增宿主并批准安装
- **THEN** Repoctopus 保留共享配置、Store、Run 和其他宿主入口，补齐获批目标
- **AND** 同名或已修改的文件冲突得到明确诊断，中断可恢复
