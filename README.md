# Repoctopus

让编码 Agent 按同一套规格、验证和交付流程推进单仓或多仓变更。

在自己的项目接入 Repoctopus 后，用 Agent 提出需求，审核规格与设计，并在交付前查看实际验证结果。

## 快速开始

以下从一个已有代码、尚未接入 Repoctopus 的 Git 项目开始。团队已经完成初始化时，可以直接走[已有项目入口](#接入已有团队项目)。

### 1. 获取 CLI

准备 Git，以及 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。选择团队使用的版本。以下是 `v0.1.0` 的 PowerShell 示例。[GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases)

```powershell
$repoctopusPackage = 'https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.0/repoctopus-0.1.0.tgz'
npx.cmd --yes --ignore-scripts --legacy-peer-deps --package $repoctopusPackage repoctopus --help
```

看到 `Usage: repoctopus ...` 后继续。版本公开前或 Releases 不可达时，将 `$repoctopusPackage` 改为团队提供的本地 `.tgz` **绝对路径**，再运行同一条命令。后续命令沿用这个变量。也可以把 CLI 安装到用户目录，直接使用 `repoctopus`。[安装指南](docs/install.md)

### 2. 初始化自己的项目

在 PowerShell 中进入业务 Git 仓库根目录。这个目录就是单仓项目的 **Workspace**。多仓项目则进入协调仓根目录。下面的命令扫描共同父目录的直接子仓库，示例假定父目录只放了本项目要接入的仓库。[多仓布局与接入](docs/project-onboarding.md#选择-workspace)

```powershell
$detected = npx.cmd --yes --ignore-scripts --legacy-peer-deps --package $repoctopusPackage repoctopus project detect --workspace . --scan-root .. --json | ConvertFrom-Json
$draft = $detected.result.file
$draft
```

把输出的草稿路径交给 Agent，核对探测到的仓库与验证命令。可以直接发下面这段话。

> 帮我首次接入 Repoctopus。读取我给你的探测草稿，核对仓库、未决项以及实际可运行的构建和测试命令。补全 `verify` Profile，说明每条必需检查能验证什么，把候选写到 `.repoctopus/drafts/project-candidate.yaml`。完成后把候选交给我审核。

候选保存后，准备并审核配置。最后一条命令在交互终端中执行。

```powershell
$prepared = npx.cmd --yes --ignore-scripts --legacy-peer-deps --package $repoctopusPackage repoctopus project prepare --workspace . --draft $draft --candidate .repoctopus/drafts/project-candidate.yaml --json | ConvertFrom-Json
npx.cmd --yes --ignore-scripts --legacy-peer-deps --package $repoctopusPackage repoctopus project review --workspace . --request $prepared.result.file
```

批准后，Repoctopus 准备或复用 `openspec/`、登记本机的 OpenSpec Store，并写入团队共享的 `repoctopus.yaml`。Repoctopus 也会在 `.gitignore` 忽略本机的 `.repoctopus/`。把生成的共享文件按团队 Git 流程提交到目标分支，通常包括 `repoctopus.yaml`、`openspec/`、`.openspec-store/` 和变更后的 `.gitignore`。[配置示例与审核细节](docs/project-onboarding.md)

### 3. 启动第一个 Change

从已经接入的目标分支开始。下面以远端 `origin`、目标分支 `main` 和一个小修复为例。

```powershell
git switch -c change/fix-settings-save-message
git push -u origin HEAD
npx.cmd --yes --ignore-scripts --legacy-peer-deps --package $repoctopusPackage repoctopus run start --workspace . --change fix-settings-save-message --target main --json
```

把输出中的 `runId`、任务描述和固定版本的 CLI 命令交给 Agent。让它从这个 Run 继续，按 Repoctopus 派发的 Work 执行，在需要人工确认时停下来。Open 产物准备好后，审核 OpenSpec 提案和本次变更范围。[启动与恢复指南](docs/project-onboarding.md#启动第一个-change)

## 接入已有团队项目

检出团队的 Workspace 和所需业务仓，使用团队指定的 CLI 版本。首次在本机使用时，登记团队的 OpenSpec Store，并按需配置本机仓库路径和团队凭据。[新成员接入](docs/project-onboarding.md#新成员接入)

## 工作流如何推进

**Open → Design → Build → Verify → Archive**

先确认需求范围与实施方案，再由 Agent 执行。Repoctopus 按项目配置运行验证并保存证据，交付获批后归档规格并发布 MR。团队在托管平台审查并合入。[状态与恢复](docs/runtime-state.md) · [交付指南](docs/delivery.md)

## 配置与观测

- 团队在根目录的 `repoctopus.yaml` 共享验证、交付和 Skill 配置。本机仓库路径和端口写在 `.repoctopus/local.yaml`，凭据由进程环境提供。[项目配置](docs/project-onboarding.md#配置放在哪里)
- 在共享配置填 `telemetry.endpoint`，连接团队 SigNoz 的 OTLP/HTTP Collector。指南包含信号验证、看板查询和完整字段清单。[SigNoz 指南](docs/telemetry.md) · [遥测字段参考](docs/telemetry-reference.md)
- 安装可选的 Windows x64 Desktop Dashboard，可查看当前 Change 的实时阶段和进度。[桌面安装与激活](docs/desktop-activation.md)
