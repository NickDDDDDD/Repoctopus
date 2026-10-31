# Tasks

## 1. 固定 Open 死路与 Comet 不变量

- [ ] 1.1 增加真实自举回归：Open Host Outcome 成功，但 Provider 因 Task Acceptance 缺失返回 strict invalid，当前实现进入 `open/blocked/currentWork=null`。
      **Acceptance:** 红测精确证明 projection 虽显示 `open.repair`，但 `run next/resume` 无法产生可领取 Work；失败不是由测试夹具、Store 注册或 Host capability 引起。
      **Requirements:** change-lifecycle#open-校验失败必须形成可执行恢复回环; specification-authority#open-evidence-必须在人工决定前被当前-provider-接受
- [ ] 1.2 增加批准后漂移与 Provider unavailable 回归，分别固定“必须回到 Open Work”和“不得盲重放 Host”的边界。
      **Acceptance:** 红测证明批准摘要变化当前只刷新审批而没有重新执行 Open，Provider 抛错时旧 Outcome和 invocation必须保持不变。
      **Requirements:** change-lifecycle#open-校验失败必须形成可执行恢复回环; specification-authority#open-批准后必须重新观察当前规划摘要

## 2. 建立原子 Open repair transition

- [ ] 2.1 在 change lifecycle 中加入 revision-bound `open-repair-required` observation和同阶段 transition，要求新的 `change.intake` Work、递增 epoch并清除旧 wait/blocker/approval digest。
      **Blocked by:** 1.1
      **Acceptance:** 领域矩阵覆盖四种确定性来源、陈旧 revision、错误 phase/kind/epoch和重复 observation；任何成功 reduction 都是 `open/running/currentWork=repair Work`。
      **Requirements:** change-lifecycle#open-校验失败必须形成可执行恢复回环
- [ ] 2.2 复用 Coordinator 的通用 execution retirement，在同一 Run CAS 中替换 lifecycle Work并退役旧 Open checkpoint，保留历史事实。
      **Blocked by:** 2.1
      **Acceptance:** transition 后当前 Run 只有新 Work/epoch，trajectory 仍可读取旧 claim、submission、Outcome、Receipt和 Validator；不存在 Open 专用删除路径。
      **Requirements:** managed-work-execution#open-repair-必须原子替换当前-execution

## 3. 编排 Provider Evidence 与批准后重验

- [ ] 3.1 让 Open Provider观察返回有界 `accepted | invalid | unavailable` 分类，只有成功返回的工件、strict validation或 Validator拒绝可进入 repair。
      **Blocked by:** 1.2
      **Acceptance:** Provider/Store 未知错误保留同一 Work、Outcome、attempt和 invocation并产生 reconciliation；确定性 invalid 携带有界来源与 Evidence identity。
      **Requirements:** specification-authority#open-evidence-必须在人工决定前被当前-provider-接受
- [ ] 3.2 在 `validateOpenWork` 与 Open gate 中物化 repair Work并以单次 observation提交，不再产生 `open.invalid/currentWork=null`。
      **Blocked by:** 2.2, 3.1
      **Acceptance:** 缺失工件、strict invalid、manifest invalid和 lifecycle Validator拒绝均返回可领取的 `change.intake`，重复 pull不重复创建 Work或调用 Host。
      **Requirements:** change-lifecycle#open-校验失败必须形成可执行恢复回环; managed-work-execution#open-repair-必须原子替换当前-execution
- [ ] 3.3 在可信 Open 决定后执行只读摘要重验；匹配才进入 Design，漂移或确定性失效回到 repair Work，未知结果保持 reconciliation。
      **Blocked by:** 3.1, 3.2
      **Acceptance:** 测试覆盖批准后无变化、有效摘要漂移、strict invalid、Provider unavailable和旧 Runner提交；只有完全匹配批准身份的路径创建 Design Work。
      **Requirements:** specification-authority#open-批准后必须重新观察当前规划摘要

## 4. 恢复、投影与遥测

- [ ] 4.1 移除无生产入口的推断式 `open.repair`，让 status/Desktop只显示持久化 repair Work、Human Decision或 reconciliation。
      **Blocked by:** 3.2
      **Acceptance:** projection测试证明每个显示动作都有对应 Run checkpoint和可调用入口；遗留死状态只报告不可恢复诊断，不伪造 Work。
      **Requirements:** managed-work-execution#open-repair-必须原子替换当前-execution
- [ ] 4.2 增加冷启动、并发 Runner、重复 `run next/resume` 和相同摘要恢复测试。
      **Blocked by:** 3.3, 4.1
      **Acceptance:** 同一 Run在重启前后只有一个当前 repair Work；CAS loser重读权威状态，重复 pull不增加 epoch、Host invocation或审批请求。
      **Requirements:** managed-work-execution#open-repair-必须原子替换当前-execution
- [ ] 4.3 为 Evidence拒绝、repair派发、批准后漂移和恢复增加 trajectory/OTLP 低基数事实与契约测试。
      **Blocked by:** 3.3
      **Acceptance:** Trace可关联旧新 Work/epoch和 retirement，Metric labels不含 digest、路径、自由文本、changeId、runId、workId或个人身份。
      **Requirements:** development-telemetry#open-evidence-恢复必须形成可重放观测事实

## 5. 自举验收与交付

- [ ] 5.1 用本 Change 的正式 Run重放 `invalid → repair Work → valid → Open Human Decision → post-approval revalidation → Design`，并验证真实 Skill delivered/consumed telemetry。
      **Blocked by:** 4.2, 4.3
      **Acceptance:** 不编辑 Run Store、不创建第二个 Run；Trajectory逐步证明 Provider Evidence、repair Work、可信决定、重验和转换，Action Skill与 augmentation正文均真实交付；所有受影响的 protected lifecycle/Runtime contributors 只登记该 Run 的精确直接前驱 implementation pair，其他前驱继续要求 migration。
      **Requirements:** change-lifecycle#open-校验失败必须形成可执行恢复回环; development-telemetry#open-evidence-恢复必须形成可重放观测事实
- [ ] 5.2 运行严格 OpenSpec、相关 Vitest、typecheck、lint、architecture/provenance/generated检查和完整 `npm run verify`，更新正式验证报告并清理临时输出。
      **Blocked by:** 5.1
      **Acceptance:** 全部命令成功，分支每次提交均已push，没有临时克隆、调试日志、测试Store或未跟踪产物残留。
      **Requirements:** development-telemetry#open-evidence-恢复必须形成可重放观测事实
