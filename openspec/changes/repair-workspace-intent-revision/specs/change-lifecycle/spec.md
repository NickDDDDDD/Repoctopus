# change-lifecycle Specification Delta

## MODIFIED Requirements

### Requirement: Open 在规划批准前固定执行隔离意图

Repoctopus MUST 在接受 Open approval 前验证可信用户选择的 `current|branch|worktree` 与冻结的 project snapshot、repository topology 和 checkout facts 兼容，再把 `ExecutionWorkspaceIntent` 固定到同一 Run；无效选择不得写入 lifecycle 或 Specification approval Store，本机绝对路径不得进入可移植语义。Build Configure MUST 由 binding 权威把失败分类为 `intent-revision | binding-retry | halt`，调用方不得解析错误文本或静默降级。只有未批准 Build Configuration 的 `intent-revision` 可以在同一 Run 返回 Open；新意图获批前必须清除依赖旧意图的下游状态，随后创建新的 Design Work。

#### Scenario: Open 尚未选择隔离方式

- **WHEN** 四类 OpenSpec 工件已有效但当前 Run 没有可信 isolation 决定
- **THEN** Runtime 保持 `phase=open,status=waiting` 并展示三个模式的实际影响，不创建 Design Work

#### Scenario: Open 选择与 checkout facts 不兼容

- **WHEN** 当前注册 checkout 是 linked worktree而用户在 Open 决策中选择 `current`
- **THEN** Runtime 在写入 lifecycle intent 或 Specification approval 之前拒绝该选择并保持同一 Human Decision request 可重试

#### Scenario: Build 发现 binding 与 Open 意图不一致

- **WHEN** 未批准 Build Configuration 的 Configure Work 发现 Open intent 与真实 checkout 的 isolation/ownership facts 不兼容
- **THEN** Runtime 在同一 runId 受保护地返回 Open wait，清除旧 intent、Tasks、Build Protocol 与 Verify/Archive 输入；可信用户选择的新 intent 再次绑定成功后进入新的 Design Work

#### Scenario: Intent 修订 wait 被重复 pull

- **WHEN** Run 正在 Open 的 `workspace-intent:*` Human Decision wait 中且调用方重复执行 `run next`
- **THEN** Runtime 原样返回同一 waitId 与 checkEpoch，不创建或替换为普通 `open-approval:*` wait；只有匹配 request 的可信 isolation 决定可以推进到新的 Design Work

#### Scenario: Binding failure 不是 isolation 问题

- **WHEN** Build Configure 发现 remote repository identity 或 repository topology 与冻结 project snapshot 不一致
- **THEN** Runtime fail closed并报告不可通过 isolation 修订解决的诊断，不提供自动降级或误导性的模式选择

#### Scenario: Binding 可在原 intent 下修复

- **WHEN** intent 本身合法但 Runner 提供了错误 checkout path、branch 或缺少 worktree ownership facts
- **THEN** binding 权威返回 `binding-retry`，Runtime 保持 Build 和原 intent并要求修复 binding，不返回 Open要求用户改变模式

#### Scenario: 同一 Change 被再次启动

- **WHEN** 调用方试图通过再次 `run start` 绕过错误的 intent
- **THEN** Runtime 恢复由 Workspace/change identity 确定的原 Run，要求走正式 intent 修订 transition，不创建第二个 Run
