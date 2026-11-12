# Workspace 初始化安装包验收

Tested implementation commit: `b497f4d157e6ad102cd9e989028561bab5996077`
Package content SHA-256: `b0f660411ee34bed37d281f2059a3cd09ddffe983b3e300bf10d467ac2e9b58e`
Package files: `481`
Package content bytes: `6256123`
Archive SHA-256: `3eba11c1cba91fc4188c42fcebf0c379fa7dd6f5a9bcdeabee2c36145326e56f`

Windows 上独立安装 `npm pack` 生成的候选包。Codex 和 OpenCode 从各自的个人级入口发现并实际加载 Init Skill，在带空格路径的单仓调用已安装 CLI，分别收到待审批的最小计划。宿主原生调用由本地确定性模型驱动，两个单仓的共享配置均保持未写入状态。

在隔离的单仓和三仓项目中用已安装 CLI 读取请求并回传测试批准。CLI 生成最小配置、OpenSpec Store 和所选宿主的两个 Workspace 入口。两个项目均以空 Profile 启动 Run 并到达 Open。实验用 Git 远端位于本机。

[验收回执](acceptance-receipt.json) 记录当前包身份、原生宿主请求和两个启动的 Run。[完整变更验证报告](../../docs/superpowers/reports/simplify-workspace-init.md) 记录 Build、Verify 和 Archive 验收。

最终候选保留详细探测的旧诊断，并将保留团队 ID 的行为限定于轻量 Init。以上安装包和宿主检查均在该候选重新运行。
