# product-distribution Specification

## Purpose
定义 Repoctopus 源码 checkout、持续验证、生成产物与安装包之间的权威边界，使维护者和自动化能够证明实际执行的是当前源码，而不是历史本地产物。

## Requirements

### Requirement: 干净 checkout 持续验证

Repoctopus MUST 在 pull request、默认分支 push 和人工触发时，从干净 checkout 使用受支持的 Node 版本与锁定依赖执行完整仓库验证，并以稳定的检查结果公开成功或失败。

#### Scenario: Pull request 更新源码

- **WHEN** pull request 被创建、重新打开或同步新的提交
- **THEN** CI 从该提交的干净 checkout 安装锁定依赖并执行完整验证，任一必要步骤失败时检查结果为失败

#### Scenario: 默认分支接收提交

- **WHEN** 提交到达默认分支
- **THEN** CI 对默认分支上的精确提交重新执行同一完整验证并保留检查结果

#### Scenario: 维护者人工复验

- **WHEN** 维护者从代码托管平台人工触发验证 workflow
- **THEN** workflow 对所选提交执行与 pull request 相同的验证契约

### Requirement: 本地与 CI 共享验证命令权威

Repoctopus MUST 让 CI 调用仓库声明的标准完整验证命令，而不是在 workflow 中复制一套逐渐漂移的构建、测试和规格校验步骤。

#### Scenario: 仓库验证清单发生变化

- **WHEN** 维护者在标准完整验证命令中增加或调整必要检查
- **THEN** 后续本地完整验证和 CI 自动采用同一更新，无需同步修改重复的命令清单

#### Scenario: 标准验证中的任一检查失败

- **WHEN** 类型检查、Lint、构建、测试、生成物检查、架构检查、来源检查或规格校验返回失败
- **THEN** 标准完整验证和消费它的 CI 都返回失败，不把部分成功描述为可交付

### Requirement: 源码运行绑定当前构建产物

Repoctopus MUST 把 `dist` 视为源码 checkout 的可重建本地产物；直接从源码自举或验收时，在启动 CLI 前必须用当前 checkout 的标准构建命令生成所需 artifact，并立即通过生成物 freshness preflight。历史、缺失或来自另一提交的本地 `dist` 不得作为当前源码通过验证的证据。

#### Scenario: 更新源码后开始自举

- **WHEN** 维护者切换、拉取或合入新的源码提交并准备从源码入口启动 Repoctopus
- **THEN** 自举顺序先从当前 checkout 生成 CLI 与所需桌面 artifact、通过 freshness preflight，再启动源码入口

#### Scenario: 工作目录残留历史 dist

- **WHEN** 当前 checkout 中存在 Git 未跟踪且由较早源码生成的 `dist`
- **THEN** 验收不得仅凭该目录存在就认定当前源码已构建，必须重新执行标准构建与 freshness preflight，或使用由当前提交生成并验证的安装包

#### Scenario: 干净 clone 没有 dist

- **WHEN** 维护者或 CI 得到不包含忽略产物的干净 clone
- **THEN** 标准构建能够从已提交源码与锁定依赖生成完整运行 artifact，而不要求从 Git 恢复 `dist`

### Requirement: 安装包经过独立消费验证

Repoctopus MUST 从当前源码构建发布候选包，在临时消费者环境安装其生产依赖并通过打包后的公共 CLI 执行协议级验收；多仓工作流验收默认使用这条 package-first 路径，源码目录中的本地 `dist` 成功不能替代安装包验收。

#### Scenario: 构建 npm 发布候选

- **WHEN** 仓库执行安装包端到端验证
- **THEN** 验收从当前源码生成 tarball、安装到隔离消费者目录，并通过安装后的 `bin` 验证公共 JSON 协议和必要资源

#### Scenario: 包缺少运行资源

- **WHEN** 发布候选未包含 CLI artifact、Schema、工作流、许可证或运行所需资源
- **THEN** 安装包端到端验证失败，即使源码目录中的测试或本地 CLI 已通过

#### Scenario: 开始新一轮多仓工作流验收

- **WHEN** 维护者准备在隔离的多仓测试项目中验证 Repoctopus 生命周期
- **THEN** 验收默认从目标产品提交构建 tarball、安装到独立消费者环境并通过安装后的公共 CLI 启动，不复用长期源码 checkout 的本地 `dist`

#### Scenario: 验收必须观察未打包的源码改动

- **WHEN** 诊断目标要求直接运行尚未形成安装包的源码 checkout
- **THEN** 维护者显式记录该例外，并在每次源码更新后执行标准构建和 freshness preflight，确认通过后才调用源码入口

### Requirement: CI 状态不伪装成服务端合入保护

Repoctopus MUST 区分 workflow 产生的检查状态与代码托管平台实际启用的 required-check/branch-protection 策略；仓库内验证不得在未观察平台配置时声称失败检查一定阻止合入。

#### Scenario: CI workflow 已存在但 required check 未配置

- **WHEN** 仓库能够产生验证检查但平台分支保护未配置、不可观察或套餐不支持
- **THEN** 项目把 CI 描述为可用验证而不是已生效的服务端合入保护，并给出需要管理员完成的平台配置边界

#### Scenario: 平台把验证检查设为 required

- **WHEN** 托管平台确认默认分支规则要求当前稳定检查成功
- **THEN** 团队可以把失败检查视为服务端合入阻断事实，同时仍保留仓库验证结果与平台策略两份独立证据

### Requirement: Release 候选绑定已验证的产品提交

Repoctopus MUST 提供由维护者显式启动的 GitHub Release 流程。候选 MUST 绑定远端 `main` 历史中完整 CI 已成功的精确提交，Release Tag MUST 与该提交的包版本对应。候选的 CLI `--version`、默认产品遥测 `service.version` 与产品观测 Instrumentation Scope 版本 MUST 与包版本一致，并从同一包元数据派生。显式 OTEL 部署资源覆盖 MUST 保留既有优先级，候选验收 MUST 核对无显式覆盖时的默认版本；插件、协议及持久化 schema 的独立版本不得因此被批量改写。

#### Scenario: 从通过 CI 的提交构建候选

- **WHEN** 维护者为 `main` 上已有完整 CI 成功结果的提交请求匹配版本的 Release
- **THEN** 流程从该提交的干净 checkout 构建候选并在发布记录中保留提交、版本和验证结果

#### Scenario: 提交、CI 或 Tag 不满足发布要求

- **WHEN** 请求提交不在远端 `main` 历史、该提交的完整 CI 未成功、版本不匹配，或同名 Tag 已指向其他提交
- **THEN** 流程停止并给出可核对的原因，保留已有 Tag 和 Release

#### Scenario: 新版安装包报告产品版本

- **WHEN** 用户在源码仓之外运行新版本实际安装包的 `--version`，或该版本在未显式覆盖资源版本时向 Collector 输出产品观测
- **THEN** CLI 版本、资源的 `service.version` 和产品 Instrumentation Scope 版本均与安装包版本一致，不继续报告上一个发布版本
- **AND** 插件与协议的独立版本仍保持其自身契约

#### Scenario: 既有部署显式覆盖资源版本

- **WHEN** 部署通过现有 OTEL 资源配置显式设置 `service.version`
- **THEN** 产品 Resource 保留既有覆盖结果，Instrumentation Scope 与 CLI 仍报告实际产品包版本
- **AND** 默认版本一致性验收仍然执行，显式覆盖不替代或豁免候选默认版本检查

#### Scenario: 版本身份发生漂移

- **WHEN** 候选包的公开版本输出、产品观测版本或 Tag 与被验证的包版本不一致
- **THEN** 对应版本验收失败，候选不得被报告为可公开发布，也不覆盖旧版资产

### Requirement: Release 资产先验收再公开

Repoctopus MUST 用最终上传的同一份 CLI tarball 和 Windows x64 Desktop 安装器完成验收。Release MUST 提供这两份资产和对应的 `SHA256SUMS`，在草稿中核对完整性后才能公开。

#### Scenario: 验证并上传同一组产物

- **WHEN** 候选包通过独立 CLI 消费验收和 Windows 安装到卸载验收
- **THEN** 草稿附上已验证的 CLI 包、可选桌面安装器与校验文件，下载资产的文件名和 SHA-256 与候选记录一致

#### Scenario: 构建、验收或上传中断

- **WHEN** 任何必需检查失败、发布资产缺失或实际摘要不同
- **THEN** Release 保持未公开，诊断说明失败步骤和实际状态

#### Scenario: 发布操作被重试

- **WHEN** 同版本已有草稿或已公开 Release
- **THEN** 流程核对 Tag、提交和资产身份，匹配时复用已有结果，冲突时停止并保留现有资产

### Requirement: 团队用固定版本的 Release URL 运行 CLI

Repoctopus MUST 在用户文档给出固定版本的 GitHub Releases CLI 下载入口和 `npx` 调用。用户能够在源码仓以外从公开资产执行 CLI。Windows 桌面安装器仅用于本地 Dashboard。

#### Scenario: 从已公开的版本运行 CLI

- **WHEN** 用户在具备受支持 Node.js 和 Git 的环境中通过 `npx` 引用固定 Tag 的公开 `.tgz` 下载 URL
- **THEN** npm 从该资产解析并运行 `repoctopus`，可验证帮助输出和公共 CLI JSON 协议

#### Scenario: 首个版本仍在准备

- **WHEN** 对应版本的公开 Release 资产尚不可用
- **THEN** 文档说明发布状态并保留通过已取得 tarball 安装或运行的方式

#### Scenario: 仅需要 CLI 工作流

- **WHEN** Windows 用户没有安装 Desktop
- **THEN** 使用发布包运行 CLI 和 Change 工作流仍可用

### Requirement: 安装后诊断独立于开发资源

安装后的 `doctor` MUST 使用产品随包分发的来源清单、受保护资源和已安装的生产依赖完成来源诊断，不要求开发 lockfile、开发依赖或源码准备脚本。诊断 MUST 保留现有只读状态检查及 CLI 输出契约；实际资源缺失、损坏或生产依赖身份不符时不得报告健康。

#### Scenario: 仅安装生产依赖的健康 CLI

- **WHEN** 当前候选 tarball 在独立消费者目录中仅安装生产依赖，且工具包内没有开发 lockfile 和准备脚本
- **THEN** 对有效 Run 执行 `doctor --json` 成功并返回健康结果，不改变 Run、Checkpoint 或 Trajectory

#### Scenario: 已分发资源被损坏

- **WHEN** 安装包的必需来源资源缺失、被修改或无法解析
- **THEN** `doctor` 返回非零退出码与明确的结构化错误，不回退到源码 checkout，不跳过失败，也不修改 Run 的持久事实

#### Scenario: 生产依赖与登记版本不一致

- **WHEN** 安装后的生产依赖身份与产品来源清单不符
- **THEN** 来源诊断失败并指出相关依赖，不以开发锁文件中的历史版本代替安装事实

### Requirement: 开发审计与发布包诊断分别验证

Repoctopus MUST 保留 CI 对源码 lockfile、依赖 integrity、禁止依赖和开发准备资源的审计，并在实际 tarball 隔离安装后执行公共 `doctor` 的健康与损坏反例。源码测试通过不能代替安装后诊断验收。

#### Scenario: 开发锁与固定来源不一致

- **WHEN** 源码 lockfile 中的固定依赖版本或 integrity 漂移，或开发准备资源缺失
- **THEN** 完整来源审计失败，即使安装后诊断不依赖这些开发文件

#### Scenario: 发布候选的诊断命令回归

- **WHEN** 实际安装包不能对健康 Run 完成诊断，或损坏必需资源后仍报告健康
- **THEN** 包 E2E 失败并阻止候选被认定为通过完整验证

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

### Requirement: 发布包安装 Cordis 到普通目录

Repoctopus 发布包 MUST 用固定的官方 npm 版本安装 Cordis Core 和 Loader。两个包的版本与完整性 MUST 与仓库的上游来源清单一致。

#### Scenario: 在 Windows 安装候选包并从受限宿主启动

- **WHEN** Windows 用户直接使用 npm 安装发布候选 `.tgz` 并在 CodeBuddy IDE 中调用 CLI
- **THEN** npm 把两个 Cordis 依赖安装为普通目录，CLI 能返回有效的公共 JSON 响应

#### Scenario: npx 在独立消费者目录运行候选包

- **WHEN** 发布检查用 npx 执行候选包的项目探测
- **THEN** 检查以包含实验 Git 仓的父目录作为扫描根，核对 CLI 成功响应
