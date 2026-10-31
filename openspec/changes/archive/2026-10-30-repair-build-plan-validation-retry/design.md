# Design

## Context

当前链路把一次 Host 返回同时当成两个不同事实：

1. `ManagedWorkExecutor` 收到 Host payload 后调用 `markHostCompleted()`，随后 `acceptOutcome()` 将 Work checkpoint 置为终态 `outcome`；
2. `WorkflowRuns.next()` 之后才读取 `build-plan-candidate`，调用 `createBuildPlan()`、`validateBuildPlan()` 与 lifecycle Validator；
3. 任一校验拒绝都会抛错，但终态 Action Outcome 已不可变，原 claim 也无法再次提交。

因此候选错误被错误提升为“Action 已完成但 lifecycle 永远不能接受”的裂缝。`resume`、`work-reconcile` 与新 Plan Work 都不能修复这个顺序：前两者只处理未知/未执行，后者会把初次候选拒绝误建模为新的 Action attempt。

Comet 的成熟边界是：submission 先进入 Runtime，Runtime 在 CAS mutation 内完成 contract/schema/step validation 与 transition；失败只追加 `rejectedOutcomes`，Action 保持 `running`，原 claim/attempt/input hash 不变。纠正提交使用新的 Outcome ID；相同 ID 改内容则冲突。只有已接受 Plan 的后续修改才创建显式 revision/new Plan action。

## Goals / Non-Goals

**Goals:**

- 让 Host submission 在被当前 Work 的权威 Validator 接受前不成为终态 Action Outcome。
- 可纠正拒绝后保持同一 Work、claim、attempt、checkEpoch、invocation、packet digest 和冻结输入。
- 保留每次拒绝提交的不可变、有限、可审计事实，并允许使用新 submission identity 纠正。
- 为当前卡住 desktop Run 提供一次受控、幂等、无需 Store 手术的恢复路径。
- 让 Dashboard/OTLP 可区分 submitted、rejected、corrected、accepted 与 processing-error。

**Non-Goals:**

- 自动修改候选、自动重新调用外部 Host 或放宽 Validator。
- 把已接受 Plan 的 revision 退回首次 candidate correction。
- 捕获 Store、Provider、CAS、Skill 解析或未知程序缺陷并无限重试。

## Decisions

### 1. Host submission 与 accepted Outcome 是两个事实

`WorkExecutionHostOutcome` 不再因被接收就自动成为 `ClaimedActionOutcome`。Runtime 先记录带独立 `submissionId` 与 payload digest 的 submission，再由当前 Work 的 result validator 返回：

- `accepted`: 原子绑定 terminal Action Outcome、receipt 与 validator fact；
- `rejected-correctable`: 追加 rejected submission，Work 保持可纠正；
- `failed-closed`: 保存处理诊断并停止，不声称候选可由 Agent 修正。

accepted/rejected 的判断由 Runtime 注册的 Work result validator 完成，Host 和 Agent 不能选择 phase、Validator 或 continuation。

### 2. Build Plan 在 acceptance boundary 内完成全部确定性校验

`build.plan` validator 在绑定终态 Outcome 前完成：

1. result kind 与 bounded schema；
2. `createBuildPlan()` 的 Task/acceptance/dependency/repository/write-scope 规范化；
3. `validateBuildPlan()`；
4. lifecycle Validator；
5. 当前 configuration、planning digest、Task set 与 workspace snapshot 的冻结身份检查。

这些步骤的候选/Validator 拒绝属于 `rejected-correctable`。Store 写入、Provider I/O、CAS、Skill 解析与未分类异常属于 `failed-closed`；它们可以留下 processing diagnostic，但不能自动要求 Agent 重新生成候选。

### 3. 拒绝保持同一 Work/claim/attempt

拒绝不会生成新的 `build.plan` Work，也不递增 `checkEpoch` 或 action attempt。checkpoint 保留原 `workId`、claim token、packet、Host invocation 与冻结上下文，并追加 rejected submission：

- `submissionId`；
- payload digest；
- `reasonCode`：`output-invalid | outcome-rejected | outcome-processing-error`；
- 有界诊断与时间；
- 不可变原始 Host outcome。

自由文本与完整 payload 不进入 Metric label。历史采用固定上限；达到上限后停止接收并要求人工处理，不静默丢弃审计事实。

### 4. 纠正提交必须有新的 submission identity

同一 `submissionId` + 同一 digest 是幂等重放；同一 `submissionId` + 不同 digest 返回 conflict。被拒绝后，原 Host invocation/claim 仍是权威绑定，Host 用新的 `submissionId` 提交修正版。

外部 Host 由 CLI/adapter 得到 `awaiting-correction` continuation 与结构化诊断，再显式提交修正版。嵌入式 Host 可以在同一受管会话中纠正，但 Runtime 不自动再次执行任意有副作用的 Host 操作。

### 5. 接受与生命周期推进保持单一权威顺序

校验成功后，Runtime 在 CAS 保护下绑定 accepted Host submission、Action Outcome、receipt 与 validator fact；`WorkflowRuns.next()` 只能消费已接受结果并提交 lifecycle observation。若在 acceptance 与 lifecycle observation 之间崩溃，恢复按 accepted fact 幂等推进，不重新调用 Host，也不产生第二个 Work。

### 6. 预修复卡住 Run 使用显式兼容恢复

兼容恢复只匹配以下可证明状态：当前 Work 是 `build.plan`；checkpoint 已有 terminal host/action Outcome；lifecycle 尚无相应 accepted Plan；候选可重现同一确定性拒绝；definition/composition/packet/configuration 身份兼容。

Runtime 原子地保留旧 Outcome 为 rejected submission，移除“已接受”的 checkpoint 投影，恢复同一 Work/claim/invocation 的 correction 状态，并记录一次 migration fact。恢复幂等，不删除 trajectory/event，不接受任意调用者指定 Work/phase。无法证明兼容时进入 `migration_required`，不得猜测。

### 7. 可观测性来自提交事实

Trajectory/OTLP 从提交事实投影以下低基数事件：`work.outcome-submitted`、`work.outcome-rejected`、`work.outcome-corrected`、`work.outcome-accepted`、`work.outcome-processing-error`。属性包含 phase/action/result/reasonCode/attempt/checkEpoch；run/work/submission identity 只用于 trace/event correlation，不作为 Metric label。

## 模块边界

- `domains/work-execution`: submission/rejection checkpoint schema、digest/idempotency 与纯状态约束。
- `services/managed-work-executor`: 接收/规范化 Host submission，不再提前终态化领域 Outcome。
- `services/work-execution-authority`: CAS 下记录 submission、rejection、acceptance、兼容恢复和 trajectory facts。
- `services/workflow-runs`: 注册并执行当前 Work result validator，成功后提交 lifecycle observation。
- `platform/telemetry`: 消费已提交事实，不从异常日志反推业务状态。

## 验证

- 先用失败回归测试复现：缺 Task 候选被提前终态化后 Run 永久阻塞。
- 领域/Service 测试证明拒绝后 Work/claim/attempt/checkEpoch/invocation 不变，新 submission 可纠正，同 ID 改内容冲突。
- 冷启动测试证明 rejected submissions 与 claim 跨重启保留，修正版仍提交给同一 Work。
- 兼容测试把真实旧 schema 卡住 fixture 恢复到 correction 状态，并证明重复恢复幂等。
- 严格 OpenSpec、typecheck、lint、相关 Vitest、完整 `npm run verify` 与 telemetry contract 全部通过。

## 回退

新 checkpoint schema 只追加不可变 submission/rejection facts。若代码回退后旧 Runtime 无法理解新 schema，应 fail closed 为 `migration_required`，不得把 rejected submission 当成 accepted Outcome 或创建新 Plan Work。
