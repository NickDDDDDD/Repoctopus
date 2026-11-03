# Proposal

## Why

真实五仓验收在首个 `build.execute` 成功、提交并 push 后暴露了核心缺陷：Runtime 把当前 Work 合法产生的 HEAD 前进误判为 Execution Binding drift，先于 Package Completion 验收退回 Configure，并清空 Plan 与 completion。这样任何真实 Build 都无法跨过第一个提交。

根因是 `ExecutionBinding` 同时承担“稳定 checkout 身份”和“不断前进的实现 revision”两种职责。Comet Classic/Native 在 Build 中只用 branch/worktree identity 防止接管错误，把 HEAD 前进作为执行结果或最终验证对象；Repoctopus 的多仓模型需要同样分离身份与进度，并为每个仓保存精确 revision。

## What Changes

- 保留 `ExecutionBinding` 作为 Strategy、Host、仓库、branch/worktree ownership 与初始基线的不可变授权。
- 增加 Runtime-owned `BuildWorkspaceCheckpoint`，逐仓记录当前已接受 HEAD；每个 Package Completion 原子推进 checkpoint。
- 当前 package 只能让自身 write scopes 覆盖的仓库发生 fast-forward；未授权仓库必须保持精确 revision，改 branch、worktree、owner、Host 或 capability 仍进入 Binding revalidation。
- Host 不再为 Package/Check Outcome 声明无法独立证明的 `repositoryDigest`；Runtime 观察 Git facts、校验 ancestry 并生成 checkpoint digest。
- Build Check 和 Verify 绑定最终 workspace checkpoint；review 期间出现代码变化必须返回 repair，而不能静默吸收。
- 增加低基数 trajectory/OTLP 事件，区分合法 progress advance、未授权 head change、non-fast-forward 与真正 Binding drift。
- 统一 Planning approval 与 Archive publication 使用的规范化 Git remote identity，配置内 repository id 只标识 Repoctopus 拓扑，不再冒充远端仓库身份。

## Capabilities

### Modified Capabilities

- `managed-work-execution`: 分离不可变 Execution Binding 与 Runtime-owned workspace progress。
- `change-lifecycle`: Package Completion 原子推进 checkpoint，且只失效真正依赖变化的事实。
- `development-telemetry`: 记录 workspace progress 的接受与拒绝分类。
- `delivery-governance`: Change branch approval 与 Publication 共享同一 Workspace Repository remote identity。

## Non-goals

- 不允许 Host 或 Agent 直接改 phase、Binding、checkpoint 或 Store。
- 不把 commit/push/MR 发布并入 Build Runtime；发布仍由 Runner 与 Delivery/Archive 负责。
- 不保留通配旧协议兼容；只允许经过证明的精确直接前驱 adoption。
- 不增加新的 repair lifecycle、第五类 OpenSpec 文档或后台守护进程。
