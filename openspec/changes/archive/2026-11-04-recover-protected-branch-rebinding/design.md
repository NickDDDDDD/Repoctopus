---
comet_change: recover-protected-branch-rebinding
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-04-recover-protected-branch-rebinding
status: final
---

# Design

## Context

Build Plan 只有在形成精确 package write scopes 后，才能判断哪些仓库必须离开受保护分支。现有 Runtime 在 Plan rejection 后把当前 invocation 标记为 `awaiting-correction`，`run next` 也已有专用分支：重新观察 checkout、发现 Binding drift，并派发 `build.configure` 重新绑定。

但 `run resume` 先进入通用 project reconciliation。该层只知道原始与当前 project snapshot 不同，不知道 branch 变化正是 Runtime 前一条 finding 要求的修正，因此立即设置全局 `reconciliationRequired`。服务层随后再也到不了 Build 的专用 revalidation。结果是相同证据、相同 Run、相同 checkout，恢复行为仅因调用入口不同而相反。

更严重的是，一次错误的 `resume` 已把真实验收 Run 标记为需要 reconciliation。修复若只能保护未来调用，仍不能证明 checkpoint 恢复模型完整。

## Goals / Non-Goals

**Goals:**

- 用不可伪造的生命周期证据识别 Runtime 已要求的精确 protected-branch correction。
- 让 `next`、首次 `resume` 和进程重启后的重复 `resume` 共享同一恢复判定与转换。
- 在同一 Run 中建立新 Binding revision、精确废弃旧 Plan checkpoint 并返回 Configure。
- 对任何超出授权集合或身份维度的变化继续 fail closed。
- 保持恢复幂等、可审计，并提供低基数 telemetry。

**Non-Goals:**

- 自动执行 Git 操作或推断应创建的 branch 名。
- 让 Agent 自选 phase/action 或直接清除 reconciliation 状态。
- 通过诊断 message 文本、CLI argv 或 branch 命名约定推断授权。
- 为任意旧 Run 建立迁移/fallback。

## Decisions

### 1. 授权来自冻结证据，不来自当前 checkout 的外观

新增纯领域 classifier，输入至少包括：

- 当前 lifecycle phase、current Work、execution status 与 continuation；
- rejected submission 中冻结的 `build-plan-candidate` 及其精确 repository write scopes；
- rejection outcome 中的 protected-branch findings；
- rejection 时使用的 Execution Binding 与 protected branch policy；
- baseline/current project snapshots 及当前可观察 Binding facts。

只有同时满足以下条件才返回 typed `authorized-protected-branch-rebind`：

1. phase 为 Build，current Work 为 `build.plan`，invocation 正在等待修正；
2. rejection 确由 candidate write scopes 中仓库绑定受保护分支产生；
3. 发生 branch 变化的仓库集合非空，且是该 protected write-set 的子集；
4. 每个已修正仓当前使用 attached、非受保护、已公开的 source branch；
5. checkout path、remote、repository identity、topology、worktree ownership、Host/capability 均未变化；
6. 不存在无关仓 branch 变化、repository add/remove 或无法分类的 snapshot 差异。

classifier 返回结构化授权对象与稳定 digest，不返回宽泛 boolean。它不得解析人类诊断字符串，也不得仅凭 branch 名包含 Change ID 就放行。

### 2. `next` 与 `resume` 只保留一个恢复规则

把现有 `next` 中的 protected-branch recovery 判定提取为共享应用服务/领域函数。两个入口都先重新观察 project facts，再调用同一 classifier：

- 命中授权：派发既有 `build.configure` revalidation；
- 未命中且无漂移：按各入口原有幂等语义继续；
- 未命中且有漂移：交给通用 reconciliation，继续 fail closed。

这样 Runtime 仍选择 Action，Agent/Runner 只能拉取下一合法 Work，不能用 `resume` 或 `next` 绕过 phase 规则。

### 3. 授权重绑定是原子 lifecycle 转换

命中后，在一个受管转换中：

- 记录 authorized rebind fact、授权 digest 与 previous/current Binding identity；
- 使旧 Plan execution checkpoint 精确失效并提升 check epoch；
- 保留 rejected submission/outcome 作为审计历史；
- 保留 Open/Design approval、Build Strategy 和 OpenSpec Tasks；
- 创建且只创建一个新的 `build.configure` Work；
- 清除与同一授权 digest 对应的 branch-only reconciliation poison。

不得伪造旧 snapshot、重写历史 outcome 或直接跳到 Plan/Execute。Configure 必须重新验证 Host、capability 与新 Binding，然后 Runtime 才能重新派发 Plan。

### 4. 已被错误标记的同一 Run可以窄恢复

`reconciliationRequired=true` 不是不可逆业务事实；它是对观察差异的安全投影。若当前 Run 的 reconciliation evidence 与 classifier 的授权 digest 精确匹配，`resume` 可以在上述原子转换中撤销该投影并继续同一 Run。

只要 evidence 多出一个未授权维度，或基线已无法证明，Runtime 就不得清除标记。这个规则修复当前 schema 下被错误分类的 Run，不是旧版本兼容层。

### 5. 部分修正保持可重试，不提前重规划

若多个可写仓被 protected finding 拒绝而 Runner 只修正一部分，Runtime 可以记录当前观察，但不得把 Plan 视为可接受，也不得创建 Execute Work。实现可以：

- 派发 Configure 并在新 Binding 后再次拒绝仍受保护的 Plan；或
- 保持 `awaiting-correction` 并给出剩余仓的结构化 finding。

选择必须在实现测试中固定，且 `next`/`resume` 一致。无论采用哪种，已修正仓不得被误判为未知漂移，未修正仓不得获得写权限。

### 6. Telemetry 记录行为，不泄露高基数身份

授权重绑定至少产生 Span/Event：恢复入口、授权分类、结果、是否清除匹配 poison、受影响仓数量、phase/action/work kind 和 check epoch。Metric label 只使用有限枚举；branch 名、repository ID、path、remote URL、Run ID 和 digest 不进入 Metric labels，可作为受现有安全策略约束的 trace attributes/evidence references。

重复 `resume` 不得重复计数成功 transition；可以记录 idempotent observation。

### 7. 采用 Comet 的 rebind/checkpoint 原则，不照搬单仓形态

Comet 的成熟边界是：Runtime 持有 workspace identity，预期人工修正通过显式 rebind 恢复 checkpoint，未知漂移阻断。Repoctopus 保留该原则，但授权集合来自多仓 Plan 的精确 write scopes，重新派发的是不可变 Work Descriptor，规格/任务权威仍是 OpenSpec。

本 Change 不引入 Comet SDK、不复制其 Build Plan 或技能系统，也不创建第二套状态机。

## Alternatives Considered

- **要求用户始终调用 `run next`：拒绝。** 断点恢复、进程重启和 CLI 语义天然会使用 `resume`；入口差异不应改变合法状态转换。
- **在通用 reconciliation 中忽略所有 branch 变化：拒绝。** 未知 branch drift 可能改变写入目标和交付身份，必须 fail closed。
- **Runtime 自动创建功能分支：拒绝。** Git 副作用仍属于 Runner，Runtime 只返回精确要求并验证结果。
- **清空 `reconciliationRequired` 后重新开始 Plan：拒绝。** 这会丢失审计因果并允许 Store mutation 绕过。
- **typed authorized rebind + 同一 checkpoint 恢复：选择。** 它把例外限定在已有 Runtime finding 的因果范围内，同时保持 Comet 的显式 rebind 原则。

## Module Boundaries

- `domains/runtime` / project reconciliation domain：纯 diff 分类、授权对象、稳定 digest 和 fail-closed 规则。
- `services/workflow-runs.ts`：收集冻结证据，协调 `next`/`resume` 共用 classifier，并原子派发 Configure。
- `domains/change-lifecycle`：只消费合法 transition，不执行 Git 或解析 CLI。
- telemetry projection：映射授权恢复事实到安全 Span/Event/Metric。
- `test/**`：领域矩阵、服务幂等性、生产多仓断点 E2E。

## Verification

- 生产 E2E：protected Plan rejection → Runner 切换并 push 精确写仓 → 关闭并重建 composition → `run resume` → 同一 Run 的 `build.configure`，且 `reconciliationRequired=false`。
- 当前 poison 形态回归：首次旧式 resume 写入 matching reconciliation 后，再次 resume 能按授权证据恢复。
- 负例覆盖无关仓 branch、path、remote、topology、repository add/remove、detached/unpublished branch 与 Host/capability drift。
- 多仓部分修正与重复 resume 保持幂等，不创建重复 Configure Work。
- 保留现有 `next` 回归，并断言两个入口消费同一 classifier。
- 验证 telemetry 低基数和敏感字段边界。
- 运行定向测试、strict OpenSpec、architecture/provenance/generated 检查和完整 `npm run verify`。

## Rollback

若 classifier 不能同时证明真实恢复与未知漂移 fail-closed，则停止合入。不得回退为“忽略 branch drift”、Store 手改或新建 Run；保留当前验收 Run 作为失败证据。
