# Proposal

## Why

多仓 Runtime 验收在 Build Plan 已批准并派发首个 Execute Work 后才发现三个可写业务仓仍绑定在 `main`。现有启动前置校验只保护协调仓 source 与 target 不相同，Execution Binding 只证明 checkout 未漂移，Delivery 又要到提交时才拒绝 protected branch；因此“Configure 时就在受保护分支”会被当成稳定但合法的执行环境，Agent 可能在交付保护生效前直接修改目标分支。

## What Changes

- 把团队 Delivery Policy 的 `protectedBranches` 作为稳定 Run 输入冻结，并保证已解析 target branch 始终属于受保护集合。
- 在 Build Plan 已给出精确 repository/write scope、但 Execute Work 尚未创建时，验证每个实际可写仓的 Execution Binding branch 不匹配任何受保护模式。
- 对只读仓不施加功能分支要求；对可写仓返回包含 repository id、branch 和恢复动作的结构化诊断。
- 失败时保留原 Plan submission 与 Run 历史，不创建 Execute Work、不授予写权限；Runner 准备并公开合法 branch/worktree 后，由既有 binding drift/reconfigure 协议在同一 Run 恢复。
- 复用同一分支模式匹配领域函数，让 Build 前置校验与 Delivery checkpoint 不产生不同的 protected-branch 语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `managed-work-execution`：Plan Evidence 接受前验证精确可写仓均绑定合法 source branch。
- `change-lifecycle`：冻结受保护分支策略，并通过现有 Execution Binding 修订恢复被拒绝的 Build Plan。
- `delivery-governance`：Build 前置校验与 checkpoint 共用唯一 protected-branch 匹配语义。

## Impact

- 主要影响 Build Plan 领域校验、Change Run 启动输入、CLI 启动适配和 Git Delivery Adapter。
- Runner 继续负责创建、切换并公开 branch/worktree；Runtime 只观察、验证和冻结事实。
- 参考 Comet 0.5.1 的固定 branch binding、执行前 fail-closed 和显式 rebind 原则；不引入 Comet Runtime 依赖，也不把其单仓状态文件模型复制到 Repoctopus。
- 这是预发布 Runtime 的安全修正，不为已在受保护分支执行过副作用的旧 checkpoint 提供隐式兼容。
