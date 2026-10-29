# Tasks

## 1. 固定缺陷与领域错误边界

- [ ] 1.1 增加 Service 回归测试：Host 提交未覆盖全部 Task 的 `build-plan-candidate` 后，当前实现会保留旧 Outcome 并永久卡在同一 Plan Work。
      **Acceptance:** 测试明确区分“Outcome 已知但 candidate 被拒绝”和 Host unknown/reconcile，不以手改 Store恢复
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work
- [ ] 1.2 新增 `BuildPlanCandidateRejectedError`，让 `createBuildPlan()` 的候选 schema、引用、覆盖、依赖与边界错误可识别，未知程序错误保持原样。
      **Blocked by:** 1.1
      **Acceptance:** 领域测试覆盖空计划、缺 Task、未知 Task/acceptance、非法 scope、重复/环依赖，均可被精确识别
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work

## 2. 实现 Runtime-authoritative Plan 重试

- [ ] 2.1 提取统一的 Build Plan retry helper，固定 Action、配置、仓库、Skill 与输入 identity，并生成新的 `workId/checkEpoch/actionAttempt`。
      **Blocked by:** 1.2
      **Acceptance:** Host drift 与 candidate rejection 共用安全物化路径，调用方不能指定其他 phase/Action/配置
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work
- [ ] 2.2 将候选创建错误、Plan validation 拒绝和 lifecycle Validator 拒绝映射为新 Plan Work，保留旧 claim/invocation/outcome，不捕获 Store、Provider 或未知异常。
      **Blocked by:** 2.1
      **Acceptance:** 三类确定性拒绝均可重试；模拟未知异常仍向上失败且不创建 Work
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work
- [ ] 2.3 记录有界 retry reason、旧 Work identity、transition、Trajectory 与 OTLP 事件，Metric 不使用自由文本或高基数 identity。
      **Blocked by:** 2.2
      **Acceptance:** Dashboard/OTLP 可区分 `candidate-invalid` 与 `validator-rejected`，敏感路径和完整异常不进入 Metric
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work

## 3. 恢复验证与交付

- [ ] 3.1 增加进程重启测试：拒绝后只可领取新 Plan Work，旧 invocation 重放/不同 Outcome 被拒绝，完整候选通过后正常进入 Plan Evidence/Execute。
      **Blocked by:** 2.3
      **Acceptance:** 测试跨关闭/重启验证 immutable Outcome、单一 current Work、递增 attempt/checkEpoch 和后续 Action
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work
- [ ] 3.2 运行严格 OpenSpec、相关 Vitest、typecheck、lint、generated/architecture/provenance 检查和完整 `npm run verify`；更新正式验证报告并清理临时文件。
      **Blocked by:** 3.1
      **Acceptance:** 所有命令通过，分支提交均已推送，验证记录只包含可复现证据
      **Requirements:** managed-work-execution#无效-build-plan-candidate-必须生成新的-plan-work
