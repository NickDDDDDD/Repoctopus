# specification-authority Specification

## Purpose

定义 Repoctopus 如何通过单一、可替换的规格权威读取变更事实、执行验证并完成基线同步，使工作流不依赖某个规格工具的目录、命令或产物格式。

## Requirements

### Requirement: 每个 Run 使用唯一规格权威

Repoctopus MUST 为每个项目组合选择一个活动 Specification Provider，并在 Run 中记录 Provider 身份与版本；同一 Run 不得同时从多个规格体系推断权威需求。

#### Scenario: 项目选择 OpenSpec Provider

- **WHEN** 项目组合把 OpenSpec 配置为规格权威
- **THEN** Workflow 通过统一规格能力读取 change、产物和校验结果，不直接读取工具目录

#### Scenario: 多个 Provider 声称权威

- **WHEN** 一个项目组合同时配置两个活动 Specification Provider
- **THEN** App Boot 拒绝 project composition，并报告权威冲突

### Requirement: 规格操作使用稳定领域契约

Repoctopus MUST 通过规范化的 change 身份、产物引用、校验结果、同步结果和关闭结果表达规格操作；Provider 专有路径与 CLI 输出不得泄露为 Workflow 状态规则。

#### Scenario: 更换规格 Provider

- **WHEN** 项目在新的 Run 中选择另一个兼容 Specification Provider
- **THEN** Workflow 继续使用相同领域操作，已有 Run 仍保持原 Provider 快照

### Requirement: 规格校验是推进前置事实

Repoctopus MUST 在 Design 退出、Verify 完成、Archive 开始和规格关闭等受保护转换前，请求当前 Specification Provider 在已校验的 Specification Root 上校验该转换所需产物，并把 Store/Provider/schema identity、规范化 manifest、校验结果和输入摘要作为 Change Run Evidence；调用方自述成功、文件存在或 Git/MR 状态不得替代该事实。

#### Scenario: Delta Spec 严格校验失败

- **WHEN** 规格 Provider 报告当前 change 校验失败
- **THEN** 受保护转换不得推进，Change Run 保持当前 phase/status 并返回可定位的规格诊断

#### Scenario: 校验结果属于旧输入

- **WHEN** Provider 曾经校验成功但当前规划产物或实现输入摘要已经变化
- **THEN** Runtime 使旧校验失效并请求新结果，不把缓存成功用于当前转换

### Requirement: 规格资料冲突产生人工决定

Repoctopus MUST 在规格、设计图、接口契约或其他权威资料存在实质冲突时停止受影响工作，生成结构化 Human Decision，并在用户决定同步到权威资料后才继续。

#### Scenario: 设计图与规格行为不一致

- **WHEN** Agent 或验证 Adapter 发现设计图要求与规格要求冲突
- **THEN** 系统记录双方来源和影响范围，阻断受影响步骤，不自动选择设计图或规格

### Requirement: 同步和关闭可重试且幂等

Repoctopus MUST 让 Specification Provider 对同一 change、同一合入事实和同一目标基线重复执行同步与关闭时返回同一逻辑结果，不重复归档或覆盖不同内容。

#### Scenario: 关闭成功后的投递重放

- **WHEN** 相同的合入后任务因超时再次请求关闭已关闭 change
- **THEN** Provider 返回既有关闭身份和结果，不创建第二份归档

### Requirement: OpenSpec Provider 遵循官方产物生命周期

OpenSpec Provider MUST 使用 OpenSpec 官方命令和状态模型创建、校验、同步与归档产物，并保留 Proposal、Design、Delta Specs、Tasks 和验证记录之间的可追溯关系；Provider 不得把 schema 未声明的实施笔记推断成额外规划产物。

#### Scenario: Change 满足关闭条件

- **WHEN** 合入后验证通过且 delta specs 可以同步到主规格
- **THEN** Provider 使用官方生命周期同步主规格并归档 change，补全新 capability 的 Purpose，严格校验受影响主规格，再返回变更文件清单和归档身份

#### Scenario: 新 capability 缺少可追溯 Purpose

- **WHEN** change 创建新 capability，但 Proposal 的 New Capabilities 没有为它提供说明
- **THEN** Provider 在调用归档副作用前阻断关闭，不发布带占位 Purpose 或未通过严格校验的最终 Change MR

#### Scenario: Change 目录包含非 schema 文档

- **WHEN** OpenSpec 状态没有把某个 Markdown 文件声明为产物
- **THEN** Provider 不把该文件映射成额外的规格或验证产物

### Requirement: 架构决定由规格 change 的设计产物记录

Repoctopus 开发工作流 MUST 把当前 change 内的普通设计决定、实施约束和偏差记录到当前 Provider 声明的设计产物，把测试事实记录到 Evidence 和正式验证报告；长期、难回退或跨边界的架构变更必须为该工作单独建立一个普通 change，并由其设计产物保留背景、备选方案、取舍、迁移与回退方式。工作流不得建立特殊的架构 change 类型、独立 ADR 或实施日志作为第二套决策权威。

#### Scenario: 局部实现约束不跨越当前 change

- **WHEN** 实施发现只影响当前 change 且可在同一设计边界内回退的约束
- **THEN** Agent 更新当前 Provider 声明的设计产物，不创建额外实施笔记或独立决策台账

#### Scenario: 决定具有长期架构影响

- **WHEN** 决定跨越 change、难以回退或影响公共契约、持久数据、安全或团队边界
- **THEN** Agent 为该工作单独建立一个普通 change，在其设计产物中说明背景、备选方案、取舍、迁移与回退方式，并通过正常评审取得确认

#### Scenario: 纯内部架构调整不改变行为契约

- **WHEN** OpenSpec change 只改变内部架构且没有规格级行为变化
- **THEN** change 使用 `skip_specs: true` 并在 `design.md` 记录决定，不为满足流程而虚构 delta spec

#### Scenario: 项目替换 Specification Provider

- **WHEN** 新 Run 选择实现稳定 Specification 契约的另一个 Provider
- **THEN** 工作流使用该 Provider 声明的设计产物和生命周期，不依赖 OpenSpec 的路径、文件名或独立 ADR

### Requirement: 规划批准独立于 Change MR

Repoctopus MUST 在没有 Change MR 的情况下，通过当前 Specification Provider 校验 Proposal、Design、Delta Specs 和 Tasks，并使用结构化 Human Decision 记录批准、要求修改或拒绝；批准必须绑定 change、Provider、规范化规划语义摘要、受影响能力和目标分支。Change 分支必须已公开且其远端 OID作为发布来源记录，但非规划 commit 不得仅因改变分支 OID 而使语义批准失效。

#### Scenario: 规划产物通过校验并获得批准

- **WHEN** 四类规划产物均由当前 Provider 声明为完成，Change 分支已公开且可信用户批准对应语义摘要
- **THEN** Change Run 记录 Design approval Evidence，并允许进入 Build

#### Scenario: Provider 校验失败

- **WHEN** 任一规划产物缺失、无效或与当前 Provider 状态不一致
- **THEN** Runtime 不创建批准请求或进入 Build，并返回 Provider 的可定位诊断

#### Scenario: 没有可信人工交互通道

- **WHEN** Runtime 无法确认规划决定来自可信用户交互上下文
- **THEN** Runtime 保持 `design/waiting`，Agent、Runner、commit 和 MR 状态不得代替用户批准

#### Scenario: 批准后规划分支发生变化

- **WHEN** 四类产物语义摘要、受影响能力、Provider 或目标分支与已批准事实不同
- **THEN** Runtime 使旧批准失效、返回 Design 并要求重新校验和人工决定

#### Scenario: Task 只更新完成 checkbox

- **WHEN** 已批准 Tasks 的稳定 ID、文字、结构、依赖、验收和需求映射未变，只有有效 Work 完成导致 checkbox 状态变化
- **THEN** Provider 的规划语义摘要保持不变，Runtime 不要求重新批准 Design

#### Scenario: Change 分支只增加非规划提交

- **WHEN** Change 分支远端 OID 因实现、测试或合法收尾提交变化，但规划语义摘要与目标分支不变
- **THEN** Runtime 更新 publication provenance，既有 Design approval 不仅因 OID 变化而失效

#### Scenario: 规划批准后尚未完成实现

- **WHEN** Change 已获得 Design approval 但 Verify 和 Archive 尚未完成
- **THEN** Runtime 不创建最终 Change MR，也不把 Design approval 解释为验证、远端副作用授权或规格关闭

### Requirement: Workspace Store 是规划根的稳定权威

Repoctopus MUST 将当前 Workspace Repository 登记为 OpenSpec Store，并以稳定 `storeId` 和 `workspaceRepositoryId` 标识 Specification Root；Runtime 调用 OpenSpec 时必须显式选择该 Store 并校验当前 Runner 的 registry、Store metadata 与 Workspace checkout 一致，不得依赖绝对路径、nearest root、default Store、Workset 或业务仓 pointer 推断权威根。单仓场景 MAY 让 Workspace、Store 与实现仓物理合一，多仓场景不得因此新增独立规格仓。

#### Scenario: 单仓自举使用同一个物理仓

- **WHEN** Workspace Repository 同时承载 Repoctopus 实现与 OpenSpec Store
- **THEN** Runtime 以不同 repository role 表达相同物理仓，并从显式 Store 读取唯一四类规划产物

#### Scenario: Runner 尚未登记 Store

- **WHEN** 当前 Runner 的 OpenSpec registry 没有该 `storeId` 或指向另一个 checkout
- **THEN** Runtime 阻塞受保护转换并返回可恢复的登记诊断，不回退到默认或最近的规格根

#### Scenario: 业务仓存在本地规格根

- **WHEN** 业务仓已有本地 `specs` 或 `changes`，其解析优先级会遮蔽 Store pointer
- **THEN** Runtime 将其报告为 authority conflict 并要求显式迁移，不覆盖、合并猜测或把两个根都视为权威

### Requirement: OpenSpec 官方 schema 和模板保持结构权威

Repoctopus MUST 从固定 OpenSpec Provider 版本取得当前 schema 的 artifact instructions/template，并只承认 Proposal、Delta Specs、Design、Tasks 四类规划工件；augmentation Skill 与不可执行 Method Profile MAY 增强内容质量和验证，但不得替换官方结构、创建第五类工件、发布第二套 ticket 权威或改变 Provider 的完成判定。

#### Scenario: 采用的方法建议额外规格文档

- **WHEN** augmentation Skill 或 Method Profile 的来源流程会生成独立 spec、ticket 文件或外部 tracker 项
- **THEN** Runtime 只采用可映射进四类工件的规则，并拒绝把额外产物纳入规划权威

#### Scenario: 固定 OpenSpec 模板发生漂移

- **WHEN** Provider 返回的 schema/version/template digest 与当前 Change Run 的规划输入不兼容
- **THEN** Runtime 使未完成的 Design Work 失效或进入 `migration_required`，不得静默使用 Repoctopus 内置副本
