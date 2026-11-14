# Comet Design Handoff

- Change: align-workspace-onboarding-guides
- Phase: design
- Mode: compact
- Context hash: c4da9cd43bad10594fb7c807b388453e9d5ed5125d47f25a798f1546a3cb8a51

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/align-workspace-onboarding-guides/proposal.md

- Source: openspec/changes/align-workspace-onboarding-guides/proposal.md
- Lines: 1-23
- SHA256: e19493fc300a9839cce554dd0975c8ee54f590fb916a46512576bf02f3730638

```md
# 对齐 Workspace 初始化引导

## Why

已发布的 v0.1.2 可以通过轻量 Init 接入项目、安装宿主 Skill、单独配置 Verify，并向 SigNoz 提供工作流健康数据。用该安装包完成多仓初始化后，生成的 Workspace 文档仍混有旧入口，遗漏 Skill 管理记录和看板导入说明。只看 Workspace 文档的成员容易走回底层命令，或将必须一起提交的文件留在本机。

## What Changes

- 对齐仓库 README、安装和接入指南、Skill 与遥测文档，以及初始化生成的 Workspace README、AGENTS 和本地教程。
- 让首次接入走 `repoctopus-init`，成员加入时复用团队配置并登记本机 Store，已有 Workspace 可单独补装宿主。说明如何通过新的获批请求刷新旧引导。
- 为所选宿主说明入口、阶段和方法 Skill 的实际安装范围与 Git 提交清单。Change 默认从 Workspace 的 `repoctopus` Skill 启动或恢复，说明审批、当前 Action 的 Skill 装填、Verify 补配及 Git 交付。
- 补齐团队 SigNoz 默认工作流日志、按需诊断和四项健康指标看板的导入路径，并说明 Windows Dashboard 的用途。
- 使用实际候选安装包验证新建单仓、多仓及旧 Workspace 引导升级。

## Capabilities

### Modified Capabilities

- `project-configuration` 的本地引导契约补充当前接入和工作流入口、受管文件提交清单，以及 SigNoz 看板获取方式。

## Impact

涉及初始化模板、相关公开文档及消费者验收。沿用现有接入审批、成员 Store 登记、Skill 安装、Runtime、Verify 和遥测协议。现有团队内容由受管区块更新机制保护。当前发布资产与版本号由单独的 Release 流程管理。

```

## openspec/changes/align-workspace-onboarding-guides/design.md

- Source: openspec/changes/align-workspace-onboarding-guides/design.md
- Lines: 1-41
- SHA256: a605829a353266292154630daef2fd0b7a5745b8b2c552aedc11e81b5f11e05a

```md
# Workspace 初始化引导对齐设计

## Context

对已公开的 v0.1.2 安装包做过实际多仓初始化。三个引导目标已生成，配置没有 Verify Profile，阶段 Action、Matt TDD 和 OpenSpec Explore 均已安装。看板 JSON 存在于 CLI 包的 `deploy/signoz/workflow-health.json`，不在初始化产物中。文档生成器仍保留部分早期模板。发布准备更新了产品 README 和公开指南，工作区成员看到的文本来自独立的受管模板。

## Goals / Non-Goals

让团队成员按当前产品行为完成首次接入、加入团队、补装、刷新引导、开发和观测。在真实安装包上核对 Workspace README、AGENTS、本地教程，以及相关公开示例。沿用现有 CLI、Runtime 审批、Store、受管文件边界与遥测协议。版本号和已公开资产保持当前状态。

## Decisions

| 事项 | 已核对的差异 | 对齐方向 |
| --- | --- | --- |
| 首次 Init | 公开步骤已以宿主和单仓、多仓为主，本地教程缺少对应入口与清楚的用途分界。 | 以个人 Init Skill 与获批的轻量接入为首次入口。说明多仓选择、终端入口及 Verify 独立安装配置。 |
| 成员登记与旧引导 | 本地教程把本机 Store 登记、引导刷新和 `detect → prepare → review` 放在一起。公开指南也让新成员沿用底层步骤。 | 分开说明本机登记、追加宿主、获批刷新各自的入口与写入范围。按实际命令验证已有 Store 和共享配置复用。 |
| Workspace README | 能找到本地教程，Agent 入口只有笼统的“读 AGENTS”。 | 明示 Workspace 的 `repoctopus` 入口和团队指定 CLI，保留项目简介与仓库列表。 |
| Workspace AGENTS | 宿主示例只有 Codex 与 OpenCode，当前 Action 的已校验本地 Skill 引用缺少说明。 | 对所有已支持平台使用一致入口。以已领取的 Runtime 执行包为准，通过原生验证或 `run work-content` 读取引用层。保留原生审批、回传与中断后的核对。 |
| Skill 安装与提交 | 本地教程仅在恢复小节附带补装命令，遗漏静态 Skill、资源和管理记录。 | 在接入与提交清单写出各自范围及 `.repoctopus-workflow-skills/`。核对同级目录、Host ID、现有团队文件保护和明确审批。 |
| Change 与 Verify | 本地教程先手工 `run start` 再交给 Agent。Verify 段已可用，但应把待补配的 Run 与正式验收的步骤连起来。 | 从已推送分支通过宿主入口开始，CLI 放在备用路径。写清 Open/Design 独立审批、Verify 补配携带原 Run、恢复、归档和按仓发布。 |
| SigNoz 与桌面 | 本地教程有 Collector 地址，没有默认远端 Logs、细粒度模式、四项指标和看板来源。 | 补上最短配置、接收确认、下载或从包中取得 JSON、导入和字段说明。团队看板与本机即时状态各自对应实际用途。 |

使用现有 Workspace guide 渲染器和受管区块写入流程。对影响多个入口的枚举优先复用已有产品定义。长表和字段详情通过版本可核对的参考链接提供，保留无需产品源码即可完成的本地步骤。公开文档仍按读者入口组织。

### 命令与写入范围

- **首次接入**沿用个人 `skill install-init --entry-hosts` 和宿主 `repoctopus-init`。终端示例为 `project init --layout single`，或 `project init --layout multi --scan-root .. --repositories <id[,id]>`，显式选择宿主并 review。指南将生成文件及可选业务仓 pointer 列入各自提交范围。
- **团队成员加入**从已检出的健康 Store 登记本机路径。用与 Repoctopus 固定依赖相同的 OpenSpec 版本，从 Workspace 根执行 `openspec store register . --id <store-id> --json`，随后用 `context --store <store-id> --json` 核对路径。只对已有健康、身份匹配的 Store 使用该命令，不附 `--yes` 自动创建 metadata。仓库布局不同时保留现有 `.repoctopus/local.yaml` 覆盖说明。
- **已有 Workspace 补装**使用 `project install-entry-skills --entry-hosts <host>` 和原请求审批。**旧引导刷新**使用显式布局的轻量 `project detect`，选择实际需要的宿主，保留现有 `repoctopus.yaml` 作为 `project prepare` 候选，再审查新请求，核对 pointer、Skill 更新及文档范围。指导单仓传 `--layout single --scan-root .`，多仓使用 `--layout multi --scan-root ..`，布局不满足探测条件时说明如何选择正确的扫描根。
- **开始与恢复**在所属 Workspace 新会话调用 `repoctopus`。用当前 Run 显示的请求审批，以领取结果和其附带的正文或校验引用为 Skill 来源。保留当前 Run 的 `--run` 连接 Verify 配置并明确批准；正式 Verify 由 Runtime 按 Profile 执行。CLI 示例与归档、MR 文档作为对应场景的参考。
- **导入看板**说明 CLI 包内路径 `deploy/signoz/workflow-health.json`，同时提供已发布版本的文件与字段入口，覆盖全局安装、临时 npx 和团队分发包。需要详细统计或诊断时跳到相同产品版本的公开文档。配置示例保留团队 Collector 基础 URL 和凭据环境变量的边界。

### 验证方法

已用公开 v0.1.2 在独立测试仓确认，OpenSpec 1.14.3 可以在第二份本机 registry 登记健康 Workspace，原共享配置字节保持一致。CodeArts 补装候选只涉及所选宿主，获批后成功安装。三仓实验使用已接入 Workspace、已选业务仓和无关仓，轻量探测后以原共享配置刷新引导，只保留已选仓，维护团队 README 原文。

Build 先为三份文档的关键路由和提交清单补回归。Verify 用同一份实际候选包执行两种 Init、独立成员 registry、补装与原配置刷新。核对本地链接、已选仓和已选宿主范围、文档与实际写入清单、看板 JSON 可读，以及更新保留受管区块外原文。针对 Windows 和 Linux 比较包内容摘要，再用完整 Verify 与公开 CLI 结果记录证据。

## Risks / Trade-offs

单独补装 Skill 与刷新文档具有不同审批影响。验收检查引导明确区分两者。成员机器注册路径变化、无 Verify Profile 和已有团队自定义内容应纳入候选包实验。静态说明的公开链接须随包可验证，避免要求团队升级到尚未发布的命令或错误地认为看板 JSON 会出现在 Workspace。

```

## openspec/changes/align-workspace-onboarding-guides/tasks.md

- Source: openspec/changes/align-workspace-onboarding-guides/tasks.md
- Lines: 1-16
- SHA256: ceb8511e62c4f82d36d2988c082ce901909beca82cb64145707c728043edb38f

```md
# Tasks

## 1. 对齐接入与工作流引导

- [ ] 1.1 更新 Workspace README 与本地教程的首次接入、成员加入和旧引导刷新。验收：单仓、多仓、已有团队三个入口各自列出实际命令、审批和文件影响，相关公开接入说明一致。 <!-- comet-task:a16ffaad-90b6-497a-a08b-0f4d3dcafa24 -->
- [ ] 1.2 更新宿主 Skill 安装、补装与 Git 提交清单。验收：覆盖全部已支持的 Host ID、个人与 Workspace 安装路径、随宿主目录提交的静态 Skill、资源和管理记录。 <!-- comet-task:5e6e1846-5b62-4469-9c2a-cda573304d37 -->
- [ ] 1.3 更新 AGENTS 和本地 Change 教程。验收：以宿主 Skill 为主，终端为备用，说明同一 Run、当前 Action、原生审批、独立 Verify 配置与按仓 Git 交付。 <!-- comet-task:b03ceeb0-a7ea-4986-8d67-17e2e229a195 -->

## 2. 对齐配置与观测引导

- [ ] 2.1 补齐本地 SigNoz 与 Windows Dashboard 用法，并复核公开文档。验收：与实际包内看板来源、OTLP 默认模式、诊断切换、统计入口和字段参考一致。 <!-- comet-task:42257029-a000-4ca8-8f21-d0cb6cab1cf6 -->

## 3. 验证生成结果和升级

- [ ] 3.1 用真实候选 `.tgz` 验收获批单仓、多仓、已接入 Workspace 和旧引导刷新。验收：新文档与安装文件实际存在，链接和命令可用，刷新保留团队内容，受管补装不会扩大到其他仓或宿主。 <!-- comet-task:82141830-eae5-4d6e-8ca5-f07ca9cffb0c -->
- [ ] 3.2 严格校验 OpenSpec、运行项目检查并记录安装包验证证据。验收：验证结果绑定当前候选，相关文档规则通过。 <!-- comet-task:81a1a9a4-0737-40d4-830c-b690d9f39b30 -->

```

## openspec/changes/align-workspace-onboarding-guides/.openspec.yaml

- Source: openspec/changes/align-workspace-onboarding-guides/.openspec.yaml
- Lines: 1-2
- SHA256: 2e91af4681be83038a92e715cfb64d8067b4c8399c2b25074da27a778869f3aa

```md
schema: spec-driven
created: 2026-11-14

```

## openspec/changes/align-workspace-onboarding-guides/specs/project-configuration/spec.md

- Source: openspec/changes/align-workspace-onboarding-guides/specs/project-configuration/spec.md
- Lines: 1-37
- SHA256: 544100c790ee4bf8b6ff4550d907b2064df86544fff491cd8593c7989fc8563f

```md
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

```
