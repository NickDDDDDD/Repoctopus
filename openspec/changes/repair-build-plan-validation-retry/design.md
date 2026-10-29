# Design

## Context

当前 `WorkflowRuns.next()` 在 `build.plan` Outcome 已持久化后调用 `createBuildPlan()` 和 Plan Validator。候选无效时，这两个边界会抛错或返回拒绝，Service 直接终止。此时存在三项互相冲突的事实：

1. Host Outcome 是不可变审计事实，不能用修正版覆盖。
2. lifecycle 仍引用旧 `build.plan` Work，不能领取第二次。
3. `work-reconcile` 只处理未知外部结果，`resume` 只恢复缺失 Work，二者都不能把已知的无效 Outcome解释为未执行。

领域 reducer 已支持 `build-plan-retry-required`，但 Service 只在 Host identity 漂移时使用，未覆盖候选验证失败。这是编排层遗漏，不需要新 phase、Repair lifecycle 或可变 Outcome。

## Goals / Non-Goals

**Goals:**

- 把预期的候选拒绝收敛为同一 Plan Action 的新 Work。
- 保持 configuration、Task set、旧 claim/invocation/outcome 与 transition history 可审计。
- 让拒绝原因进入新 Work 的稳定输入和低基数遥测分类，支持 Agent 修正与流程健康度分析。
- 证明进程重启、重复 `next` 和修正候选提交均具备幂等边界。

**Non-Goals:**

- 捕获进程、存储、Provider 或程序缺陷等未知异常并无限重试。
- 修改候选、自动生成补丁计划或放宽 Plan Validator。
- 恢复所有历史预发布 Run schema。

## Decisions

### 1. 候选拒绝是受管 Action 结果，不是 Work 失败重放

Host 已成功完成“生成候选”动作；失败发生在 Runtime 对候选的确定性验证。因此旧 Host Outcome 保持 `succeeded`，Runtime 记录 `candidate-rejected` 诊断并通过现有 `build-plan-retry-required` observation 创建新的 `build.plan` Work。新 Work 拥有新的 `workId`、`checkEpoch` 和 action attempt，原 invocation 不可再次提交结果。

将旧 Outcome 改成 failed 会伪造 Host 执行事实；重新开放旧 claim 会允许覆盖不可变结果；两者均拒绝。

### 2. 只捕获预期的候选验证错误

领域层新增可识别的 `BuildPlanCandidateRejectedError`，只用于候选 schema、字段上限、Task/acceptance 覆盖、依赖、仓库/write scope 和规范化校验。`createBuildPlan()` 继续保留抛出式 API，调用方可通过错误类型区分“候选不合格”和未知程序/基础设施异常。

`validateBuildPlan()` 的 `accepted=false` 以及 lifecycle Validator 对完整 Plan validation fact 的拒绝同样属于候选拒绝。存储失败、Skill 解析失败、Provider I/O、CAS 冲突和非该类型异常继续向上失败，不得被伪装成 Agent 可修正问题。

### 3. Runtime 统一创建 Retry Work

`WorkflowRuns` 使用一个私有 helper 处理 Host drift、candidate rejection 和 Validator rejection的 Plan 重试：

- 重新解析当前 `build.plan` Action Skill 和 augmentation Skills；
- 绑定同一 composition、project configuration、project snapshot、Workspace/repository set 与冻结 Build Configuration；
- 在 `stableInput` 中记录有界 `reasonCode`、旧 `workId` 和诊断摘要；
- 先提交 lifecycle observation，再记录新 Work checkpoint；
- 返回 warning diagnostic 和新 Run projection。

helper 不接受调用者指定 phase、Action 或 configuration，避免恢复入口变成跳转 API。

### 4. 拒绝原因有界且可观测

重试分类固定为 `host-drift | candidate-invalid | validator-rejected`。自由文本诊断截断并规范化，只进入 Work input/事件，不进入 Metric label。OTLP 继续从已提交 transition/Work facts 投影 `build.plan` retry、attempt 和 result；不得从异常日志猜测状态。

### 5. 恢复与幂等

transition 和新 Work checkpoint 使用现有 Run Store CAS。崩溃发生在 transition 与 checkpoint 之间时，兼容恢复只能为 lifecycle 当前新 Work补齐 checkpoint；不会回到旧 Work。重复 `next` 看到新 Work 后只返回/领取该 Work，不会再次处理旧 Outcome。

既有卡住 Run 只有在 definition、composition、Provider 和冻结输入兼容时，才可由修复版 Runtime 通过显式恢复入口把已知拒绝 Outcome转换为新 Work；不直接编辑 Store，也不删除旧事实。

## 模块边界

- `domains/change-lifecycle/build-protocol.ts`: 定义可识别的候选拒绝错误，不依赖 Cordis、文件系统或 Store。
- `services/workflow-runs.ts`: 将确定性拒绝编排为现有 lifecycle observation 和新 Work。
- `platform/runtime`: 继续负责 CAS、checkpoint 与 trajectory 持久化，不解释候选内容。
- `platform/telemetry`: 消费 transition/Work facts，不新增高基数异常标签。

## 验证

- 领域测试证明每类非法 candidate 抛出可识别错误，未知异常不会被该类型吞掉。
- Service 测试提交缺少 Task 的候选，断言旧 Outcome 不变、新 `workId/checkEpoch/actionAttempt` 递增且诊断可见。
- 冷恢复测试在拒绝后关闭并重启 Runtime，再提交完整候选，证明只接受新 invocation 并正常进入下一 Action。
- 严格 OpenSpec、类型检查、lint、相关 Vitest 与完整 `npm run verify` 通过。

## 回退

实现不迁移或重写旧事实。若需回退代码，已创建的新 Work 仍是合法 `build.plan` Work；旧版本若 definition/composition 不兼容应进入 `migration_required`，不得选择旧 Outcome覆盖新状态。
