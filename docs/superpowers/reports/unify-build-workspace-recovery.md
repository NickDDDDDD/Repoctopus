# Build 工作区恢复验证

发布包身份与可复现输入见 [产品包验证报告](../../../verification/unify-build-workspace-recovery/verification-report.md)。本文件作为 Comet Verify 入口，产品包报告供仓库既有包内容检查使用，共用同一组原始验收证据。

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

## 安装包真实多仓验收

使用固定产品提交 `a26e1c3146cb81b618ce85ee1f8d3a743a27d89c` 构建并安装 tarball，SHA256 为 `47acb61b60e965fec61421d382343de6b2ff311896812eaba34331d0a59038dd`。独立验收包含 Workspace、web-front、backend、web-design、web-plugin 五个真实 Git checkout。两项业务工作仅向 web-front 和 backend 的 README 各增加一行验收标记，两个 Node 精确整行断言均有真实 RED=1、GREEN=0 和 regression=0。

| 核对项         | 实际结果                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run            | `verify-build-workspace-recovery-20261107-r2`，唯一标识后缀 `fdfbcf36b8971b4a`；完整标识保存在外部原始报告及命令记录中                                                          |
| Binding        | `execution-binding:e368421704a4a93ba68b040b`，revision 1                                                                                                                        |
| Plan           | `build-plan:c8ff44f51476afe7141e592e`，revision 1                                                                                                                               |
| 新进程正常恢复 | 首包后六次独立 CLI 进程，覆盖 resume/next 调换顺序与重复调用，完整 Strategy、Binding、Plan、checkpoint、completion 和下一 Work 保持一致，进度仍为 1/2                           |
| 未授权分支     | 已推送的 `acceptance/unauthorized-build-recovery-20261107-r2` 下，四次独立 resume/next 均返回 reconcile 和 `runtime.project-changed`，原执行权威保持不变                        |
| 切回           | 切回原绑定分支后，三次独立 next/resume 保持 1/2 和原下一 Work，随后接受第二包，进度成为 2/2                                                                                     |
| 无重放         | 两个 execute Work 的 claimed、host-started、host-completed、outcome-submitted、outcome-accepted 和 completed 事件分别都只有一次；首包完整 completion 和 web-front HEAD 保持不变 |
| Git 发布       | Workspace、web-front、backend 的本地与远端源分支 SHA 分别精确相同                                                                                                               |
| 原现场         | 原验收 Store 前后均 140 个文件，逐文件哈希差异为空，五仓 HEAD 和 clean 状态保持原样                                                                                             |

完成后的业务提交为 web-front `477d1d0535ca9d3d0683c0ea7e1cc0d58c0f4d49`、backend `34f643e907bb09204c24591244dc13658f065fdd`。独立 Evidence profile 的两个实际命令均通过，bundle 为 `fcbad0055cd2169d095abd2e2661df22b6149ec9adf000e335428bc5b2267c9a`。

该真实专项停在尚未领取的 `build.check:f6a70813b606`，保留后续复验现场。上述 Evidence profile 结果没有被当作这个测试 Run 已通过 lifecycle Verify 或 Archive 的证明。完整五阶段链路另由生产组合回归验证。

详细证据保存在外部独立验收目录的 `round2/evidence`，包含 command-ledger、新进程恢复矩阵、published refs、accepted-authority-summary、package-no-replay-events 和 original-site-integrity。同目录的 `verification-report.md` SHA256 为 `f7ed529ed76ed3b770293f4393fa55ea8c63c356f3fe8874b59316ce29ec2bc5`，记录完整 Run 标识和证据路径。首次夹具错误使用了不支持的 `git grep -x`，exit 129 已保留并判为无效 RED；改用 Node 断言后创建全新 Run 重跑，旧 Run 不作为成功基线。首包一次 GitHub 连接失败通过重试原 push 恢复，未重做已完成改动。

## 规格与设计核对

两个 MODIFIED requirement 的全部场景均已对应实现或现有回归。当前绑定与进度判定、精确授权的 Configure 路径、未授权分支阻断和原执行断点恢复分别由领域、生产组合和真实安装包验收交叉验证。独立代码审查的 CRITICAL/IMPORTANT 问题为零，当前范围的检查结论合格。

正式集成检查命令为 `npm.cmd run verify`，最终结果以同一 Comet Run 的 Verify Guard 真实检查收据为准。

首轮正式检查通过 196 个测试文件、1025 项测试，另有 1 个文件、3 项测试按既有条件跳过。随后架构检查发现本报告中的外部实验仓名称命中了旧工作流名称禁用规则，命令返回 1。报告改用唯一 Run 后缀和原始报告哈希定位外部证据，原记录未修改，架构规则未放宽；修正后重新执行正式检查。

Windows 的 Guard 使用公开 `comet.cmd` 入口传递完整命令参数。可选的实验 npm 内部缓存日志清理被自动审批检查以 `blocked by policy` 拒绝，未执行删除；缓存日志与全部验收证据保留，产品和原现场没有新增 scratch 或调试日志。
