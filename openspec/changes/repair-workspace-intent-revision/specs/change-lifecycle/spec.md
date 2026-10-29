# change-lifecycle Specification Delta

## MODIFIED Requirements

### Requirement: Open 在规划批准前固定执行隔离意图

Repoctopus MUST 在接受 Open approval 前取得可信用户对 `current|branch|worktree` 的一次选择，并使用冻结的 project snapshot、repository topology 与 checkout facts 验证候选 `ExecutionWorkspaceIntent` 后，才把模式、目标分支语义和 Workspace/change identity 固定到同一 Run；无效选择不得改变 lifecycle 或 Specification approval Store。本机 checkout 绝对路径不得进入 OpenSpec 工件或可移植语义摘要。Build Configure MUST 复核实际 binding，任何调用方不得在批准后静默换成另一模式；若未批准 Build Configuration 时发现既有 intent 与真实 checkout 不兼容，Runtime MUST 在同一确定性 Run 中受保护地返回 Open 取得新的 isolation 决策，清除依赖旧 intent 的下游状态，并在新 intent 验证通过后进入新的 Design Work，不得要求创建第二个 Run或编辑 Store。

#### Scenario: Open 尚未选择隔离方式

- **WHEN** 四类 OpenSpec 工件已有效但当前 Run 没有可信 isolation 决定
- **THEN** Runtime 保持 `phase=open,status=waiting` 并展示三个模式的实际影响，不创建 Design Work

#### Scenario: Open 选择与 checkout facts 不兼容

- **WHEN** 当前注册 checkout 是 linked worktree而用户在 Open 决策中选择 `current`
- **THEN** Runtime 在写入 lifecycle intent 或 Specification approval 之前拒绝该选择并保持同一 Human Decision request 可重试

#### Scenario: Build 发现 binding 与 Open 意图不一致

- **WHEN** 未批准 Build Configuration 的 Configure Work 发现 Open intent 与真实 checkout 的 isolation/ownership facts 不兼容
- **THEN** Runtime 在同一 runId 受保护地返回 Open wait，清除旧 intent、Tasks、Build Protocol 与 Verify/Archive 输入；可信用户选择的新 intent 再次绑定成功后进入新的 Design Work

#### Scenario: Binding failure 不是 isolation 问题

- **WHEN** Build Configure 发现 remote repository identity 或 repository topology 与冻结 project snapshot 不一致
- **THEN** Runtime fail closed并报告不可通过 isolation 修订解决的诊断，不提供自动降级或误导性的模式选择

#### Scenario: 同一 Change 被再次启动

- **WHEN** 调用方试图通过再次 `run start` 绕过错误的 intent
- **THEN** Runtime 恢复由 Workspace/change identity 确定的原 Run，要求走正式 intent 修订 transition，不创建第二个 Run
