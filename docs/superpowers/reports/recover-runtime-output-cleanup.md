# 运行时输出清理恢复验证报告

`recover-runtime-output-cleanup` 覆盖 Build Configure 的 Git 跟踪检查，以及已有 Build Run 的受限 Workspace checkpoint 恢复。

[安装包和验证报告](../../../verification/recover-runtime-output-cleanup/verification-report.md) 记录基线复现、Windows 安装包、并发和中断回归。[三仓验收收据](../../../verification/recover-runtime-output-cleanup/acceptance-receipt.json) 记录冷进程调用、原 Plan、首包完成事实和 Verify 结果。

独立审查确认，恢复只接受当前绑定的 Workspace 直接前驱上的纯清理提交。同一待执行包取得绑定新 checkpoint 的 Work。已经完成的包、原审批和 Plan 保留。唯一允许的未暂存 Tasks 更新必须能用已接受的包完成事实和 Git 文件内容重建。

Comet 使用 `npm.cmd run verify` 执行完整产品验证，并在当前 Change Run 记录收据。
