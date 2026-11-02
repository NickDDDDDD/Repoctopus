# project-configuration Delta

## MODIFIED Requirements

### Requirement: 项目探测只生成候选草稿

`project detect` MUST 只读扫描显式作用域内的仓库和常见构建文件，把候选配置写入 `.repoctopus/drafts/`，不得直接创建或覆盖正式共享配置。为探测出的 Change Verify 命令生成候选时，required 节点 MUST 使用显式、保守的 workspace-wide Acceptance selector，并 MUST 把该 coverage 选择登记为待人工复核项；Runtime MUST NOT 猜测未来 Task 或 Requirement selector。

#### Scenario: 首次探测项目

- **WHEN** 工作区尚无 `repoctopus.yaml`
- **THEN** 命令生成带来源和不确定项的候选草稿，并提示由 Agent 补全后交给用户确认
- **AND** 每个探测出的 required Verify 命令显式声明 `covers: ['*']`，其 workspace-wide coverage 被标记为需要确认或收窄

#### Scenario: 已存在共享配置

- **WHEN** 探测结果与当前 `repoctopus.yaml` 不同
- **THEN** 命令输出 reconcile diff 且保持正式配置不变

### Requirement: 用户确认后才能写入共享配置

Repoctopus MUST 把候选配置、Agent 补全内容和现有配置差异作为 Human Decision 输入，只有可信用户确认后才允许生成或更新 `repoctopus.yaml`。约定的默认 Change `verify` Profile MUST 在建立审批请求前存在，并至少包含一个声明非空 Acceptance coverage 的 required 节点；完全无 coverage 或只有 optional coverage 的候选 MUST 被拒绝。具体 Run 显式选择的其他 `verificationProfileId` MUST 由该 Run 的 Design preflight 精确校验。

#### Scenario: 没有可信确认通道

- **WHEN** Agent 已补全候选配置但 Runtime 无法获得可信用户决定
- **THEN** 草稿保持待确认状态且正式配置不变

#### Scenario: Verify Profile 没有 required coverage

- **WHEN** 候选 `verify` Profile 的节点全部未声明 coverage，或 coverage 只存在于 optional 节点
- **THEN** Repoctopus 在创建可批准请求和写正式配置前拒绝候选，并指出需要 `*`、`task:`、`requirement:` 或精确 Acceptance selector

#### Scenario: 前置节点不直接覆盖 Acceptance

- **WHEN** Profile 至少有一个 required 验证节点声明 coverage，另有 service 或准备节点不直接覆盖 Acceptance
- **THEN** 静态可用性检查允许该结构，精确覆盖关系交给 Change Design preflight 判断

