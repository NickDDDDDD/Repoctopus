# Comet Design Handoff

- Change: separate-execution-branch-binding
- Phase: design
- Mode: compact
- Context hash: 909b62d072b9ec05d280e3ec9f7bd5ab323a9fdda936b4013408a9855f41bf4a

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/separate-execution-branch-binding/proposal.md

- Source: openspec/changes/separate-execution-branch-binding/proposal.md
- Lines: 1-36
- SHA256: 4df2a078e1502aa5e41b11aeac50626facce05f6e66eca2482d63699ee46202d

```md
# Proposal

## Why

真实多仓验收在 Open 人工批准 `branch` 隔离时失败：Runtime 把协调仓的交付目标分支 `main` 写进 `ExecutionWorkspaceIntent.targetBranch`，随后要求所有执行 checkout 都位于该分支。结果是正确的协调仓功能分支被拒绝，且多个业务仓被错误要求共享一个分支名。

这不是调用方式问题，而是执行隔离与交付目标两个领域概念被混用。Comet 0.5.1 的成熟模型把 isolation、change branch 和 target branch 分开持久化；Repoctopus 的多仓模型还必须保留逐仓不同 branch、只读仓停留在受保护分支，以及 Plan 确定写集后再准备业务 source branch 的能力。

## What Changes

- 从可移植 `ExecutionWorkspaceIntent` 移除交付 `targetBranch`，让 Intent 只表达 `current|branch|worktree` 隔离选择与 Change 身份。
- 让 `ExecutionWorkspaceBinding` 继续逐仓记录真实 branch、HEAD、checkout 和 worktree ownership，禁止 branch 模式按一个共享分支名校验全部仓库。
- 明确 `ChangeStartBinding` 与 delivery trigger 中的 source/target branch 只服务于协调仓启动身份、受保护分支策略和最终交付，不参与多仓执行 checkout 的同名约束。
- 增加生产调用链回归：协调仓位于功能分支、其他仓位于 `main` 时，Open 的 branch 批准成功并进入 Design；后续写仓保护仍在 Build Plan 边界 fail closed。
- 用当前真实失败 Run 作为复现基线；修复后优先恢复同一验收场景。若受保护 composition 身份变化要求新 Run，则重新开始该验收，不增加旧状态兼容层。

## Capabilities

### Modified Capabilities

- `change-lifecycle`：分离执行隔离意图、逐仓执行绑定和交付目标分支的权威边界。

## Non-Goals

- Runtime 不创建、切换或推送 Git branch/worktree。
- 不提前把所有业务仓切到功能分支；可写仓仍由 Build Plan 的精确 write scopes 决定。
- 不改变 Delivery 的 source/target branch、受保护分支或发布语义。
- 不为修复前未完成 Run 建立长期 schema 兼容或迁移层。

## Upstream Reference

参考 Comet 0.5.1 `native-shape-workspace-isolation`：isolation、实际 change branch 与最终 target branch 是独立事实；target branch 用于 finish/archive，而不是执行 checkout 的共享 branch 断言。Repoctopus 采用该边界，但按自身多仓和延迟 write-scope 架构把执行事实保存在逐仓 Binding 中。

## Third-Party and License

本 Change 仅参考 Comet 的公开行为模型并在 Repoctopus 架构中独立实现，不复制第三方源码或新增依赖。

```

## openspec/changes/separate-execution-branch-binding/design.md

- Source: openspec/changes/separate-execution-branch-binding/design.md
- Lines: 1-111
- SHA256: a39469510ea46406e0b4e46c21a818a145eaebe8c3fcd1bcebf7482be58782e2

[TRUNCATED]

```md
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


```

Full source: openspec/changes/separate-execution-branch-binding/design.md

## openspec/changes/separate-execution-branch-binding/tasks.md

- Source: openspec/changes/separate-execution-branch-binding/tasks.md
- Lines: 1-38
- SHA256: 46fe76abbb59b0acfca5fe74a74f21062d5b28d3863c9edce540353f18dca1a7

```md
# Tasks

## 1. Freeze the regression

- [ ] 1.1 为 `ExecutionWorkspaceIntent` 添加红测，证明 branch 模式不接受或要求 delivery target branch。 <!-- comet-task:0b3d0cce-0d53-4cd5-9dc2-95bdc6e5ac79 -->
- [ ] 1.2 为多仓 Binding 添加红测：协调仓功能分支、三个业务仓 `main` 和一个不同功能分支可以共同绑定。 <!-- comet-task:e7ea31c1-f725-433a-9380-c3c879b9c699 -->
- [ ] 1.3 添加负例，覆盖 detached/缺失 branch facts、remote/topology drift 与 worktree ownership 不匹配。 <!-- comet-task:c531183a-745a-44bf-9235-97df290273ec -->

## 2. Separate the domain identities

- [ ] 2.1 重构 `ExecutionWorkspaceIntent`，移除 `targetBranch` 并更新稳定摘要、类型和构造器。 <!-- comet-task:26c5a165-707b-4817-a306-3ac79b495e14 -->
- [ ] 2.2 重构逐仓 Binding 校验，删除全仓共享 branch 比较并保留模式、拓扑和身份门禁。 <!-- comet-task:6f7562b4-5652-4cd8-8291-d3972bd5bf41 -->
- [ ] 2.3 更新 binding error taxonomy，移除错误的 `branch-mismatch` 语义并保持结构化恢复分类。 <!-- comet-task:9c95df08-2be1-44c5-867d-2c89b4e34f65 -->

## 3. Repair production orchestration

- [ ] 3.1 修改初次 Open approval，不再从 delivery trigger 向执行 Intent 注入 target branch。 <!-- comet-task:b1977633-d3d2-433f-8417-1cda68d527da -->
- [ ] 3.2 修改 workspace-intent revision 路径，使其与初次批准复用同一 Intent/Binding 语义。 <!-- comet-task:cb4496fb-84b2-4fe8-8b06-12e538a133ec -->
- [ ] 3.3 审计 Runtime、CLI、Dashboard/telemetry 和持久状态的所有 `workspaceIntent.targetBranch` 消费点，删除错误耦合而不改 Delivery target。 <!-- comet-task:fd44d6cf-0bc1-42b0-a4f1-21e8ba32a0f2 -->

## 4. Preserve Build safety

- [ ] 4.1 保留并扩展 Plan 验证测试，证明可写仓绑定 protected branch 仍被拒绝。 <!-- comet-task:e20b3e4b-cd33-443d-96ee-cbc7822d60bc -->
- [ ] 4.2 证明只读仓停留在 target/protected branch 不阻断 Plan。 <!-- comet-task:523450a3-835e-4941-8e25-f16e943104d0 -->
- [ ] 4.3 证明 Runner 切换被拒绝写仓的 branch 后触发 Binding revalidation，而不是要求重做 Open approval。 <!-- comet-task:17dacdf0-f711-434b-a59b-cbc2bca8e4aa -->

## 5. Production acceptance

- [ ] 5.1 增加 Windows 生产 CLI E2E：真实 `run start`、Open Host Outcome、branch Human Decision 后进入 Design。 <!-- comet-task:848ab558-b119-44f8-940b-d55222ef820a -->
- [ ] 5.2 E2E 同时断言协调仓 source branch 与 delivery target branch 保持不同，其他仓无需共享 source branch。 <!-- comet-task:292d5fee-e9c4-4e38-bc36-aef8fda4847f -->
- [ ] 5.3 验证失败批准不写 lifecycle/Specification Store，修复后的重复批准保持幂等。 <!-- comet-task:9d14088e-b156-4da8-9be3-2f111e65120b -->

## 6. Documentation and full verification

- [ ] 6.1 更新 Runtime/自举文档，解释 Intent、Binding、ChangeStartBinding 和 Delivery target 的职责边界。 <!-- comet-task:10382a35-d3ab-4bc3-bad9-02454fb45d99 -->
- [ ] 6.2 运行定向测试、strict OpenSpec、architecture/provenance/generated 检查和完整 `npm run verify`。 <!-- comet-task:7fae3b5d-9230-42d1-8988-3e28be2d23a1 -->
- [ ] 6.3 清理临时验收日志和 scratch 输出；保留正式 Run、规格、测试与诊断证据。 <!-- comet-task:5b9dc4f6-b939-47ca-a035-8d4438f8422c -->
- [ ] 6.4 用修复后的产品继续模拟多仓验收；若旧 Run 因 composition identity 不兼容则记录并从同一场景创建新 Run，不添加兼容旁路。 <!-- comet-task:1ee9c804-2040-4b1f-8318-4a0789ce1b86 -->

```

## openspec/changes/separate-execution-branch-binding/specs/change-lifecycle/spec.md

- Source: openspec/changes/separate-execution-branch-binding/specs/change-lifecycle/spec.md
- Lines: 1-32
- SHA256: d9a68ce8c5376087c75702be952c6a9f30dc25a2ee16e41c448791df9eb066f4

```md
# change-lifecycle Delta

## ADDED Requirements

### Requirement: 执行隔离意图必须与交付目标分支分离

Repoctopus MUST 将可信用户批准的 `current|branch|worktree` 隔离意图、逐仓 Execution Binding 与 Change Delivery source/target coordinates 建模为独立权威事实。`ExecutionWorkspaceIntent` MUST NOT 把 delivery target branch 解释为一个由全部执行仓共享的 branch；`ExecutionWorkspaceBinding` MUST 逐仓记录真实 attached branch、HEAD 与 worktree ownership。Runtime MUST 在 Open 批准前验证 topology、repository identity 和所选隔离形态，但只有 Build Plan 的精确 write scopes 可以决定哪些仓必须离开 protected branch。

#### Scenario: 多仓 branch 隔离不要求同名分支

- **WHEN** 协调仓位于冻结的 Change source branch，若干业务仓仍位于 `main`，另一个业务仓位于不同名称的功能分支，且所有 checkout 的 topology、remote identity 与 branch facts 合法
- **THEN** Open 的 branch isolation 预检成功，Runtime 持久化隔离 Intent并让逐仓 Binding保留各自 branch，不把 delivery target branch 或协调仓 source branch应用到其他仓

#### Scenario: Delivery target 不参与执行 branch 比较

- **WHEN** ChangeStartBinding 冻结 `sourceBranch=codex/change` 与 `targetBranch=main`，用户批准 branch isolation
- **THEN** Runtime 使用 `main` 作为启动、protected policy 与 Delivery target 事实，但不得要求协调仓或任一业务仓的执行 checkout 位于 `main`

#### Scenario: 只读仓在 Open 保持 target branch

- **WHEN** Open 阶段尚未形成 Build Plan write scopes，业务仓绑定在受保护的 target branch
- **THEN** Runtime 不因该 branch 单独拒绝 Open；Plan 后若该仓为只读则继续允许，若成为可写仓则由既有 protected branch validation 在 Execute 前拒绝

#### Scenario: Runner 在 Plan finding 后准备写仓分支

- **WHEN** Plan 因可写仓仍位于 protected branch 被拒绝，Runner 为该仓准备并公开合法 source branch
- **THEN** Runtime 通过 Execution Binding revalidation 精确失效依赖旧 Binding 的 Plan并重新 Configure/Plan，不要求用户重做未变化的 Open isolation approval

#### Scenario: 执行 checkout 身份漂移

- **WHEN** checkout 的 repository identity、topology、isolation ownership 或已接受 Binding branch 与恢复事实不一致
- **THEN** Runtime fail closed并使用既有 binding recovery 分类处理，不得回退为 delivery target branch、猜测统一 branch 或静默重绑定

```
