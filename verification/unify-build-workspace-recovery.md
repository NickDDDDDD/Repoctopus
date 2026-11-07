# Build 工作区恢复验证

## TDD 失败证据

2026-11-07，从主线 `9da1d47` 加入生产组合回归。实验场景通过公开 CLI 创建 Run，随后准备业务分支，完成 Configure、Plan 和第一个工作包，关闭当前应用后在新进程执行公开 `run resume`。

执行 `node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts -t 'autonomous mode with two'`，用时约 40 秒。测试在保留的 Run 中断言 `state.reconciliationRequired` 为 false 时失败，实际为 true。测试此前已经核对原 Binding、Plan、工作包和 workspace checkpoint 保留，复现的是错误的恢复分类。

## 后续验证

实现后的自动回归、真实多仓验收、独立审查和正式验证结果将在实际执行后补充。
