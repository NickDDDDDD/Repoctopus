# Build 工作区恢复验证

## TDD 失败证据

2026-11-07，从主线 `9da1d47` 加入生产组合回归。实验场景通过公开 CLI 创建 Run，随后准备业务分支，完成 Configure、Plan 和第一个工作包，关闭当前应用后在新进程执行公开 `run resume`。

执行 `node_modules/.bin/vitest.cmd run test/managed-change-execution.e2e.test.ts -t 'autonomous mode with two'`，用时约 40 秒。测试在保留的 Run 中断言 `state.reconciliationRequired` 为 false 时失败，实际为 true。测试此前已经核对原 Binding、Plan、工作包和 workspace checkpoint 保留，复现的是错误的恢复分类。

## 后续验证

最初的生产两仓场景在修复后通过，实际覆盖新进程恢复、未授权分支阻断、切回后继续，以及完整生命周期。随后独立分段审查指出无关阻塞归属、规划失效与分支漂移同时发生，以及并发恢复的事务边界问题。对应修复增加连续恢复、过期观察、Host 启动与恢复 transition 阻塞测试，相关 79 项定向回归通过，TypeScript 与定向 ESLint 检查通过。

执行中 checkout 变化也交回共同判定。新增生产组合回归分别在 claim 前、Host 返回前切到未授权分支，验证原 Plan、checkpoint 和 pending submission 保留。自主两仓、子 Agent 两仓和跨进程隔离恢复场景通过。扩展用例最初改变了单仓及 protected 分支场景的准备顺序，造成三项夹具失败；修正准备顺序后，对这三项重新定向执行并全部通过。六项生产组合场景均已有实际通过记录，产品实现保持固定候选 `a26e1c3`。

## 设计与审查

独立实现审查提出的 P1/P2 已在固定候选 `a26e1c3` 复核关闭。回归包含重复恢复不清除无关阻塞、旧观察不覆盖新冲突、已领取 Work 的 Host 启动仍受最新阻塞约束，以及旧规划观察不能跨越新冲突应用返工。新进程恢复入口与后继 Configure 路径均使用共同工作区判定。

MODIFIED requirement 的重复描述移入已有场景后，原需求描述保持 483 字，避免归档后超过 OpenSpec 主规格的 500 字限制。使用公开 Comet `revise-design`、提案、审批与 complete-design 刷新同一 Run 的设计检查点，沿用用户已批准的行为和执行配置。Comet 自动保留原 autonomous、TDD、thorough 配置，随后重新提交原任务映射计划。

## 补充检查

TypeScript、定向 ESLint、架构边界、第三方来源和生成物校验通过。附加的全仓 `format:check` 返回 162 个格式告警，涉及未修改的历史源码、归档及 Comet 生成文件；它不属于仓库 CI 的 `verify` 命令。当前修改的源码与手写规格单独通过格式检查，未批量改写历史归档或 Runtime 生成内容。

真实多仓验收、最终独立审查和正式验证结果将在实际执行后补充。
