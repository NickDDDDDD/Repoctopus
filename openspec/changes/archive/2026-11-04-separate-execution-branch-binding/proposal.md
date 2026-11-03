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
