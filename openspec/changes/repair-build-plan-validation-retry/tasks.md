# Tasks

## 1. 固定根因与提交状态模型

- [x] 1.1 增加失败回归测试：缺少 Task 的 `build-plan-candidate` 被提前绑定为终态 Outcome 后，原 Work 无法提交修正版且 Run 永久阻塞。
      **Acceptance:** 测试明确区分 Host submission、accepted Action Outcome 与 lifecycle Plan acceptance，不以新 Work或手改 Store恢复
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正
- [x] 1.2 为 WorkExecution checkpoint 增加有界 rejected submission 模型、独立 `submissionId`、payload digest 与幂等/conflict 规则。
      **Blocked by:** 1.1
      **Acceptance:** 同 ID 同 digest 幂等、同 ID 不同 digest 冲突；拒绝历史不可覆盖且达到上限时 fail closed
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正

## 2. 修正 Outcome acceptance boundary

- [x] 2.1 重构 Managed Work 执行顺序：Host 返回只记录 submission，当前 Work result validator 通过后才绑定 Action Outcome、receipt 与 validator fact。
      **Blocked by:** 1.2
      **Acceptance:** `markHostCompleted/acceptOutcome` 不再早于 Work result validation；Host/Agent 不能指定 Validator或 continuation
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正
- [x] 2.2 将 Build Plan result kind、candidate 创建、Plan validation、lifecycle Validator 与冻结身份检查接入 acceptance boundary。
      **Blocked by:** 2.1
      **Acceptance:** candidate/schema/Validator 拒绝保持原 workId、claim、attempt、checkEpoch、invocation 和 packet；不创建新 Plan Work
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正
- [x] 2.3 为外部与嵌入式 Host 实现纠正协议：返回 `awaiting-correction`，新 submission identity 可纠正，Runtime 不自动重放 Host 副作用。
      **Blocked by:** 2.2
      **Acceptance:** 修正版通过后只产生一个 accepted Outcome；旧 invocation 之外的提交与同 ID 改内容均被拒绝
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正

## 3. 恢复、遥测与交付

- [x] 3.1 实现预修复卡住 Plan Run 的显式兼容恢复，保留旧 Outcome 为 rejected submission，并恢复同一 Work 的 correction 状态。
      **Blocked by:** 2.3
      **Acceptance:** 真实旧 checkpoint fixture 可幂等恢复；身份不兼容或无法重现确定性拒绝时进入 `migration_required`
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正
- [x] 3.2 增加重启与遥测测试，覆盖 submitted/rejected/corrected/accepted/processing-error，确认自由文本和 identity 不进入 Metric label。
      **Blocked by:** 3.1
      **Acceptance:** rejected history、claim 与 correction 能力跨重启保留；Dashboard/OTLP 可还原纠正次数和最终结果
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正
- [ ] 3.3 运行严格 OpenSpec、相关 Vitest、typecheck、lint、generated/architecture/provenance 检查和完整 `npm run verify`；更新验证证据并清理临时文件。
      **Blocked by:** 3.2
      **Acceptance:** 所有命令通过，分支提交均已推送，当前 desktop Run 可通过受控恢复继续而无需 Store 手术
      **Requirements:** managed-work-execution#被校验拒绝的-host-submission-必须保持当前-work-可纠正
