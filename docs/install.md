# 获取与安装 Repoctopus

准备 Git 和 Node.js 22.16 或更新的 22.x 版本，或 Node.js 24 及以上。团队指定版本后，请在各次 Change 中使用同一份 CLI。

## 从 Releases 运行 CLI

在 [GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases) 找到该版本的 `repoctopus-<版本>.tgz`。以下以 `v0.1.0` 为例。

```bash
npx --yes --ignore-scripts --package=https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.0/repoctopus-0.1.0.tgz repoctopus --help
```

确认输出 `Usage: repoctopus ...` 后，打开团队 Workspace。把上面的 `npx` 前缀加到文档里的 `repoctopus` 命令前，其余参数原样传入。让 Agent 执行时也提供这个固定版本命令。Windows PowerShell 若阻止 `.ps1` 启动器，使用 `npx.cmd`。

当指定版本仍是草稿、尚无公开资产或网络无法访问 Releases 时，使用团队分发的 tarball。切换到该文件所在目录，再把 `--package` 的值换成 `./repoctopus-0.1.0.tgz`。

## 安装到用户目录

如果希望在后续会话直接使用 `repoctopus`，下载固定版本的 `.tgz`，对照该 Release 的 `SHA256SUMS` 核对文件，再安装到独立用户目录。以下是 Windows PowerShell 示例。

```powershell
$repoctopusInstall = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.repoctopus-cli'
npm.cmd install --ignore-scripts --omit=dev --prefix $repoctopusInstall ./repoctopus-0.1.0.tgz
$repoctopusBin = Join-Path $repoctopusInstall 'node_modules/.bin'
$env:Path = "$repoctopusBin$([IO.Path]::PathSeparator)$env:Path"
repoctopus.cmd --help
```

可以从该终端启动 Agent，让它继承 `PATH`。若从桌面图标启动，在 Windows 用户环境变量 `Path` 中加入 `$repoctopusBin` 对应的目录，再重启 Agent。macOS 和 Linux 同样可以用 `npm install --ignore-scripts --omit=dev --prefix` 安装到独立用户目录，并把其中的 `node_modules/.bin` 加入 `PATH`。

安装成功后，按[首次接入](project-onboarding.md)或[快速开始](../README.md#快速开始)操作。高级文档中的 `node bin/repoctopus.js` 可以换成已安装的 `repoctopus`，或使用固定版本的 `npx` 命令。

## 可选的 Windows Dashboard

从同一个 Release 下载 `Repoctopus-Desktop-<版本>-x64-Setup.exe`，对照 `SHA256SUMS` 核对文件再安装。在已接入的 Workspace 启动或恢复 Change 时，CLI 会尝试打开 Dashboard。详见[桌面激活与诊断](desktop-activation.md#使用已安装应用)。

## 维护者发布版本

1. 选定远端 `main` 上已通过 `Continuous integration / verify` 的完整提交 SHA。从该提交的 `package.json` 取得版本，例如 `0.1.0` 对应 `v0.1.0`。首版使用 GitHub 的预发布标记。
2. 在 GitHub Actions 的 **Prepare or publish Repoctopus release** 选择 `main`，以 `prepare`、完整 SHA 和 Tag 启动。该操作验证提交、构建并验收 CLI 与桌面包，然后生成草稿。
3. 等 Prepare Run 成功，从候选作业的摘要抄取 **Candidate artifact ID**。在草稿中核对目标提交、CI Run 链接和三份文件。候选工件包含来源记录，可以用其中的摘要核对下载内容。
4. 从 `main` 再次启动同一 workflow，选择 `publish`，填入同一个 SHA、Tag 和候选工件 ID。该操作核对草稿及远端摘要，再公开预发布。查看末尾的 **Verify public downloads and npx** 作业，确认公开 URL 的文件摘要、CLI 帮助和 JSON 响应都通过。
5. 将固定版本的 Release 页面及命令交给团队。遇到公开下载验证失败，先核对该版本的公开状态和资产。修复临时网络问题后可用同一个候选重跑 Publish 的验证。需要更正已发布内容时使用新版本和 Tag。

Prepare 的草稿上传中断时，优先在原 Run 中重跑失败作业，继续使用原候选文件。重新构建的安装器可能产生不同摘要。发现同名 Tag、草稿或资产冲突时，保留已有结果并核对提交和候选身份。候选工件过期或缺失时需要重新选择有效候选。

若 GitHub 为失败上传留下空的 `starter` 占位，维护者先确认状态和大小，再按 GitHub 的资产恢复说明处理该占位并重试原候选。公开时保持草稿、Tag 和资产稳定。若 GitHub 拒绝为工作流文件与默认分支不同的历史提交创建 Tag，维护者可使用有权限的凭据预先建立指向该精确 SHA 的 Tag，Prepare 会再次核对。

维护者也可以从固定提交运行 `npm ci`、`npm run build` 和 `npm pack`，生成供团队在本地验证的 `.tgz`。完整发布通过上面的候选和草稿流程交付。
