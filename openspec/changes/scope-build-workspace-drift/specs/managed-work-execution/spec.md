## MODIFIED Requirements

### Requirement: Runtime 必须按 Package write scope 推进 workspace revision

Repoctopus MUST 在接受 Package Completion 前，根据 BuildWorkspaceCheckpoint 重观察登记仓库并校验仓库、分支及 checkout 身份。受管实现提交 MUST 满足当前 Package 的写范围、Git 祖先关系与 Evidence。对于写范围外的 fast-forward，Runtime MUST 按已验证的包输入、检查和交付边界判定影响。只有能证明无关的外部变化才可继续使用当前证据，且 SHALL NOT 记为当前包的实现或扩大交付范围。无法确定影响范围、存在越权写入或历史改写时 MUST 保留最后安全状态并指出原因。Checkpoint 更新、Completion acceptance 与下一 Work 创建 MUST 是同一受管生命周期转换。

#### Scenario: 只读仓同步与当前工作无关

- **WHEN** Framework 包正在验收，已绑定的 Web Front 只读仓 fast-forward，Runtime 证明变化不影响当前包所消费的输入
- **THEN** Runtime 接受满足原写范围和证据要求的 Framework Completion，且 SHALL NOT 将 Web Front 的提交记为实现或交付结果

#### Scenario: 包外业务提交与当前工作无关

- **WHEN** 已绑定的 Backend 仓收到当前包写范围外的业务提交，且 Runtime 可证明其快进与当前包有效输入及交付范围无关
- **THEN** Runtime 保留同一 Run 和有效进度，且 SHALL NOT 把外部提交纳入当前 Change 的发布范围

#### Scenario: 外部变化触及真实依赖

- **WHEN** 已绑定仓库的快进改变包实际消费的输入
- **THEN** Runtime MUST 拒绝依赖旧输入的新 Outcome，只复核影响范围及其依赖者，并保留无关完成事实

#### Scenario: 未授权仓库同时变化

- **WHEN** Runtime 不能证明写范围外的变化是无关的外部快进，或观察到越权工作区修改
- **THEN** Runtime MUST 返回明确原因，保留最后接受的 checkpoint，且 SHALL NOT 接受 Completion 或推进 Task

#### Scenario: 写集仓库历史被改写

- **WHEN** 当前包写集的新 HEAD 不是 checkpoint HEAD 的后代
- **THEN** Runtime MUST 拒绝新的 workspace revision，保留已有受管状态供明确修复

#### Scenario: 幂等恢复时 HEAD 未改变

- **WHEN** 包实现已在 checkpoint HEAD 中，Host 重新验证并提交完整 Evidence，且没有产生新 commit
- **THEN** Runtime MAY 建立语义等价的下一 checkpoint 并接受 Completion，无需伪造 HEAD 变化

#### Scenario: 兼容 Runtime adoption 后恢复已派发 Work

- **WHEN** composition compatibility gate 已接受精确直接前驱，Run 采用新 composition，但当前 Work 的 Action Intent 与 Work Packet 是采用前冻结的同一旧 snapshot
- **THEN** Runtime 必须按 Intent 与 Packet 的冻结身份恢复并验证 Outcome，不得因其 snapshot digest 不等于 Run 当前 composition digest 而重派发或拒绝
