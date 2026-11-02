---
comet_change: protect-build-write-branches
role: technical-design
canonical_spec: openspec
status: draft
---

# Design

## Context

Repoctopus 当前有三个彼此独立的事实：`ChangeStartBinding` 保护协调仓启动 source，`ExecutionBinding` 冻结全部 checkout 的 branch/HEAD/ownership，Delivery Policy 在 checkpoint 时拒绝 protected branch。缺口不在 Git inspection，而在授权顺序：只有 Build Plan 产出后 Runtime 才知道哪些业务仓真正可写，但现有 Plan Validator 没有把该写集与 protected-branch policy 联结，因而可以从一个稳定的 `main` Binding 创建 Execute Work。

Comet 0.5.1 通过 `bound_branch` 把 Change 固定到明确分支，Hook、恢复与归档入口都先比较 live branch；漂移时停止并要求切回或显式 rebind。Repoctopus 需要保留这一 fail-closed 原则，但不能照搬单仓“一项 Change 一个 branch”假设：多仓 Plan 可能只写三个仓而读取第四个仓，只有写集应被 source-branch policy 约束。

## Goals / Non-Goals

**Goals:**

- 在任何 Build Execute Work 创建、claim 或写权限下发前拒绝绑定 protected branch 的可写仓。
- 只由已接受 Plan 的 write scopes 派生检查集合，允许只读仓停留在 target branch。
- 让 Plan Validator、Plan Evidence 与 Delivery checkpoint 共享相同 branch pattern 语义。
- 使用现有 Binding drift/reconfigure 协议在同一 Run 合法恢复，不编辑 Store、不重放已知副作用。

**Non-Goals:**

- Runtime 不创建、切换、推送或删除 branch/worktree。
- 本次不引入每仓独立 target branch 配置；团队全局 protected patterns 与本次 target branch 构成安全集合。
- 不把 branch 名、仓库路径或 pattern 写入 OTLP 高基数 Metric label。
- 不迁移已经在受保护分支执行过业务写入的历史 checkpoint。

## Decisions

### 1. 在 Run trigger 中冻结规范化 protected branch patterns

CLI 从有效项目配置读取 `delivery.checkpoint.protectedBranches`，传入 `startChange`。Service 对输入去空白、去重、排序，并把已经由 Project Service 解析的 target branch并入集合；空字符串、重复或无界输入直接拒绝。规范化集合写入 `change.open` trigger facts，因此配置变化会走现有稳定身份/恢复规则，Plan 校验不再读取可变的当前 YAML。

选择 trigger 而不是在 Plan 时重新加载配置，是为了让同一 Run 的授权策略可重放、可审计；选择总是并入 target，是为了即使未配置完整 Delivery Policy 也不能把本次合入目标当成开发 source。

### 2. 用纯领域校验联结 Plan 写集、Binding 与策略

新增 `validateWritableRepositoryBranches`（名称可在实现中等价调整）接收 Build Plan、Execution Binding 和 frozen patterns。它从全部 package `writeScopes.repositoryId` 求唯一集合，逐一定位 Binding repository，再使用统一 `isProtectedBranch` 判断 `branchRef`。输出有界 validation fact：`accepted`、逐仓 finding 与 input digest。

校验放在 `createBuildPlan` 完成且结构/Task coverage 已验证之后、Plan Host submission 终态化和 Plan Evidence/Execute Work 创建之前。只读 repository 即使出现在 `repositoryIds` 也不进入检查集合。若 protected finding 存在，当前 Plan submission 以确定性的 `outcome-rejected` 保留在相同 Work/claim/invocation 上，且 Runtime 不创建 Execute Work。

选择 Plan 边界而不是 Configure，是因为 Configure 尚不知道精确写集，提前要求所有仓离开 target 会破坏多仓只读场景；选择 Execute 创建前而不是工具调用 guard，是为了不把非法授权交给 Host。

### 3. protected branch pattern 只有一个领域实现

把现有 Git Delivery Adapter 内部的 glob 匹配提取到 Delivery 领域模块。Build Plan 校验和 checkpoint 都调用同一函数，保持当前 `*`、`?` 和精确名称语义。该模块是纯函数，不访问 Git、配置文件或 Runtime Store。

本次不扩大为通用 glob 引擎，也不引入新依赖；现有配置语义保持不变，并新增模式边界测试防止两处漂移。

### 4. 恢复复用 Binding revision，不新增 repair lifecycle

拒绝诊断明确提示：Runner 为 finding 中的可写仓准备并公开 source branch/worktree，然后重新调用原 Run。下一次 pull 先执行现有 live Binding 比较；branch/checkout 变化触发 `dispatchExecutionBindingRevalidation`，回到 Configure 并生成新的 Binding revision，旧 Plan 因 binding identity 精确失效，随后重新 Plan。

如果 checkout 没变化，原 invocation 只能提交新的 Plan candidate，但同一 protected finding 会再次被拒绝；不能靠改文案、Agent 承诺或跳过 policy 放行。Runtime 不自动 `git switch`，避免跨仓半完成和本地未推送分支。

### 5. 验证证明“零业务副作用”与可恢复性

- 领域红测：一个 Plan 写 `web-design`、读 `backend`，前者绑定 `main` 时拒绝，后者绑定 `main` 不影响结果；`feature/*` 可写绑定通过；`release/*` pattern 匹配一致。
- Service 测试：protected finding 不接受 Host Outcome、不创建 Plan Evidence/Execute Work、不产生 claim/receipt/task completion。
- 恢复测试：切换并公开可写仓 source branch 后，live Binding drift 使同一 Run 回到 Configure；新 Binding/Plan 可继续 Execute。
- Delivery 回归：checkpoint 仍用完全相同的 pattern 结果。

## Risks / Trade-offs

- [Risk] Run 输入新增策略导致活动旧 Run identity 不兼容 → 当前 Runtime 未正式发布，采用精确 protected implementation adoption；无法证明输入的旧 Run fail closed，不从当前 YAML 猜策略。
- [Risk] 全局 protected patterns 不能表达不同仓的独立规则 → 本次先使用已有产品配置权威；未来如需 per-repository policy，必须通过独立 Change 扩展版本化配置和 Run identity。
- [Risk] Plan submission 被拒绝后用户只切 branch但未公开 → Runtime 可以验证本地 Binding，却无法证明备份安全 → Runner 的准备流程必须同时 push；本次验收显式核对 upstream/remote branch，Runtime 内核暂不接管网络发布。
- [Trade-off] 读仓可停留在 target branch，随后若计划修订将其变成写仓会再次阻断 → 这是按最小权限延迟检查的预期行为。

## Migration Plan

本次不兼容旧的未完成 Build checkpoint。合入后重新运行模拟多仓验收：先证明 main-bound 写集在 Execute 前停止，再为三个可写仓建立并 push source branch，恢复同一 Run并完成最小 Change。若实现必须让 Runtime 操作 Git、读取可变配置替代 frozen input、或在 Plan 已创建 Execute 后才检查，则停止 Build 并回到 Design。
