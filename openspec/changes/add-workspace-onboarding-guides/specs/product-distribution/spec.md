# Spec Delta

## ADDED Requirements

### Requirement: 发布包初始化生成可用的 Workspace 引导

Repoctopus MUST 在实际候选 tarball 的独立生产安装环境中，通过已安装的公共 CLI 完成获批项目接入，验证 README、AGENTS 和 Workspace 内教程能够生成并用于基本操作。验收 MUST 覆盖新建多仓 Workspace 与已有说明文件的单仓项目，验证本地链接、公开命令以及未批准请求的无共享文件副作用；不得注入源码开发文件才能通过。

#### Scenario: 从候选 tarball 初始化多仓 Workspace

- **WHEN** 候选包仅安装生产依赖，用户在与产品源码无关的临时多仓项目中通过公共 CLI 完成 detect、prepare 和可信 review
- **THEN** Workspace 存在可阅读的人与 Agent 引导和完整本地教程，链接均指向有效文件，教程使用的启动、状态及恢复命令能由已安装 CLI 解析和执行
- **AND** Agent 指令不依赖未随包提供的 Skill 文件、产品 AGENTS、开发 lockfile 或产品 checkout 路径

#### Scenario: 单仓已有团队说明与 Agent 规则

- **WHEN** 同一候选包为已有 README 和 AGENTS 的单仓项目完成接入
- **THEN** 保留原有内容，生成与单仓布局一致的受管入口，并能够按教程进入受管工作流

#### Scenario: 未批准初始化或引导资源不可用

- **WHEN** 接入被拒绝、仅停在草稿或准备阶段，或者发布包缺少引导所需资源
- **THEN** 前两种情况不修改共享引导文件，资源缺失则接入或候选验收明确失败，不把源码模板可用视为安装包可用

#### Scenario: 模板内容与当前公共 CLI 不一致

- **WHEN** 生成教程引用不存在的子命令、必需参数错误、缺失的本地教程或未分发的源码路径
- **THEN** 候选验收失败并指出具体命令或链接，不将该候选报告为完整初始化可用
