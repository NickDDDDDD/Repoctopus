# 获取与安装 Repoctopus

准备 Git 和 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。团队指定版本后，请在各次 Change 中使用同一份 CLI。

从发布地址安装和手动下载 `.tgz` 安装都可以按 README 操作。安装后直接运行 `repoctopus`。[PowerShell 安装步骤](../README.md#获取-cli)

如果全局安装成功但 PowerShell 找不到 `repoctopus.cmd`，运行 `npm.cmd prefix --global`，把输出目录加到 Windows 用户环境变量 `Path`，再打开新终端。没有全局安装权限时，可以改用下方的临时运行或用户目录安装。

## 用 npx 临时运行 CLI

在 [GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases) 确认指定版本的 `repoctopus-<版本>.tgz` 已公开。以下以 `v0.1.5` 为例。

```bash
npx --yes --ignore-scripts --legacy-peer-deps --package=https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.5/repoctopus-0.1.4.tgz repoctopus --help
```

确认输出 `Usage: repoctopus ...` 后，进入准备接入的 Git 项目或已有团队 Workspace。每次运行时保留上面命令中直到 `repoctopus` 的部分，再把 `--help` 换成所需的子命令和参数。让 Agent 执行时也提供这个固定版本命令。Windows PowerShell 若阻止 `.ps1` 启动器，使用 `npx.cmd`。示例带上 `--legacy-peer-deps`，以避开 Windows npm 11 在同一项目连续运行本地 tarball 时的缓存解析错误。

也可以用手动下载或团队提供的 tarball。把 `--package` 的值换成该文件的绝对路径，切换到项目目录后仍可使用同一个路径。安装本地 tarball 时，npm 仍会按需从配置的 registry 获取依赖。

## 安装到用户目录

如果希望在后续会话直接使用 `repoctopus`，下载固定版本的 `.tgz`，对照该 Release 的 `SHA256SUMS` 核对文件，再在安装包所在目录打开 PowerShell。

```powershell
$repoctopusInstall = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.repoctopus-cli'
npm.cmd install --ignore-scripts --legacy-peer-deps --omit=dev --prefix $repoctopusInstall ./repoctopus-0.1.4.tgz
$repoctopusBin = Join-Path $repoctopusInstall 'node_modules/.bin'
$env:Path = "$repoctopusBin$([IO.Path]::PathSeparator)$env:Path"
repoctopus.cmd --help
repoctopus.cmd --version
```

可以从该终端启动 Agent，让它继承 `PATH`。若从桌面图标启动，在 Windows 用户环境变量 `Path` 中加入 `$repoctopusBin` 对应的目录，再重启 Agent。macOS 和 Linux 同样可以用 `npm install --ignore-scripts --omit=dev --prefix` 安装到独立用户目录，并把其中的 `node_modules/.bin` 加入 `PATH`。

安装成功后，按[首次接入](project-onboarding.md)或[快速开始](../README.md#快速开始)操作。PowerShell 使用 `repoctopus.cmd`，macOS 或 Linux 终端使用 `repoctopus`。临时安装时使用上文的固定版本 `npx` 前缀。维护者在验收 Repoctopus 源码时才需要运行源码目录中的 `node bin/repoctopus.js`。

## 可选的 Windows Dashboard

从同一个 Release 下载 `Repoctopus-Desktop-<版本>-x64-Setup.exe`，对照 `SHA256SUMS` 核对文件再安装。在已接入的 Workspace 启动或恢复 Change 时，CLI 会尝试打开 Dashboard。详见[桌面激活与诊断](desktop-activation.md#使用已安装应用)。

## 更新 CLI 和 Workspace 引导

用与首次安装相同的方式安装团队指定的版本，再运行 `repoctopus --version`。已接入的 Workspace 沿用原配置和 Store。按需单独补装或更新所用宿主的 Skill。需要更新本地 README、AGENTS 和使用指南时，走 Workspace 引导刷新。审批通过后提交并推送生成的文件。[Workspace Skill 补装](skills.md#在宿主中调用-repoctopus) · [刷新引导](project-onboarding.md#补齐或更新-workspace-引导)

有进行中的 Run 时，先用创建该 Run 的版本完成交付。升级后如果 `run status` 返回 `migration_required`，保留原 Run 和证据，并使用原版本继续。[Run 状态与恢复](runtime-state.md#身份分层与失效范围)

## 维护者发布版本

1. 在发布 PR 同步 `package.json`、`package-lock.json` 和安装文档，并用候选包验证。合入后，从远端 `main` 选定已通过 `Continuous integration / verify` 的完整 SHA。使用该提交的包版本生成 Tag，例如 `0.1.5` 对应 `v0.1.5`。发布流程使用 GitHub 的预发布标记。
2. 在 GitHub Actions 的 **Prepare or publish Repoctopus release** 选择 `main`，以 `prepare`、完整 SHA 和 Tag 启动。该操作验证提交、构建并验收 CLI 与桌面包。Windows 多仓验收使用同一个候选 `.tgz` 跑完 Init 到 Archive，检查首包后的冷恢复和规格 PR 响应丢失后的发布去重，封存核对通过收据和包摘要后生成草稿。
3. 等 Prepare Run 成功，从候选作业的摘要抄取 **Candidate artifact ID**。在草稿中核对目标提交、CI Run 链接和三份文件。候选工件包含来源记录，可以用其中的摘要核对下载内容。
4. 从 `main` 再次启动同一 workflow，选择 `publish`，填入同一个 SHA、Tag 和候选工件 ID。该操作核对草稿及远端摘要，再公开预发布。查看末尾的 **Verify public downloads and npx** 作业，确认公开 URL 的文件摘要、CLI 帮助和 JSON 响应都通过。
5. 将固定版本的 Release 页面及命令交给团队。遇到公开下载验证失败，先核对该版本的公开状态和资产。修复临时网络问题后可用同一个候选重跑 Publish 的验证。需要更正已发布内容时使用新版本和 Tag。

Prepare 的草稿上传中断时，优先在原 Run 中重跑失败作业，继续使用原候选文件。重新构建的安装器可能产生不同摘要。发现同名 Tag、草稿或资产冲突时，保留已有结果并核对提交和候选身份。已有草稿绑定的原工件过期或缺失时，发布停止并保留该草稿。原工件无法恢复时，使用新版本与 Tag 准备候选。

若 GitHub 为失败上传留下空的 `starter` 占位，维护者先确认状态和大小，再按 GitHub 的资产恢复说明处理该占位并重试原候选。公开时保持草稿、Tag 和资产稳定。若 GitHub 拒绝为工作流文件与默认分支不同的历史提交创建 Tag，维护者可使用有权限的凭据预先建立指向该精确 SHA 的 Tag，Prepare 会再次核对。

维护者也可以从固定提交运行 `npm ci`、`npm run build` 和 `npm pack`，生成供团队在本地验证的 `.tgz`。完整发布通过上面的候选和草稿流程交付。

### 独立运行 Windows 多仓候选包验收

在 Windows 源码根目录安装开发依赖，准备 Git for Windows 及其自带的 OpenSSL。对已经生成的本地 CLI 候选包运行下面的命令，将参数替换为实际包路径。

```powershell
npm run test:windows-multirepo-package-e2e -- ./repoctopus-0.1.4.tgz
```

测试会安装该包的生产依赖，在三个临时 Git 仓中完成一条 Change。第一驱动进程完成首包后退出，第二进程恢复同一 Run。托管测试服务先创建规格 PR，再断开响应并暂时隐藏查询结果，随后核对 Runtime 采纳原 PR，且没有重复推送或创建。

成功时输出 `PASSED Windows multirepo package acceptance` 和证据路径。默认在系统临时目录的 `repoctopus-workflow-evidence-<本次时间戳>/` 保存收据、CLI 原始输出、Skill 消费记录和服务请求账本。需要固定证据路径时，在本次终端设置 `REPOCTOPUS_WORKFLOW_E2E_EVIDENCE` 指向打包目录以外的目标 JSON 文件。失败时查看收据的 `failure.stage` 和同目录的 `driver.log`。测试退出会清理临时仓、安装目录和自己启动的服务。

验收预算为 15 分钟，覆盖安装及流程执行。网络或工具缺失导致的失败同样阻止候选通过。Prepare 在原 Windows candidate 作业内调用上述入口，使用 `always()` 单独保留 `repoctopus-workflow-diagnostics-<run>-<attempt>` 诊断工件。候选工件中的 CLI 摘要需与多仓通过收据一致，才会封存上传。
