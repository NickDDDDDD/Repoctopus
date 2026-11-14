# Repoctopus

Repoctopus 是一套面向软件团队的规格驱动开发工作流，帮助团队用编码 Agent 完成跨 Git 仓库的变更。例如，一个功能同时涉及前端和后端时，团队可以在一份 OpenSpec 变更里约定需求和验收标准，Agent 在各业务仓完成实现。

Repoctopus 按团队配置推进需求确认、设计、实现、验证和归档。开发者在关键节点审批，交付前可以查看运行了哪些检查及其结果。工作中断后，团队可以从原有进度继续。

## 快速开始

首次接入从获取 CLI 开始，然后选择[多仓项目](#接入多仓项目)或[单仓项目](#接入单仓项目)。团队已完成初始化时，直接看[接入已有团队项目](#接入已有团队项目)。

### 获取 CLI

准备 Git，以及 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。下面的接入步骤适用于 `v0.1.2`。先在 GitHub Releases 确认该版本的安装包已公开，再任选一种方式安装。使用旧版时请查阅对应 Tag 的 README。[GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases)

**方式一：直接从发布地址安装**

在任意目录打开 PowerShell，运行下面的命令。

```powershell
npm.cmd install --global --ignore-scripts --legacy-peer-deps https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.2/repoctopus-0.1.2.tgz
```

**方式二：手动下载 `.tgz` 后安装**

在发布页的 **Assets** 下载 `repoctopus-0.1.2.tgz`，也可以使用团队发给你的同版本文件。

在 `.tgz` 文件所在的目录打开 PowerShell，运行下面的命令。

```powershell
npm.cmd install --global --ignore-scripts --legacy-peer-deps .\repoctopus-0.1.2.tgz
```

**检查安装**

```powershell
repoctopus.cmd --help
repoctopus.cmd --version
```

确认帮助和版本输出符合已安装版本。接入命令在 Workspace 根目录执行。全局安装后可以在其他终端直接使用 `repoctopus.cmd`。需要临时运行、安装到独立用户目录，或终端找不到命令时，见[安装指南](docs/install.md)。

### 安装宿主入口

先为你使用的宿主安装个人 Init Skill。以下用 Codex 举例，也支持 OpenCode、CodeBuddy、CodeArts 码道和 TRAE。其他宿主的选项和安装目录见 [Skills 接入](docs/skills.md#在宿主中调用-repoctopus)。

```powershell
repoctopus.cmd skill install-init --entry-hosts codex
```

在宿主中打开下面对应的 Git 根目录，然后在新会话调用 `repoctopus-init`。

### 接入多仓项目

把独立 Workspace Git 仓和参与项目的业务仓检出到同一个父目录。各仓至少有一个提交。

```text
team-platform/
├── workspace/
├── web/
└── backend/
```

在宿主打开 `workspace/`，说「用 Repoctopus Init 接入多仓项目，选 web 和 backend」。核对 Agent 展示的仓库、OpenSpec Store 和安装目标后批准。Workspace 保存共享配置和 OpenSpec 规格，业务实现留在各业务仓。

### 接入单仓项目

在宿主打开业务仓 Git 根目录，说「用 Repoctopus Init 接入当前单仓」。核对接入计划后批准。该仓同时作为 Workspace，保存代码、共享配置和规格。

### 提交接入结果

把生成的共享配置、规格、所选宿主的 Skill 目录及其管理记录提交并推送。多仓接入如获批生成业务仓的 `openspec/config.yaml`，把文件提交到它所属的仓。

初始化完成后即可开发。到需要正式验证时，在 Workspace 调用 `repoctopus-configure-verify`，按项目实际命令配置 Verify，再恢复原 Run。团队已经配置好 Profile 时可直接执行 Verify。 [接入和配置详情](docs/project-onboarding.md)

### 启动第一个 Change

在 Workspace 根目录操作。确认远端目标分支已包含初始化文件，再从同步后的本地目标分支创建并推送 Change 分支。以下以 `origin/main` 和一个小修复为例。

```powershell
git switch main
git pull --ff-only origin main
git switch -c change/fix-settings-save-message
git push -u origin HEAD
```

在宿主的新会话中调用 Workspace 的 `repoctopus` Skill，提供需求、Change ID `fix-settings-save-message` 和目标分支 `main`。保留返回的 Run ID，中断后用同一个 ID 续跑。Agent 会在 Open 和 Design 分别展示审批，多仓实现提交到各自的业务仓。[终端启动与恢复](docs/project-onboarding.md#启动第一个-change)

## 接入已有团队项目

检出团队的 Workspace 和所需业务仓，使用团队指定的 CLI 版本。首次在本机使用时，登记团队的 OpenSpec Store，并按需配置本机仓库路径和团队凭据。[新成员接入](docs/project-onboarding.md#新成员接入)

## 工作流如何推进

**Open → Design → Build → Verify → Archive**

先确认需求范围与实施方案，再由 Agent 执行。Repoctopus 按项目配置运行验证并保存证据，交付获批后归档规格并发布 MR。团队在托管平台审查并合入。[状态与恢复](docs/runtime-state.md) · [交付指南](docs/delivery.md)

## 配置与观测

- 团队在根目录的 `repoctopus.yaml` 共享验证、交付和 Skill 配置。本机仓库路径和端口写在 `.repoctopus/local.yaml`，凭据由进程环境提供。[项目配置](docs/project-onboarding.md#配置放在哪里)
- 在共享配置填 `telemetry.endpoint`，连接团队 SigNoz 的 OTLP/HTTP Collector。导入工作流健康看板后，可以查看 Run 数与 Build 配置分布、终态失败率、未结束 Run 所在阶段及完成 Run 的平均回退。[SigNoz 指南](docs/telemetry.md) · [遥测字段参考](docs/telemetry-reference.md)
- 安装可选的 Windows x64 Desktop Dashboard，可查看当前 Change 的实时阶段和进度。[桌面安装与激活](docs/desktop-activation.md)
