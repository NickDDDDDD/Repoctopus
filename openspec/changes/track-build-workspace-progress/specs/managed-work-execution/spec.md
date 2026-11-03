# managed-work-execution Delta

## ADDED Requirements

### Requirement: Build workspace 进度必须与 Execution Binding 身份分离

Repoctopus MUST 把 `ExecutionBinding` 作为 Strategy、Host、repository、branch/worktree ownership 与初始 revision 的不可变授权基线，并使用独立、Runtime-owned `BuildWorkspaceCheckpoint` 表达 Build 期间逐仓前进的已接受 revision。正常实现 commit MUST NOT 被分类为 Binding identity drift，Host MUST NOT 充当 repository revision digest 的权威。

#### Scenario: 当前 Package 产生合法 commit

- **WHEN** 当前 Execute Work 在获授权 write scope 中产生 commit，所有 branch/worktree/owner/Host 身份保持不变，且新 HEAD 是当前 checkpoint HEAD 的后代
- **THEN** Runtime 接受 Package Completion 并建立下一 checkpoint revision，不返回 Configure，不丢失 Plan 或已完成 package

#### Scenario: Checkout 身份发生变化

- **WHEN** repository branch、isolation、worktree、workspace owner、Host 或 capability 与已接受 Binding 不一致
- **THEN** Runtime 使用现有 Binding revalidation 入口 fail closed，不把身份变化记录为普通 workspace progress

### Requirement: Runtime 必须按 Package write scope 推进 workspace revision

Repoctopus MUST 在每个 Package Completion 前重观察全部登记仓库，以最新 BuildWorkspaceCheckpoint 为基线，仅允许当前 package write scopes 覆盖的仓库保持原 HEAD 或 fast-forward；所有其他仓库 MUST 保持精确 HEAD。Checkpoint 更新、Completion acceptance 与下一 Work 创建 MUST 是同一受管生命周期转换。

#### Scenario: 未授权仓库同时变化

- **WHEN** 当前 package 只写 repository A，但 repository B 的 HEAD 相对 checkpoint 发生变化
- **THEN** Runtime 拒绝 completion 并指出 `unauthorized-head-change`，不吸收 B 的新 revision，也不推进 Task

#### Scenario: 写集仓库历史被改写

- **WHEN** 当前 package 写集中的新 HEAD 不是 checkpoint HEAD 的后代
- **THEN** Runtime 以 `non-fast-forward` fail closed，保留同一 Work/Outcome 供明确修复或 reconciliation

#### Scenario: 幂等恢复时 HEAD 未改变

- **WHEN** Package 实现已经存在于当前 checkpoint HEAD，Host 重新验证并提交完整 Evidence，但没有产生新 commit
- **THEN** Runtime 可以建立语义等价的下一 checkpoint revision并接受 completion，不要求伪造 HEAD 变化

#### Scenario: 兼容 Runtime adoption 后恢复已派发 Work

- **WHEN** composition compatibility gate 已接受精确直接前驱，Run 采用新 composition，但当前 Work 的 Action Intent 与 Work Packet 是采用前冻结的同一旧 snapshot
- **THEN** Runtime 必须按 Intent 与 Packet 的冻结身份恢复并验证 Outcome，不得因其 snapshot digest 不等于 Run 当前 composition digest 而重派发或拒绝

### Requirement: Repository revision Evidence 必须由 Runtime 观察

Repoctopus MUST 从 `build-package-completion` 与 `build-check-candidate` Host result 中排除 repository digest authority。Runtime MUST 通过项目 Git adapter 观察 branch/HEAD、验证 ancestry 并计算 checkpoint digest；Host 只能提交实现、验收、测试、TDD、delegation 与 review Evidence。

#### Scenario: Host 提交自造 repository digest

- **WHEN** Host result 包含旧 `repositoryDigest` 或其他未声明 repository state 字段
- **THEN** Work result schema 拒绝该 submission，且 Runtime 不使用该字段创建 Completion 或 Check Evidence
