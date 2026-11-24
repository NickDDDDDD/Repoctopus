# 桌面工作流引导验证

[验证报告](../../../verification/improve-desktop-workflow-guidance/verification-report.md)记录产品包内容摘要、Windows 安装器身份、测试结果、独立审查与接受范围。

- 完成 6/6 项任务。四类 OpenSpec 产物完整，严格校验 16/16。
- `npm.cmd run verify` 预检为 1322 项通过、4 项跳过，后续检查全部通过。
- 最终候选 CLI 在真实三仓从 Init 到 Archive，通过冷恢复、发布响应丢失去重与终态恢复。独立返工验收只重新执行受影响的后端包。
- Windows 安装器回放核对 Design 待审、进入 Build、1/2 进度、Verify 返工、归档终态、键盘可见焦点、窄窗口和高 DPI。安装、单实例、托盘、退出、卸载与注册表恢复均通过。
- 独立审查的问题已修复。包含通过实际观测构造器的恢复回归和部分历史中当前动作隔离。桌面通过本地 OTLP 回放验收，复制交互的操作系统接收端由夹具代替。
