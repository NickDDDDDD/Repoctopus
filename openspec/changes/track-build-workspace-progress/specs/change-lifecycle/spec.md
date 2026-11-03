# change-lifecycle Delta

## ADDED Requirements

### Requirement: Package Completion 必须原子推进 Build workspace checkpoint

Repoctopus MUST 在接受 Execute Outcome 时，把 Outcome validation、Runtime Git observation、Package Completion、Specification Task receipt、BuildWorkspaceCheckpoint 和下一 Runtime-selected Work 作为单一可恢复转换处理。任何一步失败 MUST 不得留下已完成 Task、半更新 checkpoint 或无 Plan 的 Configure 状态。

#### Scenario: 首个多仓 Package 完成

- **WHEN** 三个有序 package 的首包通过验证并合法推进其写集仓库 HEAD
- **THEN** Run 保留原 Plan/Plan Evidence，记录 1 个 completion 与新 checkpoint，并直接派发第二个 ready Execute Work

#### Scenario: Completion 验证失败

- **WHEN** Evidence、write scope、repository ancestry 或当前 Work identity 任一验证失败
- **THEN** Runtime 保留当前 Work 与最后接受的 checkpoint，不完成 Task、不创建下一 Work且不回退整个 Build Protocol

### Requirement: Build Check 必须验证最终 workspace checkpoint

Repoctopus MUST 让 Build Check 绑定全部 Package Completion 后的最终 BuildWorkspaceCheckpoint。Check Outcome 接受前 live workspace MUST 与该 checkpoint 精确一致；review 期间需要代码修改时 MUST 返回 finding 并由 Runtime 派发后续 Build repair，而不是静默推进 Verify。

#### Scenario: Check 观察到额外 commit

- **WHEN** Build Check 执行期间任一登记仓库 HEAD 超出冻结 checkpoint
- **THEN** Runtime 拒绝 Check Evidence、保留 Build 状态并要求明确 repair/replan，不把额外 commit 自动纳入已验证结果

### Requirement: Workspace progress 恢复必须 fail closed

Repoctopus MUST 只从持久 Binding、BuildWorkspaceCheckpoint、Package Completion 和 Git observation 恢复 Build 进度。精确直接前驱只有在能够从 Configure 重新建立 checkpoint 时才可 adoption；其他旧状态 MUST 进入 migration required，不能猜测 revision 或修改 Store。

#### Scenario: 从旧 head-revalidation checkpoint 恢复

- **WHEN** 旧 Run 已由错误逻辑回到 Configure，当前 branch/ownership/Host 可重新验证且没有已接受 completion
- **THEN** Runtime 可以接受新 Binding 并从当前 HEAD 建立初始 checkpoint，重新产生 Plan，而不沿用旧错误 Plan Evidence
