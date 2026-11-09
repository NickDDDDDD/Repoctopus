# Spec Delta

## ADDED Requirements

### Requirement: 获批 Workspace 接入提供本地使用入口

Repoctopus MUST 在可信用户批准的项目接入中，为 Workspace 根提供 `README.md` 和 `AGENTS.md` 引导，并提供 Workspace 内可直接阅读的使用教程。引导 MUST 适用于独立的多仓 Workspace 和业务仓兼任 Workspace 的单仓项目；接入完成前 MUST 核对这些产物已物化。探测、准备审批、拒绝或请求修改不得安装这些共享文件。

#### Scenario: 全新多仓 Workspace 完成接入

- **WHEN** 用户批准有效多仓候选且接入成功
- **THEN** Workspace 根存在 README 和 AGENTS 引导，README 的本地教程链接可解析，教程说明该 Workspace 与已登记业务仓的关系
- **AND** 业务仓的 README 和 Agent 指令保持原样

#### Scenario: 单仓项目完成接入

- **WHEN** 用户批准业务仓兼任 Workspace 的候选
- **THEN** 引导说明规格、配置与业务代码同仓的用法，不要求额外创建一个 Workspace 仓

#### Scenario: 尚未批准项目接入

- **WHEN** 用户只执行 detect 或 prepare，或者选择 reject 或 request_changes
- **THEN** README、AGENTS 和本地教程保持原样，不产生声称已经接入的文档

### Requirement: Workspace 引导保留团队自有内容

Repoctopus MUST 只创建缺失的引导文件或维护明确标记的 Repoctopus 受管区块，保留区块外原始内容及原有换行格式。重复执行 MUST 不产生重复区块。重复、嵌套或残缺的受管标记、非普通文件及不安全的路径 MUST 返回可定位冲突，不覆盖或解引用该目标，也不得返回成功接入。

#### Scenario: 项目已经有说明和 Agent 规则

- **WHEN** 单仓或多仓 Workspace 已有团队 README 与 AGENTS
- **THEN** 引导只追加或更新自身的唯一受管区块，团队原有文本逐字节保留

#### Scenario: 文件中存在有效旧受管区块

- **WHEN** 新的获批接入请求更新引导
- **THEN** 仅该区块被替换，区块外新加入的团队规则不变，相同输入再次应用不增加重复内容

#### Scenario: 受管标记损坏或目标不是安全普通文件

- **WHEN** 引导目标存在重复或不完整标记，或目标及其路径包含不允许写入的目录、符号链接或越界指向
- **THEN** 接入报告具体冲突，不覆盖该文件或外部目标，不把请求标记为 confirmed

### Requirement: 引导安装沿用接入批准与中断恢复边界

Repoctopus MUST 在接入中预先检查引导目标，并在发布新共享配置和完成状态前完成引导写入。中断或写入失败 MUST 保留原批准、已经完成的 Store 与 pointer 事实及团队内容，允许从同一请求安全续接，不重复产生副作用。已确认请求的重放 MUST 保持原有幂等语义；已接入团队补齐或更新引导 MUST 通过现有的重新探测、准备及可信审批入口。

#### Scenario: 写入部分引导文件后中断

- **WHEN** 获批请求在部分引导已写入、接入完成状态尚未保存时退出
- **THEN** 同一请求的重试保留已写入的唯一受管区块，补齐未完成文件后才保存完成状态，不重复登记或改写已完成的 Store 与 pointer

#### Scenario: 写入前文件被并发修改

- **WHEN** 引导目标在规划后、受管写入前发生变化
- **THEN** 接入停止该次写入并保留新内容，报告冲突且不发布新的完成结论

#### Scenario: 已接入团队补齐引导

- **WHEN** 团队以原有共享配置为候选，通过新的 detect、prepare 和 review 请求获批
- **THEN** 接入复用健康规格根与精确 Store 登记，补齐或更新受管引导，不要求删除已有配置、规格或历史 Run

### Requirement: 人与 Agent 的本地引导使用真实工作流接口

Repoctopus MUST 为团队成员提供可移植的本地教程，覆盖安装入口、新成员接入、启动与恢复 Change、审批、共享与本机配置、SigNoz OTLP 地址以及共享文件提交范围。AGENTS 引导 MUST 使用现有公共 CLI 获取同一 Run 的 continuation、领取 Work 和消费真实 Skill 内容，并保持 Runtime 的阶段、能力与审批权威；不得靠指令文件直接授权阶段推进。

#### Scenario: 新 Agent 进入团队 Workspace

- **WHEN** Agent 读取根 AGENTS 且用户提供了待恢复的 Run 身份
- **THEN** 引导使其使用该 Run 的公共状态与恢复入口，按 Runtime 返回的当前 Work 执行，遇到可信人工决定或未知副作用时按返回结果处理
- **AND** 未提供 Run 身份时先核对新建或恢复意图，不虚构不存在的自动探针、枚举命令或阶段状态

#### Scenario: 团队成员在产品源码之外阅读教程

- **WHEN** 成员仅拥有团队 Workspace、业务仓和已安装 CLI
- **THEN** 可以通过 Workspace 的本地链接找到首次任务、恢复和配置说明，不需要读取产品 checkout 或打开产品 README 才能执行基本操作
- **AND** 示例不包含安装机器的绝对路径、发布凭据、Collector Header 值或维护产品源码用的 Comet 自举指令
