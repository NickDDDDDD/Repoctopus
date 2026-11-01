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

Repoctopus MUST 通过规范化的 change 身份、工件引用、工件满足状态、校验结果、同步结果和关闭结果表达规格操作；Provider 专有路径、CLI 输出、状态名称与跳过规则不得泄露为 Workflow 状态规则。

#### Scenario: 更换规格 Provider

- **WHEN** 项目在新的 Run 中选择另一个兼容 Specification Provider
- **THEN** Workflow 继续使用相同领域操作，已有 Run 仍保持原 Provider 快照

#### Scenario: Provider 报告可选工件已跳过

- **WHEN** 当前 schema 与 Change 元数据允许某类规划工件被跳过，且 Provider 报告其官方状态为 `skipped`
- **THEN** Provider 投影带稳定 digest 的 `skipped` 工件，Workflow 将其视为已满足但不伪装成存在的文件

#### Scenario: Provider 报告必需工件缺失

- **WHEN** 当前 schema 要求某类工件且 Provider 未找到有效输出
- **THEN** Provider 投影 `missing`，Workflow 阻断受保护转换且不从路径、文件数量或其他工件推断满足

#### Scenario: Provider 返回信息诊断

- **WHEN** Provider 校验结果包含 `info`、`warning` 和 `error` 级别诊断
- **THEN** 领域契约逐项保留三个严重级别、代码、消息和可用工件定位，不把 `info` 或未知文本静默改写为 `error`

#### Scenario: Provider 返回未知严重级别

- **WHEN** 外部 Provider 返回领域契约不认识的诊断严重级别
- **THEN** Provider fail closed 并返回可定位的契约错误，不把未知值降级为 `info` 或 `warning`

### Requirement: 规格校验是推进前置事实

Repoctopus MUST 在 Open/Design 审查、Verify 完成、Archive 开始和规格关闭等受保护转换前，请求当前 Specification Provider 在已校验的 Specification Root 上校验该转换所需工件，并把 Store/Provider/schema identity、规范化 manifest、工件满足状态、校验结果和输入摘要作为 Change Run Evidence；调用方自述成功、文件存在、Git/MR 状态或 Workflow 对 Provider 输出的二次推断不得替代该事实。有效校验结果不得包含 `error` 诊断。

#### Scenario: Delta Spec 严格校验失败

- **WHEN** 规格 Provider 报告当前 change 校验失败
- **THEN** 受保护转换不得推进，Change Run 保持当前 phase/status 并返回可定位的规格诊断

#### Scenario: 校验结果属于旧输入

- **WHEN** Provider 曾经校验成功但当前规划产物、工件满足状态或实现输入摘要已经变化
- **THEN** Runtime 使旧校验失效并请求新结果，不把缓存成功用于当前转换

#### Scenario: Provider 同时报成功和错误诊断

- **WHEN** 外部 Provider 报告 `valid: true` 但规范化诊断中存在 `error`
- **THEN** Specification Provider 将结果视为无效的契约冲突，阻断转换并保留错误诊断供定位

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

Repoctopus MUST 在没有 Change MR 的情况下，通过当前 Specification Provider 校验 Proposal、Design、Delta Specs 和 Tasks，并使用结构化 Human Decision 记录批准、要求修改或拒绝；批准 MUST 绑定 change、Provider/schema、规范化规划语义身份、受影响能力和规范化目标分支身份。Change 分支 MUST 已公开并把 publication provenance 作为独立发布事实记录；composition、Build configuration/plan、执行进度、实现提交和 source remote/OID 不得进入 approval semantic identity，也不得单独使批准失效。

#### Scenario: 规划产物通过校验并获得批准

- **WHEN** 四类规划产物均由当前 Provider 声明为完成，Change 分支已公开且可信用户批准对应语义身份
- **THEN** Change Run 记录 Design approval Evidence，并允许进入 Build

#### Scenario: Provider 校验失败

- **WHEN** 任一规划产物缺失、无效或与当前 Provider 状态不一致
- **THEN** Runtime 不创建批准请求或进入 Build，并返回 Provider 的可定位诊断

#### Scenario: 没有可信人工交互通道

- **WHEN** Runtime 无法确认规划决定来自可信用户交互上下文
- **THEN** Runtime 保持 `design/waiting`，Agent、Runner、commit 和 MR 状态不得代替用户批准

#### Scenario: 批准后规划分支发生变化

- **WHEN** 四类产物语义、受影响能力、Provider/schema 或规范化目标分支身份与已批准事实不同
- **THEN** Runtime 使旧批准失效、返回 Design 并要求重新校验和人工决定

#### Scenario: Task 只更新完成 checkbox

- **WHEN** 已批准 Tasks 的稳定 ID、文字、结构、依赖、验收和需求映射未变，只有有效 Work 完成导致 checkbox 状态变化
- **THEN** Provider 的规划语义身份保持不变，Runtime 不要求重新批准 Design

#### Scenario: Change 分支只增加非规划提交

- **WHEN** Change 分支远端 OID 因实现、测试或合法收尾提交变化，但规划语义身份与目标分支不变
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

### Requirement: Change 元数据参与规划语义身份

Specification Provider MUST 把会改变验证、关闭或能力退役行为的 Change-local 元数据纳入规范化规划语义摘要；仅修改实现、测试或其他非规划文件不得改变该摘要。

#### Scenario: Archive 元数据在批准后变化

- **WHEN** `.openspec.yaml` 的 `retire_capabilities` 或其他 Provider 语义字段在 Design approval 后变化
- **THEN** Runtime 检测到新的 planning semantic digest，使旧批准失效并返回 Design

#### Scenario: 非规划提交只更新发布来源

- **WHEN** Change 分支新增实现或测试提交但四类规划工件、Change 元数据、Provider/schema、能力集合和目标分支均未变化
- **THEN** Runtime 只更新 publication provenance，不撤销相同语义快照的 Design approval

### Requirement: 规格关闭先形成隔离候选再签发 Receipt

Specification Provider MUST 在隔离的 Workspace checkout 中把关闭计划应用为候选结果，并在签发 Closure Receipt 前核对活动 change 已移除、恰好新增一个预期归档目录、继续存在的受影响主规格已同步、显式退役的 capability 主规格已删除、允许路径差异成立且全局严格校验通过；Closure Receipt MUST 绑定不透明 candidate checkout identity 与创建候选时的 base OID。Provider 在最终规格发布达到可远端恢复终态前不得把候选复制到调用者工作树、移动调用者 branch/HEAD、修改其 index，或删除唯一候选 checkout。

#### Scenario: OpenSpec 已移动目录但主规格无效

- **WHEN** 官方 archive 命令已移动 change 目录，但继续存在的受影响主规格、退役集合或全局严格校验失败
- **THEN** Provider 保留可恢复 Journal 和诊断，不签发 Closure Receipt、不允许发布候选结果

#### Scenario: 关闭候选满足全部后置条件

- **WHEN** 预期归档唯一存在、活动 change 不再存在、Purpose、继续存在的受影响主规格、退役能力缺席和允许差异均通过严格核对
- **THEN** Provider 返回绑定关闭计划、文件身份、内容摘要与隔离候选身份的关闭结果，供 Archive 发布步骤使用

#### Scenario: 关闭候选通过但尚未发布

- **WHEN** 隔离候选满足全部关闭后置条件并签发 Closure Receipt，但规格 commit、remote branch 或 MR 尚未形成完整 Receipt
- **THEN** Provider 保留候选 checkout，调用者 branch、HEAD、index 和 worktree 与关闭前完全相同

#### Scenario: 已提交的候选由远端事实恢复

- **WHEN** 规格发布已经达到可由精确 commit、remote OID 和 MR identity 恢复的终态
- **THEN** Provider 可以清理短命 checkout，后续重放使用持久 Journal 与远端事实而不重新执行 OpenSpec archive

### Requirement: 规格关闭副作用只使用窄范围可恢复 Journal

Provider MUST 在调用官方 archive 副作用前持久化包含输入文件身份和预期输出的 prepared Journal，并只在隔离 checkout 内单调推进 applying、rolling-back、rolled-back 或 committed；committed Receipt MUST 保留 candidate identity，且 Journal 不得保存 MR 等待、平台事件、跨仓发布或生命周期终态。

#### Scenario: 进程在 change 目录移动后中断

- **WHEN** 恢复入口发现活动 change 不存在且 prepared/applying Journal 没有完成 Receipt
- **THEN** Provider 根据归档目录、主规格文件身份和预期输出判断继续验证、回滚或进入人工修复，不盲目再次 archive

#### Scenario: 相同关闭计划重放

- **WHEN** 已存在匹配输入摘要且后置条件仍成立的 committed Journal 与 Closure Receipt
- **THEN** Provider 返回同一逻辑关闭身份，不再次调用 archive 或创建第二个归档目录

#### Scenario: 隔离 checkout 出现并发修改

- **WHEN** 当前文件 CAS identity 不再匹配 before 或 expected manifest
- **THEN** Provider 保留现场并返回人工修复 blocker，不覆盖文件且不写入开发者工作树

#### Scenario: committed Journal 的 checkout 仍待发布

- **WHEN** 关闭 Journal 已 committed 但规格发布 Journal 尚未 completed
- **THEN** 恢复入口重新定位同一 candidate checkout 并返回同一 Closure Receipt，不清理候选或复制到开发者工作树

#### Scenario: 候选身份与 checkout 不一致

- **WHEN** checkout HEAD、base OID、plan digest 或 checkout identity 与 committed Receipt 不同
- **THEN** Provider 保留现场并进入人工修复 blocker，不从调用者工作树重建或猜测候选

### Requirement: 语义漂移通过后续规格 Change 补偿

已完成 Change 的业务 MR 后续变化被确认影响行为契约时，Repoctopus MUST 通过标准 Open 阶段建立引用原 Change、Publication Receipt 和受影响 MR 的新 OpenSpec change；系统不得编辑旧归档目录、重写旧 Closure Receipt 或重开原 Change Run。

#### Scenario: 业务 MR 最终修改公共行为

- **WHEN** 一致性审查与可信人工决定确认最终代码改变 API、配置、权限、数据契约或已接受范围
- **THEN** Runtime 准备一个普通后续 Change，由完整 Open/Design/Build/Verify/Archive 流程处理规格修正

#### Scenario: 业务 MR 只修改内部实现

- **WHEN** 审查证据确认最终差异不改变任何规范性行为
- **THEN** 系统保存 `no-spec-impact` Receipt，不创建规格 Change

### Requirement: Provider 公开稳定 Acceptance 身份

Specification Provider MUST 从唯一官方 Tasks 权威导出每条 Acceptance 的稳定内容身份、Task identity、规范化文本、Requirement mappings 和可移植来源；checkbox 状态、等价格式和运行结果不得改变 Acceptance 身份，语义内容或映射变化必须使旧身份失效。

#### Scenario: 只勾选已经实现的 Task

- **WHEN** `tasks.md` 仅把同一 Task 从 `[ ]` 改为 `[x]`
- **THEN** Provider 保持 Task revision 与 Acceptance identity 不变，并把完成状态作为独立声明投影

#### Scenario: 修改验收语义

- **WHEN** Acceptance 文本、所属 Task、Requirement mapping 或规范来源发生语义变化
- **THEN** Provider 生成新的 Acceptance identity，使旧 Verification Input 和 Evidence Trace 不再兼容

### Requirement: Task checkbox 只投影完成声明

Specification Provider MUST 只通过绑定 expected Task revision 的完成操作写入 checkbox，并把已有 `[x]` 投影为 imported completion claim；Provider 不得把 checkbox、提交消息或 Agent 摘要投影为 Work Receipt、Acceptance Evidence 或 Verify 结果。

#### Scenario: 启动时 Task 已勾选

- **WHEN** Runtime 在批准后读取到语义匹配且已 `[x]` 的官方 Task
- **THEN** Provider 返回 imported completion claim，Runtime 可以避免重复实现但仍要求完整 Verify Evidence

#### Scenario: 陈旧执行者完成 Task

- **WHEN** 执行者使用旧 taskRevision 请求勾选已发生语义变化的 Task
- **THEN** Provider 拒绝写入且不改变当前 Tasks 文档

### Requirement: Specification Provider 提供阶段工件协议

Specification Provider MUST 为 Open、Design、Build、Verify 和 Archive 中涉及规格的 Work 返回版本化阶段协议，包含适用工件、官方 instructions/template、允许操作、内容 identity 和校验入口；Runtime 将其作为执行包中的独立高优先级层交付，阶段 Skill 不得复制或覆盖 Provider 协议。

#### Scenario: Design 装填四类工件协议

- **WHEN** Design Work 准备创建或继续 Proposal、Delta Specs、Design 和 Tasks
- **THEN** Provider 返回当前 schema 的官方 instructions/template 与 digest，Host 在写入前收到这些内容且产物由同一 Provider strict validation

#### Scenario: 阶段不涉及 Specification 写入

- **WHEN** Work 的 output contract 不声明 Specification artifact 且不执行规格关闭
- **THEN** 执行包不装填无关模板，但仍记录当前 Specification Provider identity 供恢复兼容检查

### Requirement: Provider 校验 Open 与 Design Work 的完成事实

Open 和 Design 的 succeeded Host submission MUST 由当前 Specification Provider重新观察并验证，但 submission在 Provider Evidence接受前不得成为允许 lifecycle推进的终态成功事实。Open至少证明 change identity、允许根及当前 schema要求的四类官方工件均为 `ready` 或经官方规则确认的 `skipped`，Design必须证明全部适用工件严格有效且语义摘要可供 Human Decision；Host或 Agent的成功声明不得代替观察事实。Provider成功返回的确定性无效 MUST 进入受管返工，观察基础设施不可用 MUST 保留当前执行并等待重新观察。

#### Scenario: Agent 声称已创建 Change 但目录缺失

- **WHEN** Open Host返回 succeeded而 Provider找不到对应 change或 metadata
- **THEN** Validator拒绝 Outcome并保持 Open Work可修复

#### Scenario: 官方规则跳过 Delta Specs

- **WHEN** Open Host返回 succeeded，Provider确认 Proposal、Design和 Tasks为 `ready`，并依据当前 schema与元数据确认 Delta Specs为 `skipped`
- **THEN** Validator接受该四类工件协议的满足事实并继续严格校验，不以“缺少第四个文件”阻断 Open

#### Scenario: Design 文件存在但 strict validation 失败

- **WHEN** Design Host返回 succeeded而任一适用官方工件缺失、格式错误或引用无效
- **THEN** Validator保持 Design blocked或生成诊断 retry，不创建 Human Decision请求

#### Scenario: Open Host 自述成功但工件缺失

- **WHEN** Host为 `change.intake`提交 succeeded，但 Provider报告必需工件缺失、未满足或 strict invalid
- **THEN** Runtime不建立 Open Human Decision、不进入 Design，并通过当前 Run派发受管 Open repair Work

#### Scenario: Design Host 自述成功但 Tasks 缺少 Acceptance

- **WHEN** Design Host提交 succeeded，但 Provider投影出 tracked Task缺少规范 Acceptance identity
- **THEN** Validator保持 Design blocked或生成诊断 retry，不创建 Human Decision请求

#### Scenario: Provider 调用失败

- **WHEN** Runtime未获得结构化 manifest和 validation便发生 Provider、Store或进程错误
- **THEN** Runtime记录 observation unavailable并保留当前 Work/Outcome供重验，不把错误分类成可修复规格缺陷

### Requirement: Fresh 模式不从 checkbox 合成受管完成事实

Specification Provider MUST 保留 Tasks checkbox 作为规划权威，但在 fresh Run 中将没有当前 Runtime Work Receipt 的预勾选项报告为 adoption conflict；只有显式 adopt-existing 模式可把它投影为 imported completion claim。

#### Scenario: Fresh Build 发现预勾选 Task

- **WHEN** Provider 读取到已勾选 Task，当前 Run 没有对应 Work completion 且启动模式为 fresh
- **THEN** Provider 返回 adoption conflict 和任务 identity，不把它视为可跳过的 completed Task

#### Scenario: Runtime Validator 完成 Task

- **WHEN** 当前 Build Work 的 Outcome、Receipt 与 Validator 全部匹配
- **THEN** Provider 幂等更新 checkbox 并投影 `runtime-work` completion，后续恢复不会重复执行该 Task

### Requirement: Design 在批准前验证结构化 Acceptance

Specification Provider MUST 将每个 tracked Task 下层级更深的规范 `**Acceptance:**` 元数据投影为稳定 Acceptance identity；Design Validator MUST 在 Human Decision 前拒绝任何缺少 Acceptance 的 Task。Task checkbox 描述中的自然语言验证提示、无缩进文本、无粗体标签或旧别名不得被 Runtime 猜测为 Acceptance。

#### Scenario: Task 只有内联验证描述

- **WHEN** `tasks.md` 的 checkbox 描述提到测试或验证，但没有 Provider 可识别的 `Acceptance` 元数据
- **THEN** Design 保持 blocked，并精确报告缺少 Acceptance 的 Task identity，不创建 Human Decision 请求

#### Scenario: 每个 Task 都声明 Acceptance

- **WHEN** Provider 能为全部 tracked Task 投影至少一个非空 Acceptance criterion，且其余官方工件通过 strict validation
- **THEN** Design Validator 接受 Tasks 合同并允许创建绑定当前 planning snapshot 的 Human Decision 请求

#### Scenario: Acceptance 元数据格式畸形

- **WHEN** checkbox 后使用无缩进、无粗体或旧别名形式的 Acceptance 文本
- **THEN** Provider 不把该文本投影为 Acceptance identity，并以缺少 Acceptance 的 Task identity 阻断 Design

#### Scenario: Tasks 投影因其他合同失败

- **WHEN** Tasks 加载、解析或 Receipt 校验因重复 Task identity、非法依赖、进程失败或取消而失败
- **THEN** Provider 保留该失败的真实身份，不得将其误报为缺少 Acceptance

### Requirement: OpenSpec Tasks 与 Runtime BuildPlan 分层而不平行

OpenSpec Tasks MUST 继续作为 Change 的工作范围、依赖、验收映射和完成权威；Runtime BuildPlan MUST 只把已批准 Tasks 投影成可执行 Work Packages，并通过稳定 Task IDs、planning semantic digest 与 Provider identity 保持追溯。BuildPlan 不得成为 Specification Provider artifact、包含第二套 checkbox、覆盖 Task completion、增加需求或改变批准语义。

#### Scenario: 一个 Task 映射多个 Work Package

- **WHEN** 多仓、隔离或依赖边界要求把一个 Task 分为多个执行包
- **THEN** 每个包引用同一稳定 Task ID，Runtime 只在所有 required package 与 Task acceptance Evidence 均有效后请求 Provider 更新该 Task completion

#### Scenario: Plan revision 不改变规划语义

- **WHEN** Build Check 或 Verify 只要求调整包边界、执行顺序、仓库绑定或 Validator，而 Task 的文字、依赖、验收与需求映射不变
- **THEN** Runtime 可以修订 BuildPlan 且不使 Design approval 失效，旧计划保留为审计历史

#### Scenario: Plan revision 需要改变 Task

- **WHEN** 返工需要新增、删除或修改 Task 的范围、依赖、验收或 requirement mapping
- **THEN** Runtime 返回 Design，并要求通过 Specification Provider 更新四类 OpenSpec 工件及重新批准，不在 BuildPlan 中隐藏语义变更

#### Scenario: BuildPlan 写入 OpenSpec change 目录

- **WHEN** Agent 尝试把 Runtime BuildPlan 保存为 OpenSpec change 的第五份 Markdown、ticket 或 checkbox 清单
- **THEN** Specification Validator 拒绝该并行权威，Runtime 仅接受其受管状态存储中的版本化计划

### Requirement: Later phase 必须只读观察并在副作用前收敛规划授权

Build、Verify 和 Archive 中的 planning authority 检查 MUST 通过 Specification Planning 权威模块的只读接口分别观察当前 Provider planning semantic identity、strict validation、approval identity 与 publication provenance，不得由编排层拼装 Store 内部规则或在 lifecycle transition 前创建/刷新 Human Decision。仅 semantic 或 approval-authority 不再授权 lifecycle 时才可返回受限分类并原子恢复 Design；composition、执行进度和仅 publication provenance 的变化 MUST 交由各自权威处理。Status、Dashboard 和其他查询 MUST 保持只读。

#### Scenario: Build pull 发现语义变化

- **WHEN** Build pull 观察到 Provider semantic identity 与 lifecycle planning identity 不同
- **THEN** Runtime 不先改 approval Store，而是原子回到带当前 Work 的 Design；后续 Design gate 再生成绑定新身份的批准请求

#### Scenario: Archive preflight 发现 approval 失效

- **WHEN** Archive 尚未执行关闭或发布副作用，当前 Design approval 缺失、被拒绝、等待新决定或与 planning semantic identity 不匹配
- **THEN** Runtime 返回 `planning-revision-required` 和 Design checkpoint，且 Specification、Git 与平台发布 adapter 均未被调用

#### Scenario: 查询发现不一致

- **WHEN** status 或 Dashboard 读取到 approval 与 lifecycle 不一致
- **THEN** 查询报告可定位 freshness/diagnostic，但不修改 phase、approval 或 current Work；下一次受保护 Runtime pull 执行幂等收敛

#### Scenario: Archive 只发现发布来源更新

- **WHEN** planning semantic identity 与 approval identity 仍匹配，只有 publication provenance 更新
- **THEN** Runtime 保留 Design approval 和 Build/Verify 事实，只重新验证受 publication provenance 约束的 Archive 输入

### Requirement: Open 批准后必须重新观察当前规划摘要

可信 Open Human Decision MUST 只授权其请求中冻结的 Provider、schema、planning semantic digest和工件满足状态。Runtime MUST 在创建 Design Work前通过 Specification Planning权威模块只读重新观察当前输入；完全匹配才可推进，确定性漂移 MUST 返回 Open repair Work，未知结果 MUST 停在原 Run等待 reconciliation。重验不得仅凭 approval Store、文件时间或 Agent声明通过。

#### Scenario: 批准内容保持不变

- **WHEN** 当前 Provider重验结果与 Open决定冻结的 Provider/schema identity、语义摘要和 strict validation完全一致
- **THEN** Runtime接受批准并创建当前 definition选择的 Design Work

#### Scenario: 批准后文件被修改

- **WHEN** Open决定写入后任一受控规划语义变化，即使新的工件仍然 strict valid
- **THEN** Runtime使旧批准不可用于推进并返回 Open Work；不得直接为未执行 Open方法的新摘要创建审批

#### Scenario: Repair 恢复成旧摘要

- **WHEN** 批准后漂移已经被权威观察，后续 Open repair 又把工件恢复成旧批准的相同语义摘要
- **THEN** Runtime仍必须建立一个确定且幂等的新 Human Decision请求，不得因最终字节相同而复用已被漂移事实撤销的旧决定

#### Scenario: 批准后重验未知

- **WHEN** Runtime无法证明当前摘要匹配或确定性不匹配
- **THEN** Runtime保持原决定和 Run checkpoint供 reconciliation，不进入 Design、不刷新另一份 Human Decision并不重放 Host

### Requirement: Specification Planning 必须公开分层身份

Specification Planning MUST 分别公开 planning semantic、approval authority、publication provenance 与 validation observation 的版本化身份和依赖，不得以单一 snapshot digest 同时代表规划授权、Runtime composition、Build execution 或发布来源；每个观察结果 MUST 指明变化类别与其授权范围。

#### Scenario: 相同语义使用新的 composition

- **WHEN** Provider 观察到相同 planning semantic identity，但调用 Runtime 使用新的 composition identity
- **THEN** planning observation 保持 authorized，并把 composition 判定留给 Runtime compatibility 权威

#### Scenario: 远端地址仅大小写不同

- **WHEN** 两次 publication observation 的远端地址按托管平台和 Git 规则规范化后指向同一 remote，且 target/source branch identity 相同
- **THEN** Provider 产生相同 publication repository identity，不撤销 planning approval

#### Scenario: 观察基础设施不可用

- **WHEN** Provider 无法确定当前 semantic、approval 或 publication 身份
- **THEN** 观察结果为 unknown 并保留原 checkpoint 进入 reconciliation，不得伪造 drift 或创建新批准请求
