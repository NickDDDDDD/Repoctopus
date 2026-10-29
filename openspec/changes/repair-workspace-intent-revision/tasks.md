# Tasks

## 1. 固定真实故障与错误契约

- [x] 1.1 增加 Open 决策回归：linked worktree 选择 `current` 时在任何 lifecycle/approval 写入前失败。
      **Acceptance:** 失败夹具证明 Run 仍处于同一 Open wait，Specification approval 仍 awaiting，且没有持久化 `workspaceIntent`
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订
- [x] 1.2 增加 Build Configure 回归：已有坏 intent 在 binding 时只抛错且无法重启同一确定性 Run。
      **Acceptance:** 失败夹具复现同一 runId 被恢复、Build Work 永久阻塞以及旧 Outcome 仍被投影为当前 checkpoint
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订; managed-work-execution#intent-修订必须同步退役不匹配的-execution-checkpoint

## 2. 建立受保护的 intent 修订状态机

- [x] 2.1 为 Execution Workspace binding 增加稳定错误类型及 `intent-revision | binding-retry | halt` 恢复类别，不让编排层解析消息文本或复制 code 策略表。
      **Blocked by:** 1.1
      **Acceptance:** `current-linked-worktree` 要求 intent revision；可在原意图下修复的 checkout/branch/ownership facts 要求 binding retry；remote identity 与 topology drift 要求 halt
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订
- [x] 2.2 增加 `workspace-intent-revision-required` 与 `workspace-intent-revised` 领域 observation/transition，严格限制在未批准 Build Configure 边界。
      **Blocked by:** 1.2, 2.1
      **Acceptance:** 纯领域测试一次得到 Build→Open wait，再由可信决定得到 Open→Design + 新 intent + 新 Work；Tasks、Build/Verify/Archive 下游输入全部清除
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订
- [x] 2.3 在 Coordinator 的同一 Run CAS 中退役与新 current Work/epoch 不匹配的 `workExecution` 并保留历史 trajectory。
      **Blocked by:** 2.2
      **Acceptance:** intent revision commit 后旧 Build Configure checkpoint 不在 Run state；旧 claim/Outcome/Receipt 事件仍可审计且不会重放 Host
      **Requirements:** managed-work-execution#intent-修订必须同步退役不匹配的-execution-checkpoint

## 3. 接通 Open、Build 与 Human Decision

- [x] 3.1 Open approval 在写 lifecycle 和 Specification approval 前绑定验证候选 intent，无效选择保持原 request 可重试。
      **Blocked by:** 2.1
      **Acceptance:** 无效选择对两个权威 Store 都是零写入；改选 worktree 后同一 request 可以成功
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订
- [x] 3.2 Build Configure 捕获可修订 binding error 并提交单次 Open wait；不可修订身份漂移继续阻断。
      **Blocked by:** 2.2, 3.1
      **Acceptance:** 仅 `recovery=intent-revision` 返回稳定且幂等的 Open wait；binding retry 保留原 intent，remote identity/topology halt 不提供误导性的 isolation 修订
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订
- [x] 3.3 CLI 与 Service 接受新的可信 isolation 决策，重新验证后创建 Design Work；无效或拒绝决定不推进。
      **Blocked by:** 2.3, 3.2
      **Acceptance:** CLI 复用 `DecideChangeRunInput.isolation` 并显示旧 isolation、错误分类与三个候选模式；无效选择零 transition且可重试，批准后同一 runId 进入 Design且需普通 Design gate
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订
- [x] 3.4 统一外部 Runner 的 Build Execute Outcome 消费，使成功与失败 submission 都经过接受、验证或 finding recovery，而不依赖旧内嵌 Host 投影。
      **Blocked by:** 3.3
      **Acceptance:** `submitted/succeeded` 仅在 Runtime 接受并通过 validator 后完成 package；`submitted/failed` 的 finding 被接受并驱动正式 recovery；重复 `next` 与重启不重复完成 Task、Outcome 或 Receipt
      **Requirements:** managed-work-execution#外部-build-execute-outcome-必须经过统一的两阶段消费
- [x] 3.5 为本次受保护 lifecycle/Runtime 语义建立精确的活动 Run adoption contract。
      **Blocked by:** 3.4
      **Acceptance:** builtin catalog 只接受当前活动 Run 直接前驱的精确 code/descriptor digest pair；definition、validator、extension contributor 只声明直接前驱 version；任意未声明 digest/version 仍返回 `migration_required`
      **Requirements:** managed-work-execution#活动-run-必须通过精确-adoption-contract-采纳新的受保护语义

## 4. 遥测与端到端验证

- [x] 4.1 为 binding failure、intent revision 和 execution retirement 增加 trajectory/OTLP 有界事实与契约测试。
      **Blocked by:** 2.3, 3.5
      **Acceptance:** trace 可解释 from/to phase、error code、isolation 与 retirement；Metric label 不含路径、branch、digest、错误文本或 run/work/change identity
      **Requirements:** development-telemetry#workspace-intent-修订必须可观测且保持低基数
- [ ] 4.2 修复 Open orchestration 对 intent-revision 子状态的错误推进，并增加跨进程 E2E，完整复现当前自举故障且证明同 Run 从错误 current 恢复为 worktree Design Work。
      **Blocked by:** 4.1
      **Acceptance:** `workspace-intent:*` wait 上重复 `run next` 保持同一 waitId/checkEpoch且不生成 `open-approval:*`；重启前后 runId 唯一，旧 Build Configure Work 不复活，无效/重复 decision 幂等且无需编辑 Store
      **Requirements:** change-lifecycle#execution-workspace-intent-必须可验证并可在同一-run-修订; managed-work-execution#intent-修订必须同步退役不匹配的-execution-checkpoint; managed-work-execution#外部-build-execute-outcome-必须经过统一的两阶段消费; managed-work-execution#活动-run-必须通过精确-adoption-contract-采纳新的受保护语义
- [ ] 4.3 运行 strict OpenSpec、相关 Vitest、typecheck、lint、architecture/provenance/generated 检查和完整 `npm run verify`，更新正式验证报告并清理临时输出。
      **Blocked by:** 4.2
      **Acceptance:** 所有命令通过，分支每次提交均已 push，Store registration 最终恢复到当前主开发 worktree且临时文件已清理
      **Requirements:** development-telemetry#workspace-intent-修订必须可观测且保持低基数
