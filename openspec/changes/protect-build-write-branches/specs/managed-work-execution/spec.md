# Spec Delta

## ADDED Requirements

### Requirement: Build Execute 前必须证明全部可写仓绑定合法 source branch

Runtime MUST 在 Build Plan 给出精确 write scopes 后、接受 Plan Evidence 或创建任何 Execute Work 前，把可写 repository 集合与冻结的 Execution Binding 和 protected branch policy 联合校验。匹配 protected pattern 的可写仓 MUST 被拒绝；只读仓 MUST NOT 因停留在 target/protected branch 被无关阻断。Runner 负责准备并公开 source branch/worktree，Runtime 不执行 Git branch 副作用。

#### Scenario: 可写业务仓仍绑定 main

- **WHEN** 已验证 Plan 的 package write scope 包含 `web-design`，而当前 Execution Binding 把该仓绑定到受保护的 `main`
- **THEN** Runtime 在 Plan Outcome 终态化、Plan Evidence 和 Execute Work 之前返回结构化 finding，且不授予任何业务写权限

#### Scenario: 只读业务仓停留在 main

- **WHEN** `backend` 只作为读取或验证依赖出现在 Plan 中且没有任何 write scope，并绑定受保护的 `main`
- **THEN** Runtime 不因该只读仓拒绝 Plan，仍持续校验其 Binding 漂移和 HEAD 一致性

#### Scenario: 可写仓使用合法功能分支

- **WHEN** 每个 write scope repository 均绑定不匹配任何 protected pattern 的 attached source branch或合法 worktree
- **THEN** Runtime 可以继续接受 Plan Evidence并创建第一个就绪 Execute Work

#### Scenario: Runner 修正被拒绝的 checkout

- **WHEN** Plan 因 protected branch finding 被拒绝后，Runner 为相关仓准备并公开合法 source branch/worktree，再次拉取同一 Run
- **THEN** Runtime 通过既有 Binding drift/reconfigure 协议建立新 Binding revision，使旧 Plan 精确失效并重新规划，不要求编辑 Store 或启动第二个 Change Run
