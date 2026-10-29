# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 从已通过 Design Human Decision 的版本化 `BuildStrategy` 读取 execution/TDD/review/isolation intent 与 effective Skill composition identity，并根据当前 Run、仓库拓扑、隔离事实与 Host capabilities 解析独立 `ExecutionBinding`。Strategy 以稳定 identity、schema version、semantic digest 和 approval Evidence 固定；Binding 以 repository/branch/head/worktree ownership、capability digest、可移植 semantic digest 和只在本地保存的 path/local digest 固定。Agent 与 Host 只能执行当前 Strategy/Binding，不得增删策略字段、以执行行为反向改写 Strategy，或把机器绑定变化变成人工选择。

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** Design 输入证明任务可按仓库和依赖边界形成 Work Package，Host 声明兼容协调能力，用户在 Design approval 中接受 subagent Strategy
- **THEN** Runtime 固定该 Strategy 并把模式绑定全部 Build Action，Configure 只验证实际 ExecutionBinding

#### Scenario: Host 不支持批准配置

- **WHEN** 恢复时当前 Host 不满足冻结 execution mode 的 capability contract
- **THEN** Runtime 在副作用前寻找或等待兼容 Host 并重新验证 Binding，不静默降级 Strategy；只有请求改变策略语义时才需要新 Human Decision

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner 为批准的 current、branch 或 worktree intent 提供受影响仓库的本地 checkout facts
- **THEN** Runtime 以稳定 repository identity、branch、head、worktree identity、Workspace ownership 与 capability 验证 Binding；绝对路径只保存在本地 Run overlay

#### Scenario: 绑定变化但策略未变

- **WHEN** 同 isolation intent 下 checkout HEAD、Host 或本机路径发生兼容变化
- **THEN** Runtime 生成新 Binding identity、使依赖旧输入的 Plan/Evidence 失效并自动重验，不创建 Build Strategy approval

### Requirement: Plan Evidence 在执行前证明计划可行

Runtime MUST 在创建 Execute Work 前验证 BuildPlan 对批准 Tasks、验收、仓库拓扑、依赖、repository/write scope、terminal report ownership、Host capability、ExecutionBinding、effective Skill/check composition 和 BuildStrategy 的完整覆盖，并持久化绑定当前 Strategy、Binding、composition 与计划摘要的 Plan Evidence。Definition 的有界风险策略 MAY 建立 Human Decision；未触发暂停时 Runtime MAY 自动接受 Evidence，但 Agent 自述理解、计划文件存在、用户曾批准 Design 或检查将在 Execute 后发现 MUST NOT 替代该验证。

#### Scenario: 低风险计划自动通过

- **WHEN** Plan Validator 证明全部 Task/acceptance、仓库边界、write scope、报告归属、能力、绑定和 required checks 被覆盖，且风险策略不要求暂停
- **THEN** Runtime 接受 Plan Evidence 并生成第一个就绪 Execute Work，不创建虚假人工审批

#### Scenario: 计划触发可选人工暂停

- **WHEN** 计划包含 definition 声明的高风险副作用、跨仓不可逆顺序或其他暂停条件
- **THEN** Runtime 建立绑定 Strategy、Binding 与 plan digest 的 Human Decision，在可信决定前不创建 Execute Work

#### Scenario: 计划的 write scope 与任务不一致

- **WHEN** Work Package 请求写入未被 Task、definition 或目标仓库允许的路径
- **THEN** Plan Evidence 返回结构化 planning finding 并留在 Plan revision，不等到 Execute 工具调用后才失败

#### Scenario: 协调器冒充子 Work 终端报告

- **WHEN** subagent 计划把实现者 Outcome 或终端报告归给错误 owner invocation，或只要求协调器自由文本汇总
- **THEN** Plan Evidence 拒绝报告归属并要求修订受管 package/receipt 关系

#### Scenario: 计划输入漂移

- **WHEN** Tasks、验收、仓库拓扑、Strategy、Binding、能力快照、Skill/check composition 或计划 identity 与 Plan Evidence 输入不一致
- **THEN** Runtime 使旧 Evidence 失效并返回 Plan revision 或 Design，不复用旧批准开始执行

## ADDED Requirements

### Requirement: BuildStrategy 与 ExecutionBinding 使用独立身份

Repoctopus MUST 分别持久化可移植 `BuildStrategy` 和本机可重建 `ExecutionBinding`，并让 Work input 同时引用两者。Strategy 变化表示人/团队语义变化；Binding 变化表示执行环境事实变化。Runtime MUST 使用不同 digest、Validator 和失效规则处理二者，且本机绝对路径不得进入 Strategy、OpenSpec 工件、共享配置摘要或 OTLP。

#### Scenario: 相同 Strategy 在另一台机器恢复

- **WHEN** 同一 Run 在具有兼容 Host 与仓库 checkout 的另一台 Runner 恢复
- **THEN** 已批准 Strategy 保持有效，Runtime 为新机器建立并验证新 Binding，再使依赖旧本地输入的 Work/Evidence 精确失效

#### Scenario: isolation intent 改变

- **WHEN** 用户从已批准 worktree Strategy 改为 current
- **THEN** Runtime 把变化视为 Strategy 语义改变并要求新决定，不用新 Binding 静默覆盖原意图
