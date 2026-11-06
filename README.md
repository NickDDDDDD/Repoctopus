# Repoctopus

让团队的编码 Agent 从需求、设计和验证走到归档交付，同一个 Change 可以协调多个 Git 仓库。

在 Codex 等能运行终端命令的 Agent 中提出任务。Repoctopus Runtime 决定下一步、为 Agent 提供当前步骤的 Skill，并核验执行结果。团队成员在需要人工决定时确认。

## 安装

准备 Git，以及 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。在包含团队发给你的 CLI 安装包的目录用 PowerShell 运行以下命令，以 0.1.0 为例。

```powershell
$repoctopusInstall = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.repoctopus-cli'
npm.cmd install --ignore-scripts --omit=dev --prefix $repoctopusInstall ./repoctopus-0.1.0.tgz
$repoctopusBin = Join-Path $repoctopusInstall 'node_modules/.bin'
$env:Path = "$repoctopusBin$([IO.Path]::PathSeparator)$env:Path"
repoctopus.cmd --help
```

看到 `Usage: repoctopus ...` 即可在业务工作区使用 CLI。若从其他终端或桌面图标打开 Agent，先把上面的 `$repoctopusBin` 加入用户 `PATH`，再重启 Agent。当前 [GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases) 尚无安装资产。维护者可以从固定提交生成 CLI 安装包，按需生成 Windows x64 桌面安装器，再分发给团队。桌面应用用于观察 Change 进度，CLI 负责运行工作流。详见[获取与安装](docs/install.md)。

## 快速开始

1. 打开团队的 **Workspace**，也就是有 `repoctopus.yaml` 和 OpenSpec 规格的 Git 仓库。单仓项目可以直接用业务仓，多仓项目通常用一个与业务仓同级的协调仓。如果项目还没接入，先完成[首次接入](docs/project-onboarding.md)。
2. 在 Workspace 中打开你的编码 Agent，说明要做的任务，并让它用 Repoctopus。下面是一条可以放到 Agent 对话里的示例。

   > 用 Repoctopus 做这个 Change：修正设置页保存失败时的提示。当前目录是 Workspace，目标分支是 main。请先创建并推送 Change 分支，然后用 repoctopus run start 启动。按 Runtime 派发的 Work 领取并执行 Skill，提交 Outcome 后再继续。遇到人工决定时停下来，把确认入口给我。

3. Agent 从 `repoctopus run start` 的 JSON 得到 `runId`。需要查看进度时，让 Agent 用 `repoctopus run status --workspace . --run` 加上这个 ID。已有 Run 在同一个 Workspace 续接，详见[命令与恢复](docs/self-hosting.md#3-运行与恢复)。

| 阶段    | 你会看到什么                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------- |
| Open    | Agent 核对需求和代码，准备 OpenSpec 的 Proposal、Delta Specs、Design、Tasks。你确认本次 Change 的范围。 |
| Design  | Agent 深化同一份设计和任务，你确认实施与验证方案。                                                      |
| Build   | Runtime 确定执行配置并派发工作包。Agent 执行、提交并推送，Runtime 核验结果。                            |
| Verify  | Runtime 按项目配置收集 Evidence，确认需求和实现对应。                                                   |
| Archive | 通过交付审批后，Runtime 归档规格并发布业务 MR 和 Change MR。团队在代码托管平台评审和合入。              |

## 团队配置

把团队共享配置提交到 Workspace 根目录的 `repoctopus.yaml`。个人机器的仓库路径、端口等覆盖写在 `.repoctopus/local.yaml`。发布 Token 通过进程环境注入。

- 首次接入、单仓与多仓、OpenSpec Store 和各配置项的作用见[项目接入](docs/project-onboarding.md)。
- 检查命令和覆盖范围见 [Evidence 配置](docs/evidence.md)。
- 团队 Skill 的接入和 IDE 投影见 [Skills](docs/skills.md)。
- Git 远端、发布审批和 MR 恢复见[交付](docs/delivery.md)。

## 接入团队 SigNoz

在现有 `repoctopus.yaml` 增加以下配置，把示例 URL 换成团队提供的 OTLP/HTTP Collector 基础地址。

```yaml
telemetry:
  endpoint: https://signoz-collector.example.internal/otlp
```

Repoctopus 会在基础地址后追加各信号的路径，并在运行时发送 Trace、Log 和 Metric。团队网关需要认证时，从启动 Agent 的环境注入 Header。详见 [SigNoz 接入、数据验证与看板](docs/telemetry.md)和[遥测字段参考](docs/telemetry-reference.md)。

当前 Change 的即时进度可用 [Windows Desktop Dashboard](docs/desktop-activation.md) 查看。团队历史和趋势可在 SigNoz 查询。

开发资料见 [Runtime 与插件架构](docs/architecture.md) · [状态与恢复](docs/runtime-state.md) · [Specification Provider](docs/specification.md) · [自举与源码验证](docs/self-hosting.md) · [上游采用记录](third_party/comet/adoption-report.md)
