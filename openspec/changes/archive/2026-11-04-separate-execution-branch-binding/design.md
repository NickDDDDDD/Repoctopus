---
comet_change: separate-execution-branch-binding
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-04-separate-execution-branch-binding
status: final
---

# Design

## Context

`ChangeStartBinding` 已正确冻结协调仓 `sourceBranch=codex/add-compact-task-status` 与 `targetBranch=main`。Open 批准却再次创建 `ExecutionWorkspaceIntent`，并把 trigger 的交付 target branch 传入其 `targetBranch` 字段。`ExecutionWorkspaceService.bind()` 随后把这个单值与五个 checkout 的当前 branch 逐一比较，因此第一个正确的功能分支立即产生 `branch-mismatch`。

现有规范已经要求只读仓可以停留在 `main`，而写仓在 Build Plan 形成精确 write scopes 后才必须绑定合法 source branch。当前实现既违背该规范，也让 Open 在尚不知道写集时做了无法成立的全仓同名判断。

## Goals / Non-Goals

**Goals:**

- Open 只批准隔离方式，不把交付 target branch 解释成执行 branch。
- 多仓 Binding 逐仓保存真实 branch/head/worktree，允许不同仓使用不同 branch。
- 保留 Open 写入前的真实 checkout 预检、Build Configure 重绑定和漂移 fail-closed。
- 用生产 `run start -> Open Work -> Outcome -> Human Decision -> Design Work` 链路捕获回归。

**Non-Goals:**

- 自动创建或切换 branch/worktree。
- 在 Open 提前批准尚未形成的 Build write scopes。
- 改变 Delivery 或 protected branch policy。
- 为旧 `ExecutionWorkspaceIntent` 提供双读、fallback 或静默推断。

## Decisions

### 1. Intent 只表达隔离语义

`ExecutionWorkspaceIntent` 升级为新的单一 schema，字段为 workspace/change identity、`isolation`、稳定摘要和 intent identity；移除 `targetBranch`。`branch` 模式不再要求调用者提供一个共享 branch 名。

Intent 是可信用户对执行形态的决定：使用注册 checkout、独立 branch checkout，还是 owned worktree。它不是 Git delivery intent，也不是逐仓 Build 授权。

不把逐仓 branch map 固定进 Intent。Open 尚未取得 Build Plan 的 write scopes，业务仓此时可以合法停留在 `main`；若把它冻结为已批准语义，Plan 后为可写仓准备 source branch 将被误判成人工意图变化并反复返回 Open。逐仓 branch 是可重建、可重验的执行事实，归属于 Binding。

### 2. Binding 是逐仓执行事实权威

`ExecutionWorkspaceService.bind()` 继续从冻结的 checkout 集与 project topology 读取每仓：

- repository identity；
- checkout path；
- attached branch 与 HEAD；
- remote identity；
- git/common directory 与 worktree ownership。

不同 repository 的 branch 可以不同。`branch` 模式只验证每个 checkout 能提供合法 attached branch 事实以及模式所需的 ownership 约束，不与 delivery target 或其他仓 branch 比较。`current` 仍要求注册 checkout 且不是 linked worktree；`worktree` 仍要求 ownership facts。

逐仓 branch/head 继续进入 `ExecutionWorkspaceBinding` 的 semantic/local/state digest。Build Configure、恢复和重放通过 Binding 比较发现真实漂移，而不是通过 Intent 中的共享 branch 猜测。

共享 branch 断言目前同时存在于 Service 预检和领域 Binding 构造器；两处必须一起删除。否则只修 Service 会让同一合法输入在领域边界再次失败。

### 3. Delivery target 保持独立

协调仓 source/target 坐标继续由 `ChangeStartBinding` 与 trigger facts 冻结：

- source branch 证明 Run 从合法协调仓功能分支启动；
- target branch 参与 protected branch policy、Planning/Delivery identity 与最终 PR base；
- 两者都不得成为全部执行仓的 branch 同名约束。

这与 Comet 0.5.1 将 isolation、change branch、target branch 分开的模型一致；Repoctopus 的差异是执行侧有多个 repository，因此实际 branch 集合属于逐仓 Binding。

### 4. 写仓安全仍在 Plan 边界执行

Open 阶段不知道最终 write scopes，不应要求所有业务仓预先创建 feature branch。Build Plan 形成后，现有 `validateBuildPlan()` 将每个可写 repository 与当前 Binding、冻结 protected patterns 联合校验：

- 可写仓在 `main` 等受保护 branch 时拒绝 Plan；
- 只读仓在 `main` 时不阻断；
- Runner 为被拒绝的写仓准备功能分支后，Binding revalidation 精确失效旧 Plan并重新规划。

本 Change 不复制第二份 protected branch 策略。

### 5. Open 决策保持原子和可重试

`decideChange()` 仍在写入 lifecycle intent 或 Specification approval 前调用 Binding 权威。预检失败不写任何批准；成功后才提交 `open-workspace-intent-selected` 和 Open planning decision。

修复后的 branch 预检验证拓扑、remote identity 和隔离形态，但不再读取 trigger target branch 构造执行约束。workspace intent revision 路径使用同一构造与绑定函数，避免初次批准和返工产生两套语义。

### 6. 不保留旧 Intent 兼容层

项目尚未正式发布，本 Change 直接移除错误字段和相关错误分支，不保留 schema 1 双读或 `targetBranch` fallback。当前失败验收 Run 尚未写入 Intent/approval，因此业务事实没有迁移需求；若 composition 保护因代码身份变化阻止原 Run 接管，则保留其诊断证据并以同一场景启动新 Run。

### 7. Error 与 telemetry contract 同步收敛

删除只为共享 branch 断言存在的 `branch-mismatch` error code，并同步更新低基数 telemetry allowlist。真实 branch 在 Build Configure 后变化仍由 Binding drift/revalidation 表达；不把 branch 名、路径或 repository identity 放进 Metric label，也不增加一个语义相同的新错误别名。

## Alternatives Considered

- **把 `ChangeStartBinding.sourceBranch` 应用于全部仓库：拒绝。** 多仓 source branch 名不必相同，只读仓也不应被强迫创建分支；这只是把 `main` 错误替换成另一个共享字符串。
- **在 Open Intent 固定逐仓 branch map：拒绝。** 它会把 Plan 后的正常 checkout 准备升级成人工意图修订，与现有延迟 write-scope 安全模型冲突。
- **只跳过 Open 预检：拒绝。** 这会把错误推迟到 Configure，失去 Open 决策的原子校验，并保留领域层错误断言。
- **选择 isolation-only Intent + per-repository Binding。** 人工语义稳定，执行事实可重建，且与 Comet 的 isolation/change/target 分离原则及 Repoctopus 多仓架构同时一致。

## Module Boundaries

- `domains/change-lifecycle/build-protocol.ts`：定义纯 Intent/Binding 合同与摘要。
- `services/execution-workspace.ts`：检查逐仓 Git facts并返回稳定 binding/error 分类。
- `services/workflow-runs.ts`：从 Human Decision 构造 Intent，编排先验证后写入。
- `app/cli`：只收集 isolation 选择，不提供 branch 名或目标 phase。
- `test/**`：领域、Service 与生产 CLI E2E。

## Verification

- 领域红测证明 branch Intent 不接收 delivery target branch，摘要只随隔离/Change 身份变化。
- Service 红测证明五仓可以分别位于协调仓功能分支和各业务仓 `main`，且 Binding 保留每仓 branch。
- 负例覆盖 topology/remote/worktree ownership、detached branch facts 与恢复时 branch 漂移。
- 生产 E2E 从功能分支启动真实 Change，完成 Open Work 与人工批准，断言进入 Design 且批准 Store/lifecycle 一致。
- Build Plan 回归证明可写 `main` 仍被拒绝、只读 `main` 仍允许，避免用放宽安全门禁换取 Open 通过。
- `npm run verify` 与 strict OpenSpec 全部通过。

## Rollback

本 Change 不支持回滚到共享 target branch 语义。若新实现不能同时通过 Open 生产 E2E 与 Build 写仓保护回归，则停止合入并保留当前失败验收证据。
