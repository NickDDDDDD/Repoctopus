# Workspace 本地引导 Verify

[安装包验证报告](../../../verification/align-workspace-onboarding-guides/verification-report.md)记录固定候选的单仓与多仓接入、新成员登记、CodeArts 补装、旧文档刷新、SigNoz JSON 及 Windows 与 Linux 包内容一致性。

OpenSpec 四类产物完整，6 项任务均已确认。真实安装包与回归测试覆盖该 Change 的五个场景。独立审查复核实现提交 `911938a`、命令参数与文件边界，文档缺口已修复并复核。完整项目门禁通过 Comet Guard 执行，结果由该 Run 的 Verify 收据记录。

首轮完整 Verify 有 1242 项通过、4 项跳过和 1 项失败。工作区使用 `npm ci --ignore-scripts` 后缺少 Electron 可执行文件，桌面测试返回 `development-artifact-missing`。运行 `npm run desktop:prepare` 后，原桌面激活文件的 2 项测试均通过。候选实现与包内容一致，沿原 Run 重放项目门禁。
