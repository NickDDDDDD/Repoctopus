# Build 工作区恢复验证

## TDD 失败证据

2026-11-07，从主线 `9da1d47` 加入生产组合回归。实验场景通过公开 CLI 创建 Run，随后准备业务分支，完成 Configure、Plan 和第一个工作包，关闭当前应用后在新进程执行公开 `run resume`。

执行 `node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts -t 'autonomous mode with two'`，用时约 40 秒。测试在保留的 Run 中断言 `state.reconciliationRequired` 为 false 时失败，实际为 true。测试此前已经核对原 Binding、Plan、工作包和 workspace checkpoint 保留，复现的是错误的恢复分类。

## 后续验证

最初的生产两仓场景在修复后通过，实际覆盖新进程恢复、未授权分支阻断、切回后继续，以及完整生命周期。随后独立分段审查指出无关阻塞归属、规划失效与分支漂移同时发生，以及并发恢复的事务边界问题。对应修复增加连续恢复、过期观察、Host 启动与恢复 transition 阻塞测试，相关 79 项定向回归通过，TypeScript 与定向 ESLint 检查通过。

执行中 checkout 变化也交回共同判定。新增生产组合回归分别在 claim 前、Host 返回前切到未授权分支，要求原 Plan、checkpoint 和 pending submission 保留。包含这两项场景的完整生产组合回归正在执行，不能用此前通过结论代替。

真实多仓验收、最终独立审查和正式验证结果将在实际执行后补充。
