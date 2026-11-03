## MODIFIED Requirements

### Requirement: Build Execute 前必须证明全部可写仓绑定合法 source branch

Runtime MUST 在 Build Plan 给出精确 write scopes 后、接受 Plan Evidence 或创建任何 Execute Work 前，把可写 repository 集合与冻结的 Execution Binding 和 protected branch policy 联合校验。匹配 protected pattern 的可写仓 MUST 被拒绝；只读仓 MUST NOT 因停留在 target/protected branch 被无关阻断。Runner 负责准备并公开 source branch/worktree，Runtime 不执行 Git branch 副作用。

当 Plan 因 protected branch finding 被拒绝后，Runtime MUST 把 rejected `build-plan-candidate`、精确 write scopes、旧 Execution Binding、protected policy 与 project snapshot 作为修正授权证据。Runner 完成对应 branch-only 修正后，无论通过 `run next` 还是进程重启后的 `run resume` 拉取，Runtime MUST 使用同一 classifier 建立新 Binding revision、精确失效旧 Plan checkpoint 并在同一 Run 重新派发 Build Configure。只有授权集合内仓库的 attached branch 变化可以走该路径；任何无关 branch、path、remote、topology、repository add/remove、worktree ownership、Host 或 capability 变化 MUST 继续进入通用 reconciliation 并 fail closed。

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

#### Scenario: 断点后通过 resume 恢复精确 branch 修正

- **WHEN** Plan 因 protected branch finding 被拒绝，Runner 只为 finding 中的可写仓准备并公开合法 attached source branches，随后 Host 进程重启并对同一 Run 调用 `run resume`
- **THEN** Runtime 使用与 `run next` 相同的授权 classifier，在同一 Run 创建一个 Build Configure revalidation Work，不设置 `reconciliationRequired`，也不丢失 Design approval、Build Strategy、Tasks 或 rejected outcome

#### Scenario: 已被错误标记的 matching Run 恢复

- **WHEN** 既有 `reconciliationRequired` 仅由同一 rejected Plan 要求的 branch-only 修正产生，且当前 frozen evidence、snapshot diff 与 protected write-set 仍精确匹配
- **THEN** Runtime 原子记录 authorized rebind、清除该 matching reconciliation projection并派发唯一的 Build Configure Work，重复 resume 保持幂等

#### Scenario: branch 修正夹带无关身份漂移

- **WHEN** Runner 修正 protected write repositories 的同时改变了无关仓 branch，或任一 checkout path、remote、topology、repository membership、worktree ownership、Host 或 capability 发生变化
- **THEN** Runtime 不授予 authorized rebind，保留或设置 `reconciliationRequired` 并 fail closed，不创建 Configure、Plan Evidence 或 Execute Work

#### Scenario: 多个 protected 写仓只完成部分修正

- **WHEN** rejected Plan 包含多个 protected write repositories，而当前 snapshot 只证明其中一部分已切换并公开合法 source branch
- **THEN** Runtime 不授予任何仍位于 protected branch 仓库的写权限，并以 next/resume 一致的结构化状态等待剩余修正或重新配置，不创建 Execute Work
