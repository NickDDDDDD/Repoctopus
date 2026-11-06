# Repoctopus

Repoctopus 是一套面向软件团队的规格驱动开发工作流，帮助团队用编码 Agent 完成跨 Git 仓库的变更。例如，一个功能同时涉及前端和后端时，团队可以在一份 OpenSpec 变更里约定需求和验收标准，Agent 在各业务仓完成实现。

Repoctopus 按团队配置推进需求确认、设计、实现、验证和归档。开发者在关键节点审批，交付前可以查看运行了哪些检查及其结果。工作中断后，团队可以从原有进度继续。

## 快速开始

首次接入从获取 CLI 开始，然后选择[多仓项目](#接入多仓项目)或[单仓项目](#接入单仓项目)。团队已完成初始化时，直接看[接入已有团队项目](#接入已有团队项目)。

### 获取 CLI

准备 Git，以及 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。下面以 `v0.1.0` 为例，在 PowerShell 中任选一种方式安装。

**方式一：直接从发布地址安装**

在任意目录打开 PowerShell，运行下面的命令。

```powershell
npm.cmd install --global --ignore-scripts --legacy-peer-deps https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.0/repoctopus-0.1.0.tgz
```

**方式二：手动下载 `.tgz` 后安装**

在发布页的 **Assets** 下载 `repoctopus-0.1.0.tgz`，也可以使用团队发给你的同版本文件。[v0.1.0 发布页](https://github.com/NickDDDDDD/Repoctopus/releases/tag/v0.1.0)

在 `.tgz` 文件所在的目录打开 PowerShell，运行下面的命令。

```powershell
npm.cmd install --global --ignore-scripts --legacy-peer-deps .\repoctopus-0.1.0.tgz
```

**检查安装**

```powershell
repoctopus.cmd --help
```

看到 `Usage: repoctopus ...` 后，继续下方的多仓或单仓接入。接入命令在 Workspace 根目录执行。全局安装后可以在其他终端直接使用 `repoctopus.cmd`。需要临时运行、安装到独立用户目录，或终端找不到命令时，见[安装指南](docs/install.md)。

### 接入多仓项目

**Workspace** 是团队使用 Repoctopus 的入口，保存共享配置和 OpenSpec 规格。多仓项目使用一个独立的 Git 仓库作为 Workspace，可以复用已有仓库或新建一个。把 Workspace 和参与项目的业务仓检出到同一个父目录，每个仓至少要有一个 Git 提交。

```text
team-platform/
├── workspace/  # Workspace，保存 repoctopus.yaml 和 openspec/
├── web/        # 前端业务仓
└── backend/    # 后端业务仓
```

这个例子使用 Workspace 内的 OpenSpec 规格树，Store ID 为 `team-platform`，由团队自定。在 Workspace 根目录执行以下命令。CLI 扫描父目录的直接子 Git 仓库，父目录应只放参与本次接入的仓库。

```powershell
$detected = repoctopus.cmd project detect --workspace . --scan-root .. --store team-platform --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿应识别 `workspace`、`web` 和 `backend`。发现无关仓库时，把要接入的仓库放到专用父目录，再从 Workspace 重新探测。然后继续[审核并提交配置](#审核并提交配置)。[多仓布局与 Store 说明](docs/project-onboarding.md#选择-workspace)

### 接入单仓项目

以现有业务仓根目录作为 Workspace，例如 `settings-app/`。规格、团队配置与业务代码同仓存放。把业务仓放在只包含该仓的父目录下，然后进入业务仓根目录运行。

```powershell
$detected = repoctopus.cmd project detect --workspace . --scan-root .. --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿应只识别这个业务仓。继续[审核并提交配置](#审核并提交配置)。

### 审核并提交配置

把草稿路径交给 Agent。可以直接发下面这段话。

> 帮我首次接入 Repoctopus。读取我给你的探测草稿，核对要接入的仓库、未决项以及各仓实际可运行的构建和测试命令。补全 `verify` Profile，说明每条必需检查能验证什么，把候选写到 `.repoctopus/drafts/project-candidate.yaml`，再交给我审核。

候选保存后，在同一个 Workspace 根目录准备审批。最后一条命令在交互终端中执行。

```powershell
$prepared = repoctopus.cmd project prepare --workspace . --draft $draft --candidate .repoctopus/drafts/project-candidate.yaml --json | ConvertFrom-Json
repoctopus.cmd project review --workspace . --request $prepared.result.file
```

批准后，Repoctopus 准备或复用 Workspace 的 `openspec/`，登记本机的 OpenSpec Store，并写入团队共享的 `repoctopus.yaml`。把生成的共享文件按团队 Git 流程合入远端目标分支。

- **Workspace** 提交 `repoctopus.yaml`、`openspec/`、`.openspec-store/` 和变更后的 `.gitignore`。草稿和本机配置保存在被忽略的 `.repoctopus/` 中。
- **多仓中的业务仓** 如果批准了 Store 指向配置，将生成的 `openspec/config.yaml` 提交到它所属的业务仓。

[配置示例与审核细节](docs/project-onboarding.md)

### 启动第一个 Change

在 Workspace 根目录操作。确认远端目标分支已包含初始化文件，再从同步后的本地目标分支创建并推送 Change 分支。以下以 `origin/main` 和一个小修复为例。

```powershell
git switch main
git pull --ff-only origin main
git switch -c change/fix-settings-save-message
git push -u origin HEAD
repoctopus.cmd run start --workspace . --change fix-settings-save-message --target main --json
```

把输出的 `runId`、任务描述和团队使用的 CLI 版本交给 Agent。让它按 Repoctopus 派发的 Work 继续，在需要人工确认时停下来。Open 产物准备好后，在 Workspace 审核 OpenSpec 提案和涉及的仓库。多仓 Change 的实现分别提交到对应的业务仓。[启动与恢复指南](docs/project-onboarding.md#启动第一个-change)

## 接入已有团队项目

检出团队的 Workspace 和所需业务仓，使用团队指定的 CLI 版本。首次在本机使用时，登记团队的 OpenSpec Store，并按需配置本机仓库路径和团队凭据。[新成员接入](docs/project-onboarding.md#新成员接入)

## 工作流如何推进

**Open → Design → Build → Verify → Archive**

先确认需求范围与实施方案，再由 Agent 执行。Repoctopus 按项目配置运行验证并保存证据，交付获批后归档规格并发布 MR。团队在托管平台审查并合入。[状态与恢复](docs/runtime-state.md) · [交付指南](docs/delivery.md)

## 配置与观测

- 团队在根目录的 `repoctopus.yaml` 共享验证、交付和 Skill 配置。本机仓库路径和端口写在 `.repoctopus/local.yaml`，凭据由进程环境提供。[项目配置](docs/project-onboarding.md#配置放在哪里)
- 在共享配置填 `telemetry.endpoint`，连接团队 SigNoz 的 OTLP/HTTP Collector。指南包含信号验证、看板查询和完整字段清单。[SigNoz 指南](docs/telemetry.md) · [遥测字段参考](docs/telemetry-reference.md)
- 安装可选的 Windows x64 Desktop Dashboard，可查看当前 Change 的实时阶段和进度。[桌面安装与激活](docs/desktop-activation.md)
