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
