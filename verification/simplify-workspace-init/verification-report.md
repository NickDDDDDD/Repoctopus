# Workspace 初始化安装包验收

Tested implementation commit: `0d00e2568dc28b3011ec01069e861cf16262a5f7`
Package content SHA-256: `5bb0ae0dc5c488329387b20568f8ae958710d21b7ee7d3481701628d182155a0`
Package files: `481`
Package content bytes: `6254471`
Archive SHA-256: `9b99eb7e46f1e3480e85592c2cc57b245a90b80b33e33ac5c2eb038c8714d0fb`

Windows 上独立安装 `npm pack` 生成的候选包。Codex 和 OpenCode 从各自的个人级入口发现并实际加载 Init Skill，在带空格路径的单仓调用已安装 CLI，分别收到待审批的最小计划。宿主原生调用由本地确定性模型驱动，两个单仓的共享配置均保持未写入状态。

在隔离的单仓和三仓项目中用已安装 CLI 读取请求并回传测试批准。CLI 生成最小配置、OpenSpec Store 和所选宿主的两个 Workspace 入口。两个项目均以空 Profile 启动 Run 并到达 Open。实验用 Git 远端位于本机。

[验收回执](acceptance-receipt.json) 记录当前包身份、原生宿主请求和两个启动的 Run。[完整变更验证报告](../../docs/superpowers/reports/simplify-workspace-init.md) 记录 Build、Verify 和 Archive 验收。

最终候选保留详细探测的旧诊断，并将保留团队 ID 的行为限定于轻量 Init。以上安装包和宿主检查均在该候选重新运行。
