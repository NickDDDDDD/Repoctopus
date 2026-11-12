# Workspace 初始化安装包验收

Tested implementation commit: `5556f33b54085482bf5627a5b9b61997a6084595`
Package content SHA-256: `2fd0ac27225c337a60002f4ece1f177234cfad06f5a918bb75dce6c5cbb9d702`
Package files: `481`
Package content bytes: `6254467`
Archive SHA-256: `c539fb990257b7aa3af53e07b2adf2a5b6b60d3ccb6d78217176eed44ba84c7b`

Windows 上独立安装 `npm pack` 生成的候选包。Codex 和 OpenCode 从各自的个人级入口发现并实际加载 Init Skill，在带空格路径的单仓调用已安装 CLI，分别收到待审批的最小计划。宿主原生调用由本地确定性模型驱动，两个单仓的共享配置均保持未写入状态。

在隔离的单仓和三仓项目中用已安装 CLI 读取请求并回传测试批准。CLI 生成最小配置、OpenSpec Store 和所选宿主的两个 Workspace 入口。两个项目均以空 Profile 启动 Run 并到达 Open。实验用 Git 远端位于本机。

[验收回执](acceptance-receipt.json) 记录当前包身份、原生宿主请求和两个启动的 Run。[完整变更验证报告](../../docs/superpowers/reports/simplify-workspace-init.md) 记录 Build、Verify 和 Archive 验收。

首次验收后修复了测试的 JSON 类型检查。从记录的提交重新打包，归档字节和包内容摘要均与宿主验收时一致。
