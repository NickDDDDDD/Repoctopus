# development-telemetry Specification

## Purpose

定义 Repoctopus 用于团队内部追踪、事后排查和 AI 辅助研发效果评估的 OpenTelemetry 输出契约。

## Requirements

### Requirement: Trajectory 先于遥测导出持久化

Runtime MUST 先把已接受的领域事实写入本地 Trajectory，再异步导出 OpenTelemetry 信号；遥测后端或网络故障不得回滚已经有效的工作流事实。

#### Scenario: OTLP 端点不可用

- **WHEN** Runtime 完成有效状态转换但 Collector 无法连接
- **THEN** 转换和本地 Trajectory 保持成功，遥测健康状态显示积压或失败并允许稍后重试

#### Scenario: Runtime 在遥测发送前退出

- **WHEN** 已持久化事件尚未成功导出且 Runtime 进程退出
- **THEN** 下次启动从持久化 Delivery Cursor 之后重放 Trajectory 事件，并保留原事件身份

### Requirement: 领域事实映射为适当的 OpenTelemetry 信号

Telemetry Adapter MUST 把 Run 映射为根 Trace，把有持续时间的步骤、Evidence Attempt 和 Adapter 节点执行映射为 Span，把状态变化、恢复、策略结果、Artifact 登记、Gate Outcome 和错误映射为命名 Event/Log，并只为低基数聚合定义 Metric。

#### Scenario: 一次 Run 跨越多个步骤

- **WHEN** Run 完成启动、记录、失败和恢复
- **THEN** 导出数据可以通过同一 `run.id` 和 Trace 关联全部步骤、事件与结果

#### Scenario: 事件命名

- **WHEN** Adapter 输出状态变化事件
- **THEN** 事件使用固定的领域名称，动态 Run、项目、仓库和步骤值放入属性而不拼入事件名

#### Scenario: Evidence Attempt 执行多个 Adapter 节点

- **WHEN** Runtime 执行命令、服务、浏览器和视觉节点并形成 Bundle
- **THEN** Trace 可以通过稳定的 Run、Attempt、Profile 和节点身份关联执行 Span、Artifact 登记事件与最终 Gate Outcome

#### Scenario: Evidence 在遥测导出前失效

- **WHEN** 采集结束指纹与开始指纹不同并使 Attempt 变为 `superseded`
- **THEN** 遥测记录失效结果和原因分类，不把该 Attempt 统计为有效通过

### Requirement: 遥测维度支持效果评估

Telemetry Adapter MUST 在信息真实可用时输出项目、Run、工作流版本、步骤、仓库、Agent 客户端、模型、结果、重试和耗时等标准维度；缺失维度不得由 Runtime 推断或伪造。

#### Scenario: 客户端没有提供模型信息

- **WHEN** Runtime 无法验证模型名称或版本
- **THEN** 对应属性保持缺失，其他可验证数据仍正常导出

### Requirement: 遥测默认最小化并脱敏

Telemetry Adapter MUST 使用属性允许列表，过滤凭据、Cookie、授权头、环境变量值和疑似密钥；源码、完整 Prompt、模型完整回复、命令输出、服务与浏览器日志、健康响应正文、DOM、截图、视觉请求和视觉响应不得作为普通属性导出。

#### Scenario: 诊断包含访问令牌

- **WHEN** 待导出的错误或命令输出包含符合敏感规则的内容
- **THEN** Adapter 丢弃或替换敏感值，并保留不含原值的本地脱敏诊断

#### Scenario: 运行产生截图或完整测试日志

- **WHEN** Evidence Adapter 登记大体积制品
- **THEN** 遥测只输出制品类型、摘要、大小、MIME、脱敏状态和引用，不嵌入制品正文

#### Scenario: 本机路径进入执行诊断

- **WHEN** Adapter 诊断包含绝对工作目录或浏览器可执行文件路径
- **THEN** 遥测只输出逻辑仓库身份或路径类别，本地 Artifact 中的路径信息也按配置执行脱敏

### Requirement: 遥测导出保持后端中立

领域层 MUST 只依赖 Repoctopus 事件和 Telemetry Port；OTLP、Collector 和 SigNoz 配置只能存在于平台与部署层。

#### Scenario: 替换查询后端

- **WHEN** 团队把 SigNoz 替换为另一个兼容 OTLP 的后端
- **THEN** Engine、Run、Trajectory 和工作流包无需修改

### Requirement: 重试事件具有稳定身份

每个可导出的领域事件 MUST 具有稳定 `event.id`，使 Collector 重试或重复投递后可以按事件身份关联或去重；系统不得宣称提供 exactly-once 传输。

#### Scenario: 同一批遥测重复发送

- **WHEN** Collector 或 Adapter 在超时后重试
- **THEN** 重试记录保留相同事件身份，工作流 Trajectory 不新增第二个领域事实

### Requirement: 遥测记录可验证的 composition 身份

Telemetry Provider MUST 在本地领域事实已经持久化后导出 composition digest、Service Provider、Contributor 和相关操作使用的实现身份；配置正文、插件源码、本机模块路径和 Artifact 正文不得进入普通遥测属性。

#### Scenario: 同一工作流由不同组合执行

- **WHEN** 两个 Run 使用不同 Engine、RunStore 或 Evidence Contributor 代码摘要
- **THEN** 遥测通过稳定低基数维度区分两种组合并分别统计结果、恢复次数和耗时

#### Scenario: 插件身份无法验证

- **WHEN** 团队插件没有可核对版本或代码摘要
- **THEN** Telemetry 保留身份缺失诊断，App Boot 按准入规则决定是否允许运行

#### Scenario: 配置包含本机路径

- **WHEN** 插件配置包含本机可执行文件或仓库绝对路径
- **THEN** 遥测只导出规范化配置摘要和逻辑能力标识，不导出路径正文

### Requirement: 插件生命周期产生稳定遥测事件

App Boot 与产品 Service MUST 为插件激活、等待依赖、失败、卸载、重新加载、操作排空和 composition 变化产生固定名称的事件，并使用低基数结果分类；遥测失败不得改变插件树的领域结果。

#### Scenario: 普通插件重载成功

- **WHEN** 配置变化导致插件完成卸载和重新激活
- **THEN** 遥测关联同一 App Boot 记录重载原因、旧新插件身份、耗时和成功结果

#### Scenario: 操作排空超时

- **WHEN** 插件关闭时已接纳操作没有在期限内达到可恢复点
- **THEN** 遥测记录阶段、结果与恢复分类，不包含 Journal、Checkpoint 或错误正文

### Requirement: 遥测不先于本地权威事实宣告成功

Telemetry Provider MUST 只在对应 Run、Evidence、Action 或 Delivery 本地事实完成持久化后导出成功结果；导出失败只记录可重试诊断，不得反向修改领域事实。

#### Scenario: Run 状态提交失败

- **WHEN** RunStore 没有完成状态与 Journal 提交
- **THEN** Telemetry 不导出该转换成功事件

#### Scenario: OTLP 后端不可用

- **WHEN** 本地领域提交已经成功但 OTLP 导出失败
- **THEN** 领域结果保持成功，Telemetry 记录有界重试或丢弃分类

### Requirement: Skill 使用只导出允许列表身份

Repoctopus MUST 为 Skill 发现、选择、加载和漂移输出低基数事件，允许属性仅包含 Skill 名称、Provider、版本或摘要、调用类型、Run 和结果，不包含正文、绝对路径或个人学习内容。

#### Scenario: TDD Skill 成功加载

- **WHEN** Run 加载 `tdd` Skill
- **THEN** 遥测记录所选 Provider 和正文摘要，不记录 Skill Markdown 正文

### Requirement: 个人学习遥测默认关闭

Repoctopus MUST 把 `.repoctopus/learning/` 视为个人数据边界，默认不扫描、不建立 Artifact 且不输出文件数量、主题名称或内容摘要；只有用户显式配置的团队知识提升动作可以进入普通审计链。

#### Scenario: Teach 写入个人笔记

- **WHEN** Skill 在个人学习目录新增或修改文件
- **THEN** 开发遥测不产生针对这些文件的采集事件

### Requirement: 生命周期遥测来自权威 Change Run

Repoctopus MUST 只从 Workspace/change 对应的唯一权威 Change Run facts 和公共 projection 映射 runId、phase、status、checkEpoch、current Work、Task progress、wait condition、blocker 和 next action；Exporter、Desktop projection 和后端查询不得扫描 generation 目录、Git 或 MR 后自行推断另一套 lifecycle 状态。

#### Scenario: Run 进入等待状态

- **WHEN** Change Run 接受一个带稳定 wait condition 的转换
- **THEN** 遥测使用同一事件身份输出 runId、phase、status、checkEpoch、Work 和等待类别，桌面与远端目的地可投影出一致状态

#### Scenario: 阶段转换使检查失效

- **WHEN** Runtime 接受阶段转换并递增 checkEpoch，导致仍在执行或不可复用的旧检查失效
- **THEN** Trajectory 与 OTLP 关联原检查和新 epoch，输出有界 `phase-changed` 或 `stale-epoch` 分类，不产生另一条 Run trace

#### Scenario: 平台事实尚未被 Run 接受

- **WHEN** 平台或 Provider 已观察到外部结果，但 Change Run 尚未核对并接受该事实
- **THEN** 遥测可以报告处理状态，但不得提前把 change 阶段标记为已关闭或 completed

### Requirement: 发布与一致性审查遥测保持有界

Repoctopus MUST 从已接受的 Publication 与 Consistency Receipt 输出低基数事件，允许属性只包含 change、Run、Work、repository identity、item kind、结果类别、verdict、Receipt identity 和时间；不得包含 MR body、完整 diff、commit message、仓库 URL、绝对路径或凭据。

#### Scenario: Publication Receipt 完成 Archive

- **WHEN** 全部发布项通过精确远端核对并完成 Change Run
- **THEN** Desktop 与 SigNoz 接收相同的 publication completed 语义，不记录 MR 是否最终合入

#### Scenario: 一致性审查要求规格修正

- **WHEN** Consistency Review 输出 `spec-update-required`
- **THEN** 遥测关联原 Change、审查 Receipt 和后续 remediation change identity，不嵌入规格正文或代码差异

### Requirement: 受管 Change 执行必须产生完整可重放遥测

Repoctopus MUST 在同一权威 Change Run trajectory 中记录 Open、Design、Build、Verify、Archive phase，以及 state revision、checkEpoch、Work attempt、Host invocation、Skill 上下文、受保护工具调用、Validator、wait/reconcile 和 continuation 的已接受执行边界；Telemetry Provider MUST 只在这些事实持久化后将其投影为版本化 OTLP 信号，不得输出 lifecycle generation，也不得由 Exporter、Desktop 或后端查询根据目录、最终状态或对话推断缺失事实。

#### Scenario: Work 从领取推进到阶段转换

- **WHEN** 当前 Work 在同一 epoch 内依次完成 claim、context delivery、Host invocation、受保护工具调用、Outcome 和 Validator acceptance
- **THEN** Trajectory 与 OTLP 按相同 runId、attempt、epoch、稳定 identity 和顺序表示全部边界，最后的 lifecycle transition 不能替代或合成前序事件

#### Scenario: Open 与 Design 分别等待批准

- **WHEN** Open 或 Design Work 的 Outcome 与 Validator 已接受并建立各自 Human Decision
- **THEN** Trajectory 与 OTLP 分别记录 phase、Skill delivery/consumption、proposal hash、approval requested/accepted/rejected 和 transition；不得用单个 planning-approved 事件合并两个边界

#### Scenario: Verify 触发受管修复

- **WHEN** Verify implementation failure 使 task revision 重开并创建 Build Repair Work
- **THEN** Trajectory 与 OTLP 关联失败 Evidence、invalidation、phase transition、task reopen、Repair Work identity、TDD Skill 使用和新 completion claim，使团队能复算一次完整返工而不是只看到 phase 往返

#### Scenario: Archive 请求重新验证

- **WHEN** Archive 在副作用前发现 Verify 输入陈旧并返回 Verify
- **THEN** 遥测记录 reverify 分类、epoch 变化与新的 Evidence attempt；若副作用已经开始则记录 reconcile 而不是虚假的 Archive→Verify transition

#### Scenario: 本地提交失败

- **WHEN** Run CAS 或 transition journal 没有持久化某个 Host、工具、Validator、epoch 或 phase 成功事实
- **THEN** Telemetry 不得导出对应成功事件或完成 Span，即使 Host 在进程内曾返回成功

### Requirement: 执行 Trace 必须跨短生命周期进程保持关联

Telemetry Provider MUST 让同一 Change Run 的 phase、Work attempt、Host、受保护工具、Validator 和 wait 使用稳定 Run trace identity，并用持久事件的开始/结束时间及 invocation identity 重建有持续时间的 Span；Runner 退出、恢复和 OTLP 重放不得创建另一条逻辑执行链或改变事件身份，系统仍不得宣称 exactly-once 导出。

#### Scenario: Host invocation 后进程退出

- **WHEN** Host started 已持久化、Runtime 退出，并由另一 Runner 核对后完成相同 invocation
- **THEN** 遥测把开始、恢复和完成关联到同一 Run、Work attempt 与 invocation，不统计第二次逻辑调用

#### Scenario: Collector 恢复后重放积压

- **WHEN** OTLP 端点不可用期间多个执行事件已进入 Trajectory，稍后从 Delivery Cursor 重放
- **THEN** 重放保留原 event、attempt 和 invocation identity及领域时间戳，工作流结果不受导出成败影响

### Requirement: Skill 遥测必须区分解析、交付和可验证消费

Repoctopus MUST 分别记录 action/augmentation Skill 的 resolved、delivered 和 consumed 事实；resolved 或 delivered 不得冒充 Agent 已消费，Work 成功也不得反推所有 Skill 已使用。`consumed` 只有在当前 Host invocation 以匹配 packet/layer digest 的协议回执确认后才能产生。允许列表属性仅包含 Skill identity、role、Run/Work/invocation 关联、结果和耗时，不包含 Skill 正文、Prompt、模型回复或本机路径。

#### Scenario: Host 未读取 augmentation

- **WHEN** packet 包含 action Skill 和 augmentation，但 Host 回执只确认消费 action Skill
- **THEN** 遥测只为 action Skill 产生 consumed 事实，augmentation 保持 delivered，不能因 Work 最终成功而补写 consumed

#### Scenario: Skill 正文包含敏感内容

- **WHEN** Skill 或 Provider layer 包含路径、凭据样例、Prompt 或其他正文
- **THEN** Event、Trace 和 Metric 只保留允许列表 identity/digest/role/result，不导出正文或其片段

### Requirement: 工具遥测只表示受保护操作

Repoctopus MUST 为通过活动 `WorkExecutionSession` 授权并持久化的工具操作记录 started/completed identity、逻辑 capability、operation kind、结果、重试和耗时；不得导出参数、返回值、命令、diff、文件名、绝对路径、URL、环境变量或凭据。Host 或外部 IDE 绕过受保护协议执行的动作不得生成受管 tool success，只能在被发现时形成 drift/reconcile 事实。

#### Scenario: 受保护工具调用成功

- **WHEN** Host 使用当前 session 调用允许的 Specification 写入或进程工具并得到已持久化结果
- **THEN** OTLP 将 tool Span/Event 关联到同一 Run、Work attempt 和 Host invocation，只暴露 capability、operation kind、结果与耗时

#### Scenario: 外部进程直接修改文件

- **WHEN** 未携带活动 session 的外部工具修改 Workspace
- **THEN** 遥测不得把该动作统计为受管工具成功；Runtime 发现输入变化时记录 drift/reconcile 分类

### Requirement: 效率 Metric 必须有界且可从审计事件复算

Telemetry Provider MUST 从相同的持久事件派生 phase、Work、Host、tool、Validator 和 wait 时长，以及 attempt、result、retry、reconcile、epoch invalidation、Skill delivery/consumption 与 tool call 计数。Metric label MUST 只使用有界的 phase、内置 work/tool kind、Skill role、结果、恢复和失效分类；run、change、task、repository、digest、checkEpoch 数值、自由 Skill/插件名和 invocation identity不得成为 Metric label。审计 Event/Trace MUST 保留足够的允许列表 identity，使团队可以复算聚合结果并定位效率瓶颈。

#### Scenario: 团队统计 Build 效率

- **WHEN** 多个 Change 执行 Build Work、工具调用、重试、epoch 失效和等待
- **THEN** 后端可以按 phase、work/tool kind 和有界结果分类聚合数量与耗时，并从事件关联到具体 Run 排查，而不会为每个 Run、epoch 或自定义名称创建 Metric time series

#### Scenario: 自定义 Skill 或工具名称无界

- **WHEN** 团队插件提供未在有界 metric catalog 中登记的 Skill 或 operation 名称
- **THEN** Event 可保留通过安全校验的真实 identity，Metric label 降级为 `custom` 或 `unknown`，并通过 cardinality gate

### Requirement: 本地 Dashboard 与远端后端必须消费相同 OTLP 协议

Repoctopus MUST 通过同一 Telemetry mapping/export payload 向本地 Desktop receiver 和远端 OTLP Collector 表达 Change phase、Work、Skill、tool、Validator、wait 和恢复事实；不得为本地 Dashboard 增加读取 RunStore 或轮询目录的第二套状态推断。测试 receiver MUST 对 logs、traces 和 metrics 与持久 Trajectory 做关联校验。

#### Scenario: 同一事件由不同 OTLP 目的地消费

- **WHEN** 同一批已持久化事件分别导出到本地 Desktop receiver 或远端 SigNoz-compatible Collector
- **THEN** 两种配置使用相同 mapping、schema 和 event/run/work/invocation identity 得到一致执行语义；本 Change 不要求为尚未完成的 Desktop UI 实现第二套 receiver 或多目的地投递状态机

#### Scenario: 本地 Dashboard 未运行

- **WHEN** Change 正常执行但本地 Desktop receiver 未启动
- **THEN** 工作流继续提交权威事实，Telemetry 按配置重试或记录有界积压，稍后接收端不得要求 Runtime 重演 Work

### Requirement: 候选度量必须声明可信来源和覆盖状态

Repoctopus MUST 为纳入评估的每项候选度量声明 `direct`、`derived`、`optional-evaluator` 或 `out-of-scope` 覆盖状态、所需权威事实、聚合公式和缺失语义；Runtime 不得把不可观察事实推断为零值或成功值。

#### Scenario: 度量依赖外部系统

- **WHEN** 一项度量依赖 RAG 黄金集、IDE 采纳、代码归因、人员名册、培训或认证系统
- **THEN** 覆盖矩阵将其标记为 `out-of-scope` 并说明所需数据源，Runtime 不产生冒充该度量的事件或 Metric

#### Scenario: 度量由已有事件聚合

- **WHEN** 一项度量可由同一规范事件中的计数、结果或持续时间计算
- **THEN** 覆盖矩阵将其标记为 `derived`，记录分子、分母、时间窗口和未知值处理，而不重复建立第二份事实

### Requirement: Skill 效果度量必须绑定可验证执行事实

Repoctopus MUST 只从同一 Run、Work attempt 和 Host invocation 中已持久化的 Skill consumed 回执、Work 结果、人工决定与正式返工事实计算 Skill 完成、错误、人工修正和复用数据；这些结果只表达相关性，不宣称 Skill 导致成功或失败。

#### Scenario: 使用 Skill 的 Work 成功完成

- **WHEN** Host 以匹配 digest 的回执确认消费 Skill，且同一 Work attempt 的 Outcome 和 Validator 均被接受
- **THEN** 审计事件可以把该次使用计入 Skill 任务完成分子和调用分母，并保留 Run/Work 关联供查询核对

#### Scenario: Work 成功但 Skill 未被确认消费

- **WHEN** Skill 仅处于 resolved 或 delivered，Host 没有提交匹配的 consumed 回执
- **THEN** 该 Work 不计入该 Skill 的完成、错误、人工修正或复用统计

#### Scenario: Skill 使用后发生人工修正

- **WHEN** 已确认消费 Skill 的 Work 随后出现绑定同一结果的 changes-requested、Outcome rejection、Task reopen 或 Repair Work
- **THEN** 遥测记录有界修正类别并允许计算人工修正率，不导出审批正文、代码差异或自由文本原因

### Requirement: Rule 度量只接受机器可验证评估

Repoctopus MUST 只为具有稳定 Rule identity、版本、适用性判定和 Evaluator receipt 的规则记录 expected、triggered、passed 或 violated 结果；Skill 正文、AGENTS 文本或模型自述不得单独证明规则命中或违规。

#### Scenario: 结构化规则在适用场景触发

- **WHEN** 版本化 Evaluator 判定规则适用并提交该规则已触发且通过的持久 Receipt
- **THEN** 遥测允许把该记录计入规则应触发次数、正确触发次数和通过次数

#### Scenario: 自由文本规则没有 Evaluator

- **WHEN** 当前上下文包含规则文本但不存在适用性判定和结构化验证结果
- **THEN** 规则命中率与违规生成率保持未知，不从最终 Work 成功、Skill 加载或 Agent 声明反推

### Requirement: 工作流健康和效率度量必须可复算

Repoctopus MUST 从权威 Run 的开始、终态、workflow identity、阶段边界和有效周期导出工作流执行、失败、复用和持续时间事实；效率提升率由查询端使用相同口径的当前周期与明确基线周期计算。

#### Scenario: 工作流执行失败

- **WHEN** Run 进入持久化失败终态
- **THEN** 同一 Run 贡献一次执行分母和一次失败分子，重放、进程重启或临时导出错误不增加逻辑执行次数

#### Scenario: 团队比较交付周期

- **WHEN** SigNoz 使用同一 workflow/version 和周期定义比较当前窗口与明确基线窗口
- **THEN** 查询可以从权威持续时间计算效率提升率，并把缺少基线或未完成 Run 表示为未知而不是零

### Requirement: 标准 OTLP 部署配置必须完整生效

Telemetry Adapter MUST 支持标准 OTLP 总端点、按信号端点、请求头、服务名和 Resource Attributes 配置，并以确定优先级合并 Repoctopus 默认资源身份；配置缺失或后端不可用不得改变领域结果。

#### Scenario: 团队配置统一 OTLP 端点

- **WHEN** 部署环境提供 `OTEL_EXPORTER_OTLP_ENDPOINT` 和认证请求头
- **THEN** Trace、Log 与 Metric 使用该配置发送到兼容 Collector，凭据不进入配置摘要、领域状态、诊断正文或普通遥测属性

#### Scenario: 部署覆盖 Resource Attributes

- **WHEN** 部署环境提供合法的 `OTEL_SERVICE_NAME` 或 `OTEL_RESOURCE_ATTRIBUTES`
- **THEN** 所有 Repoctopus exporter 使用同一合并规则输出资源属性，并保留规范产品和 schema 身份以支持跨信号关联

#### Scenario: 未配置远端端点

- **WHEN** 进程没有任何 OTLP 端点配置
- **THEN** 远端导出保持禁用，Run、Evidence 与 Delivery 继续工作且不产生连接重试

### Requirement: 遥测公开契约必须完整可发现并防止漂移

Repoctopus MUST 发布与机器可校验遥测目录一致的数据字典，覆盖全部 Resource、Span、Log/Event、Metric、属性、类型、单位、允许值、必填性、来源、基数、隐私和聚合公式；新增、删除或改名必须作为协议变更评审。

#### Scenario: 团队建设 SigNoz Dashboard

- **WHEN** Dashboard 作者查阅公开遥测参考手册
- **THEN** 可以直接使用 Repoctopus 上报的规范名称构造查询，无需读取源码、重命名字段或依赖未公开推断

#### Scenario: 实现增加新遥测字段

- **WHEN** 代码增加、删除或修改公开事件、指标、属性、类型、单位或枚举
- **THEN** 契约检查要求机器目录、映射测试和参考手册同步更新，否则验证失败

#### Scenario: 公司使用不同字段命名

- **WHEN** 部署环境已有组织级字段命名约定
- **THEN** Repoctopus 仍输出规范字段，本 Change 不提供 Runtime 字段改名、公司别名或 Collector Transform 配置

### Requirement: Metric 标签必须保持有界且身份可下钻

新增 Skill、Rule、工作流和效率 Metric MUST 只使用有界角色、类别、结果、phase 和内置 kind；精确 Skill/Rule/Run/Work identity 只进入允许列表 Event 或 Span，使聚合保持低基数且异常可下钻。

#### Scenario: 团队使用自定义 Skill 或 Rule

- **WHEN** 精确 Skill 或 Rule 名称不属于内置有界目录
- **THEN** Metric label 使用 `custom` 或角色类别，关联 Event/Span 保留通过安全检查的精确 identity，时间序列不按自由名称扩张

#### Scenario: 身份值包含敏感或无界内容

- **WHEN** 候选 identity 包含路径、换行、疑似凭据、超长内容或未登记枚举
- **THEN** 属性允许列表拒绝或降级该值，并记录不含原值的本地诊断
