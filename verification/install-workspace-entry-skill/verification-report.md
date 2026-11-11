# Workspace 入口 Skill 安装包验收

Tested implementation commit: `6d5e5c2bdc841dd1fea0a90aef14dacf9a147677`

Package content SHA-256: `a1e9b5c154b9e2ef79018529f21ac479a5b766155658839ce82b30badf9720a1`

Package files: `479`

Package content bytes: `6189597`

Archive SHA-256: `b17754b77f6c477662a047959ce21693b869d6ab35b50747a0f4ced9e429bcfa`.

从该提交的 Git 源码快照生成 CLI 与 Desktop 产物，打包后在独立目录安装，核对 CLI 版本和入口资产。包内容身份使用排序后的 tar 文件路径和内容摘要计算。

[宿主验收回执](acceptance-receipt.json) 记录 Windows 真实 Codex、OpenCode 和三仓 Run 的实际验证。完整包包含同一 CLI 实现和入口 Skill。 [正式验证报告](../../docs/superpowers/reports/install-workspace-entry-skill.md) 记录场景和检查。
