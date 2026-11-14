---
comet_change: align-workspace-onboarding-guides
role: technical-design
canonical_spec: openspec
---

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
