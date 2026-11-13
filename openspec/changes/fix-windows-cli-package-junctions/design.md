# Design

## Context

同一 CodeBuddy CN IDE 4.12.4 的 A/B 实验中，原候选由 npm 创建两个 Cordis junction，`project detect` 退出 1。仅调整 npm 包声明的候选在同一终端返回 `ok: true`。两个 CLI bundle 的 SHA-256 相同。PowerShell 对原目录报告 `untrusted mount point`。

## Decisions

- 沿用 Comet 0.5.1 将外部依赖声明为 npm 版本的做法。将 Cordis Core 和 Loader 分别固定为 `4.0.5`、`1.0.6`，撤销这两个目录的 npm workspace 注册，刷新锁文件中的链接项。
- 核对锁文件中的版本和 npm 完整性与现有 Cordis 来源清单一致。上游官方包中记录的 60 个文件已与仓库快照逐一核对。
- 安装包验收从真实安装位置解析两个依赖的包清单，检查依赖目录类型和固定版本。另用 CodeBuddy CN IDE 的 Agent 终端执行同一份候选的公共 CLI。
- 发布烟测为临时扫描根创建一个子目录 Git 仓，再从该仓调用 `project detect`。这样用例能验证实际的多仓扫描契约。

## Verification

从干净工作区安装锁定依赖并构建，打出候选包。对候选执行生产依赖安装、全局安装、npx 及真实 CodeBuddy IDE 验证。CI 可通过包安装目录断言复现本问题。
