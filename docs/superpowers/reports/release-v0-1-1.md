# v0.1.1 验证与发布准备

本地真实消费证据及独立审查处置见 `verification/release-v0-1-1/verification-report.md`，绑定实现提交 `c4d8b6779ab487c6ee04024d2b736615d8e4a3a5`，候选内容摘要 `e9602b537ce81e6d636deb287d58ad57e0eb1f872a06d5c2c69f6b38eb5d1961`。

已验证产品版本、默认与显式覆盖的遥测资源、三个 Scope、安装包 CLI、实际 npx 三类调用和真实 Windows PTY 初始化。独立审查发现的 public-smoke 来源不一致已有失败契约回归，固定目标提交后通过并复核关闭。

当前报告不声明后续完整 Guard、CI、归档或公开 Release 已完成。Build 使用精确 `npm.cmd run build`，Verify 使用精确 `npm.cmd run verify`；之后只有成功 main CI 的目标提交及通过 Windows 候选验收的同一工件可以发布。以同一 Comet Run 的真实收据和远端 Release 回执报告最终状态。
