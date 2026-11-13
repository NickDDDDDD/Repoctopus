## ADDED Requirements

### Requirement: Workspace 接入安装工作流静态 Skill

Repoctopus MUST 在初始化和已接入 Workspace 的补装预览中列明所选宿主的静态 Skill 安装目标。获批后 MUST 在 Workspace 内安装阶段 Action Skill、已被工作流采用的 Matt 方法 Skill、所用 OpenSpec Provider 支持的静态 Skill 与其必要资源，并在报告完成前校验受管安装结果。

#### Scenario: 初始化单仓或多仓 Workspace

- **WHEN** 用户批准单仓或多仓接入及所选宿主
- **THEN** 安装目标位于 Workspace 内对应的项目 Skill 目录，宿主的新会话可以发现 Skill
- **AND** 多仓业务仓与用户级目录的 Skill 文件保持原状，接入可以在尚未配置 Verify Profile 时完成

#### Scenario: 预览、冲突或中断

- **WHEN** 接入尚未批准、目标存在同名团队文件或已被修改，或写入中断
- **THEN** 预览不写入目标，冲突保留现有文件并报告位置，中断后同一获批请求只补齐尚未完成的目标

#### Scenario: 已接入 Workspace 补装静态 Skill

- **WHEN** 团队批准对现有 Workspace 补装所选宿主的 Skill
- **THEN** 安装只物化所选受管文件，已有 Store、团队绑定与 Run 继续使用原有身份
