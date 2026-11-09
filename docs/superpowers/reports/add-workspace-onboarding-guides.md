# Workspace 初始化引导验收

本 Change 的安装包与针对性验证事实记录在 `verification/add-workspace-onboarding-guides/verification-report.md`，对应候选内容摘要为 `da55bf6bff556ffd71f6c891f23156df95cab80b3063708edcfb65d68b446af3`。

已验证：获批接入生成三份本地引导；单仓原始团队文本保持；拒绝审批无共享文件副作用；损坏标记、文件身份、路径、UTF-8 及整组物化检查；原请求中断恢复；指定候选 tarball 生产安装后的公共 CLI 协议；真实 Windows PTY 的批准、拒绝与教程原始启动/恢复代码；既有团队补齐引导时公共 Run state 保持。

独立 Build 审查的两个 P2 已通过真实 RED→GREEN 和独立复跑关闭。最终集成审查与正式完整检查由本次执行的实际记录核对；Build Guard 运行 policy 声明的 `npm.cmd run build`，Verify Guard 运行标准完整验收 `npm.cmd run verify`，不以手写报告代替 Guard 收据。此报告不声明未发生的 CI、归档、合入或公开发版。
