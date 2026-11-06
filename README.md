# Repoctopus

用一个 Change 协调跨仓库的需求、实现、验证和交付。团队从 **Workspace** 进入工作流，在协调仓维护共享配置和 OpenSpec 规格，在各业务仓提交实现。单仓项目也可以直接把业务仓作为 Workspace。

## 快速开始

首次接入从获取 CLI 开始，然后选择[多仓项目](#接入多仓项目)或[单仓项目](#接入单仓项目)。团队已完成初始化时，直接看[接入已有团队项目](#接入已有团队项目)。

### 获取 CLI

准备 Git，以及 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。以下 PowerShell 示例使用 `v0.1.0`。在同一终端运行后续命令，`Invoke-Repoctopus` 会沿用这个版本。[GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases)

```powershell
$repoctopusPackage = 'https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.0/repoctopus-0.1.0.tgz'

function Invoke-Repoctopus {
    npx.cmd --yes --ignore-scripts --legacy-peer-deps --package $repoctopusPackage repoctopus @args
}

Invoke-Repoctopus --help
```

看到 `Usage: repoctopus ...` 后继续。网络无法访问 Releases 时，把 `$repoctopusPackage` 换成团队提供的本地 `.tgz` 绝对路径。也可以把 CLI 安装到用户目录，后续直接使用 `repoctopus`。[安装指南](docs/install.md)

### 接入多仓项目

准备一个团队共享的 Git 协调仓作为 Workspace。可以复用现有协调仓，也可以在团队的托管平台新建并初始化一个仓库。把它和业务仓检出到同一个父目录，每个仓都要有 Git 提交。

```text
team-platform/
├── workspace/  # 协调仓，保存 repoctopus.yaml 和 openspec/
├── web/        # 前端业务仓
└── backend/    # 后端业务仓
```

这个例子使用 Workspace 内的 OpenSpec 规格树，Store ID 为 `team-platform`，由团队自定。进入父目录 `team-platform/` 后执行以下命令。CLI 扫描父目录的直接子 Git 仓库，父目录应只放参与本次接入的仓库。

```powershell
Set-Location .\workspace
$detected = Invoke-Repoctopus project detect --workspace . --scan-root .. --store team-platform --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿应识别 `workspace`、`web` 和 `backend`。发现无关仓库时，把要接入的仓库放到专用父目录，再从 Workspace 重新探测。然后继续[审核并提交配置](#审核并提交配置)。[多仓布局与 Store 说明](docs/project-onboarding.md#选择-workspace)

### 接入单仓项目

以现有业务仓根目录作为 Workspace，例如 `settings-app/`。规格、团队配置与业务代码同仓存放。把业务仓放在只包含该仓的父目录下，然后进入业务仓根目录运行。

```powershell
$detected = Invoke-Repoctopus project detect --workspace . --scan-root .. --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

草稿应只识别这个业务仓。继续[审核并提交配置](#审核并提交配置)。

### 审核并提交配置

把草稿路径交给 Agent。可以直接发下面这段话。

> 帮我首次接入 Repoctopus。读取我给你的探测草稿，核对要接入的仓库、未决项以及各仓实际可运行的构建和测试命令。补全 `verify` Profile，说明每条必需检查能验证什么，把候选写到 `.repoctopus/drafts/project-candidate.yaml`，再交给我审核。

候选保存后，在同一个 Workspace 根目录准备审批。最后一条命令在交互终端中执行。

```powershell
$prepared = Invoke-Repoctopus project prepare --workspace . --draft $draft --candidate .repoctopus/drafts/project-candidate.yaml --json | ConvertFrom-Json
Invoke-Repoctopus project review --workspace . --request $prepared.result.file
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
Invoke-Repoctopus run start --workspace . --change fix-settings-save-message --target main --json
```

把输出的 `runId`、任务描述和固定版本的 CLI 命令交给 Agent。让它按 Repoctopus 派发的 Work 继续，在需要人工确认时停下来。Open 产物准备好后，在 Workspace 审核 OpenSpec 提案和涉及的仓库。多仓 Change 的实现分别提交到对应的业务仓。[启动与恢复指南](docs/project-onboarding.md#启动第一个-change)

## 接入已有团队项目

检出团队的 Workspace 和所需业务仓，使用团队指定的 CLI 版本。首次在本机使用时，登记团队的 OpenSpec Store，并按需配置本机仓库路径和团队凭据。[新成员接入](docs/project-onboarding.md#新成员接入)

## 工作流如何推进

**Open → Design → Build → Verify → Archive**

先确认需求范围与实施方案，再由 Agent 执行。Repoctopus 按项目配置运行验证并保存证据，交付获批后归档规格并发布 MR。团队在托管平台审查并合入。[状态与恢复](docs/runtime-state.md) · [交付指南](docs/delivery.md)

## 配置与观测

- 团队在根目录的 `repoctopus.yaml` 共享验证、交付和 Skill 配置。本机仓库路径和端口写在 `.repoctopus/local.yaml`，凭据由进程环境提供。[项目配置](docs/project-onboarding.md#配置放在哪里)
- 在共享配置填 `telemetry.endpoint`，连接团队 SigNoz 的 OTLP/HTTP Collector。指南包含信号验证、看板查询和完整字段清单。[SigNoz 指南](docs/telemetry.md) · [遥测字段参考](docs/telemetry-reference.md)
- 安装可选的 Windows x64 Desktop Dashboard，可查看当前 Change 的实时阶段和进度。[桌面安装与激活](docs/desktop-activation.md)
