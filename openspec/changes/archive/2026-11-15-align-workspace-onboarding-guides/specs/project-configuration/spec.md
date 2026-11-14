# Workspace 初始化引导规格

## MODIFIED Requirements

### Requirement: 人与 Agent 的本地引导使用真实工作流接口

Repoctopus MUST 为团队成员提供可移植的本地教程，覆盖安装入口、单仓和多仓首次接入、新成员登记与旧引导刷新、宿主 Skill 安装与补装、启动与恢复 Change、审批、Verify 配置、Git 交付、共享与本机配置和 SigNoz。公开说明与生成引导中的推荐入口、命令参数和提交清单 MUST 符合当前产品行为。AGENTS 引导 MUST 使用现有公共 CLI 获取同一 Run 的 continuation、领取 Work 和消费 Runtime 为当前 Action 绑定的 Skill 内容，并保持 Runtime 的阶段、能力与审批权威。文档不得授予阶段推进权限。

#### Scenario: 新 Agent 进入团队 Workspace

- **WHEN** Agent 读取根 AGENTS 且用户提供了待恢复的 Run 身份
- **THEN** 引导使其使用该 Run 的公共状态与恢复入口，按 Runtime 返回的当前 Work 执行，遇到可信人工决定或未知副作用时按返回结果处理
- **AND** 未提供 Run 身份时先核对新建或恢复意图，不虚构不存在的自动探针、枚举命令或阶段状态

#### Scenario: 团队成员在产品源码之外阅读教程

- **WHEN** 成员仅拥有团队 Workspace、业务仓和已安装 CLI
- **THEN** 可以通过 Workspace 的本地链接找到首次任务、恢复和配置说明，不需要读取产品 checkout 或打开产品 README 才能执行基本操作
- **AND** 示例不包含安装机器的绝对路径、发布凭据、Collector Header 值或维护产品源码用的 Comet 自举指令

#### Scenario: 团队首次接入或已有成员配置本机

- **WHEN** 团队在新建项目、已有 Workspace 的成员加入或旧引导刷新之间选择操作
- **THEN** 指南分别说明轻量 Init 和真实审批、本机登记现有 Store、以及以现有配置发起获批的文档刷新
- **AND** Init 可以在没有 Verify Profile 时完成，Verify 可按需独立配置并恢复原 Run

#### Scenario: 宿主启动 Change 或补装静态 Skill

- **WHEN** 成员使用任一当前支持的宿主并查看 Workspace README、AGENTS 或本地教程
- **THEN** 引导优先指向 Workspace 的 `repoctopus` Skill 启动或恢复，另提供公开 CLI 路径及真实审批要求
- **AND** 教程说明个人 Init、Workspace 入口、阶段和方法 Skill 的作用域，并列出审批后须提交的宿主 Skill 目录及其 `.repoctopus-workflow-skills/` 记录

#### Scenario: 团队核对遥测或导入健康看板

- **WHEN** 成员按生成的本地教程配置团队 SigNoz
- **THEN** 可设置 Collector 基础地址，理解默认远端 Logs 与按需诊断，并取得和导入随产品分发的看板 JSON
- **AND** 指南说明四项 Run 健康指标的用途、字段参考和 Windows Desktop 的当前 Change 观测用途
