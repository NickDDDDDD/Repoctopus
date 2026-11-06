# 多仓与单仓接入验证报告

- Tested implementation commit: `4aeeaae11d03cd5958609a90a558cb138b25bbba`
- Package: `repoctopus@0.1.0`
- Package files: `459`
- Package content bytes: `5666817`
- Package content SHA-256: `9f40968e0e1fa3461e56a021e774a7a6c6b568da7978403168e378fe693dd446`
- 验证环境为 Windows x64、Node.js 24.21.0 和 npm 11.19.0。

## 验收

- 使用公开的 `v0.1.0` 资产和 README 的 PowerShell 命令验证两条首次接入路径。多仓草稿识别同级的 `workspace`、`web` 和 `backend`，单仓草稿只识别 `settings-app`。测试候选使用探测结果和临时项目内可运行的构建及测试脚本。
- 两条路径均经过交互审批并生成共享配置、OpenSpec 目录及 Store 清单。多仓审批在两个业务仓写入 `store: team-platform`，Workspace 的 `.gitignore` 忽略 `.repoctopus/`。
- 将接入产物推送到临时 Git 远端，再按 README 创建和推送 Change 分支。两条路径的 `run start` 均成功，`run status` 确认处于 Open。验收范围为 CLI 接入与启动，测试环境未安装桌面端。
- 两个接入文档通过 Prettier 和 Git 差异检查，共检查 34 个本地链接与锚点。按上述提交重新打包并计算内容摘要。临时测试仓、包和缓存均已清理。
- README 产品介绍和 Workspace 术语更新后，复核了两条接入路径的 CLI 示例及配置值与实测版本一致，重新检查 34 个本地链接与锚点。现行文档和主规格统一使用 Workspace，18 项 OpenSpec 严格校验通过。
- CLI 快速开始改为先安装，再直接调用 `repoctopus.cmd`。从公开 URL 和带空格路径下的本地 `.tgz` 分别安装到隔离的 npm 全局目录。核对下载文件的 SHA-256，两种安装均通过 `--help` 和 `project detect`。后续接入命令参数与实测版本一致，38 个本地链接与锚点通过检查。临时安装、包、缓存和测试仓已清理。
- 从带空格路径的 Workspace 原样执行 README 中的相对路径安装命令。将安装包移出 Workspace 后，在同一终端运行帮助和多仓探测，草稿识别到 `workspace`、`web` 和 `backend`。临时测试仓、安装目录、包和缓存均已清理。
- 文档明确区分安装目录和 Workspace。发布地址安装可在任意目录执行，本地安装从文件所在目录执行。比较确认 README 的 8 个代码块与上次验收一致，重新打包后的临时文件已清理。
