---
change: preserve-completed-run-recovery
design-doc: openspec/changes/preserve-completed-run-recovery/design.md
base-ref: c872b4080d8336d2440410e28e482fce98423464
archived-with: 2026-11-08-preserve-completed-run-recovery
---

# 已完成 Run 恢复实施计划

<!-- comet-task-authority: openspec/changes/preserve-completed-run-recovery/tasks.md -->

配置：autonomous + TDD + thorough；沿用当前 worktree。任务正文和完成状态只保存在上方 tasks.md；本计划描述实施顺序与验证方法。

## 第一组：可信终态与公开恢复

<!-- comet-task-ref:b5c2b368-cbb9-4c8c-a0d7-bc9e4a94fb24 -->

核对现有 `projectCommittedContinuation`、coordinator status 和 Comet 终态规则。新增完整状态在历史 reconciliation 标志下仍应 done 的回归，先运行并保存预期失败，再修正 coordinator 的终态投影。来源记录引用固定 Comet commit 和已核对的 source hash，不复制上游 SDK。

<!-- comet-task-ref:a0c16dfa-ff64-4525-957a-ce30ed37979d -->

新增 completed Service/coordinator 冷恢复回归：真实分支与 HEAD 已偏离启动快照，两个顺序均应保持终态和全部完成事实。先确认原行为失败，再在 Store 验证/必要恢复之后、活动定义和工作区恢复之前分派可信终态，并修正 CLI resume envelope 的独立旧标志覆盖。

<!-- comet-task-ref:02df3761-54be-436d-8039-74ba735841cc -->

在同组测试中覆盖必要文件缺失、损坏、Run/Checkpoint 不一致和未结 Journal；运行活动 Build/Evidence、未授权 checkout 和未知执行结果回归。终态路径不能跳过持久状态验证，也不能扩大活动 Run 的授权。

<!-- comet-task-ref:4e285ec2-43ac-4141-9f17-638e331b3219 -->

更新 `docs/runtime-state.md` 和上游采用说明，记录公开恢复行为、历史诊断与独立交付影响审查的关系；校验命令、来源和 delta spec 一致。

## 第二组：生产入口与真实多仓验收

<!-- comet-task-ref:febd29aa-0a2a-42ec-8811-02bed759014b -->

以正式完成事实和真实 Git 多仓构造 CLI 新进程矩阵；对 resume→next 与 next→resume 检查完整 envelope、execution、next actions、回执和计数。先证明旧通用恢复仍能被该矩阵捕获，避免把 fixture 的 completed 值本身当作验收结论。

<!-- comet-task-ref:9fdc85bf-d195-4f80-b38e-716ddde41be0 -->

从当前固定产品提交构建独立 npm 安装包，在新实验目录运行小型两包任务并正式关闭、发布；保持原实验 Store 和报告哈希，沿公开命令验证正常和旧受影响终态。所有分支建立即 push、所有 commit 后 push；仅在独立实验基线上创建 MR，不合入它们。

<!-- comet-task-ref:6917c193-28ac-4b98-a9b0-2710ce46e4c9 -->

按风险运行聚焦测试，再执行 `.comet/check-policy.json` 声明的精确 `npm.cmd run verify` 和生成物检查；需要真实外部验证的步骤单独保存结果，不把本地检查收据扩展为远端证明。保留 RED/GREEN、命令和退出码。

<!-- comet-task-ref:8221a7e6-a84b-48c0-894f-093c56a3371d -->

thorough 分段审查覆盖恢复边界，最终 Verify 独立审查只针对完整候选一次。解决重要 finding 后完成正式验证报告，固定生成物和报告，再取得绑定当前输入的最终检查证据。

## 风险与停止条件

## Verify 反馈的范围内修复

<!-- comet-task-ref:a0c16dfa-ff64-4525-957a-ce30ed37979d -->

真实 CLI 的 resume 不能在 Service 判断终态之前强制探测当前 checkout。将活动观察留给既有 Service 的 projectInput；completed 无需当前观察即可返回持久终态，没有实际观察时省略 reconciliation，不伪造当前与启动快照相同。调用者已提供的实际 snapshot 仍保留真实差异。补齐业务目录移走后的完整 CLI 恢复负例和活动 Run 缺失 checkout 的阻断正反边界。

<!-- comet-task-ref:02df3761-54be-436d-8039-74ba735841cc -->

可信持久终态使用已有 hashWorkflowDefinition 重算存储 Workflow 正文摘要；正文损坏但标签未变必须拒绝，不能只比较两个摘要标签。先执行实际 RED，再修复并由同一最终 reviewer 仅复核这两项和新增风险；不重复建立最终集成审查或要求配置批准。

持久完成事实不可验证、资料冲突、外部结果未知或必须改变已批准范围时停止相应动作，沿当前 Comet Run 处理。不得手改产品 Store、清除旧错误标志、改写启动快照或静默重放远端动作。普通范围内失败先定位并修复；Windows 长路径等独立问题仍保留在范围之外。
