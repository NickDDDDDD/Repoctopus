# development-telemetry Specification

## Purpose

定义 Repoctopus 用于团队内部追踪、事后排查和 AI 辅助研发效果评估的 OpenTelemetry 输出契约。

## Requirements

### Requirement: Trajectory 先于遥测导出持久化

Runtime MUST 先把已接受的领域事实写入本地 Trajectory，再持久化统一观测 envelope 并异步导出 OpenTelemetry 信号；每个配置目的地使用独立 Delivery Cursor，任一目的地或网络故障不得回滚领域事实、阻塞其他目的地或丢失仍在保留策略内的重放输入。

#### Scenario: OTLP 端点不可用

- **WHEN** Runtime 完成有效状态转换但一个 Collector 无法连接
- **THEN** 转换和本地 Trajectory 保持成功，该目的地显示积压或失败并允许稍后重试，其他可用目的地继续推进自己的 Cursor

#### Scenario: Runtime 在遥测发送前退出

- **WHEN** 已持久化 envelope 尚未被全部目的地成功确认且 Runtime 进程退出
- **THEN** 下次启动分别从各目的地持久化 Delivery Cursor 之后重放，并保留原 envelope 与事件身份

#### Scenario: 本地 Dashboard 长时间关闭

- **WHEN** 本地桌面目的地持续不可用但团队 OTLP 后端可用
- **THEN** 团队目的地继续确认 envelope，本地目的地保持独立积压并按有界保留策略报告健康状态

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

Repoctopus MUST 在同一权威 Change Run trajectory 中记录 Open、Design、Build、Verify、Archive phase，以及 state revision、checkEpoch、Build Action、配置与计划 revision、Work attempt、Host invocation、Skill 上下文、受保护工具调用、Validator、wait/reconcile 和 continuation 的已接受执行边界；Telemetry Provider MUST 只在这些事实持久化后将其投影为版本化 OTLP 信号，不得输出 lifecycle generation，也不得由 Exporter、Desktop 或后端查询根据目录、最终状态或对话推断缺失事实。

#### Scenario: Work 从领取推进到阶段转换

- **WHEN** 当前 Work 在同一 epoch 内依次完成 claim、context delivery、Host invocation、受保护工具调用、Outcome 和 Validator acceptance
- **THEN** Trajectory 与 OTLP 按相同 runId、attempt、epoch、稳定 identity 和顺序表示全部边界，最后的 lifecycle transition 不能替代或合成前序事件

#### Scenario: Open 与 Design 分别等待批准

- **WHEN** Open 或 Design Work 的 Outcome 与 Validator 已接受并建立各自 Human Decision
- **THEN** Trajectory 与 OTLP 分别记录 phase、Skill delivery/consumption、proposal hash、approval requested/accepted/rejected 和 transition；不得用单个 planning-approved 事件合并两个边界

#### Scenario: Verify 触发受管修复

- **WHEN** Verify implementation failure 使当前计划 Evidence 失效并返回 Build Plan revision
- **THEN** Trajectory 与 OTLP 关联失败 Evidence、invalidation、phase transition、旧新 plan identity、受影响 Work Package、后续普通 Execute Work、Skill 使用和新 Build Check，使团队能复算一次完整返工而不是只看到 phase 往返

#### Scenario: Archive 请求重新验证

- **WHEN** Archive 在副作用前发现 Verify 输入陈旧并返回 Verify
- **THEN** 遥测记录 reverify 分类、epoch 变化与新的 Evidence attempt；若副作用已经开始则记录 reconcile 而不是虚假的 Archive→Verify transition

#### Scenario: 本地提交失败

- **WHEN** Run CAS 或 transition journal 没有持久化某个 Host、工具、Validator、epoch、Build Action 或 phase 成功事实
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

Repoctopus MUST 分别记录 Action、内置 augmentation 与团队 binding Skill 的 resolved、delivered 和 consumed 事实；resolved/delivered 不得冒充 Host 消费，consumed 不得冒充方法执行，Work 成功也不得反推任一状态。`consumed` 只有在当前 Host invocation 以匹配 packet/layer digest 的协议回执确认后产生。允许列表属性仅包含 Skill identity、role、binding identity、Run/Work/invocation 关联、结果和耗时，不包含正文、Prompt、模型回复、命令输出或本机路径。

#### Scenario: Host 未读取 augmentation

- **WHEN** packet 包含 Action、内置 augmentation 和 team guidance，但 Host 回执只确认前两层
- **THEN** 遥测只为已确认层产生 consumed，team guidance 保持 delivered；Work 最终成功不得补写 consumed

#### Scenario: Skill 正文包含敏感内容

- **WHEN** Skill、团队 binding 或 Provider layer 包含路径、凭据样例、Prompt 或其他正文
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

### Requirement: Build 协议的配置计划执行检查必须可观测

Repoctopus MUST 在本地 Trajectory 持久化后，为 Build Configure、Plan、Plan Evidence、Execute 与 Check 输出版本化 Span/Event，并关联 runId、phase、action kind、attempt、checkEpoch、配置与计划 revision/digest、execution/tdd/review/isolation 的有界枚举、Work Package identity、Task references、repository role、Skill delivery/consumption、Validator result 和 duration。Metric labels MUST 使用有界枚举；run、Task、package、仓库与 digest 只能作为 Trace/Event attributes 或关联资源，不得成为高基数 Metric labels。

#### Scenario: Build Configuration 获得批准

- **WHEN** Runtime 持久化配置 proposal、可信批准与冻结 identity
- **THEN** OTLP 表示 configure action、选择的有界策略、approval latency 和结果，但不导出用户输入正文或本机路径

#### Scenario: isolation binding 被接受

- **WHEN** Runtime 接受 Runner/Host 提供的多仓 execution workspace binding
- **THEN** Trajectory 记录 repository role、isolation 枚举、binding semantic digest 和验证结果；OTLP 不导出 checkout 绝对路径、用户名或本机 worktree 名称

#### Scenario: Plan revision 修复 Verify finding

- **WHEN** Verify failure 使当前计划部分失效并接受新的 revision
- **THEN** Trajectory 与 OTLP 通过稳定 finding classification 和前后 plan identity 关联 invalidation、revision、Execute 与 Check，使团队能计算返工率和计划稳定性

#### Scenario: subagent 包被委派

- **WHEN** 配置为 subagent-driven-development 且协调 Host 执行一个 Work Package
- **THEN** Trace 以父子 Span 关联协调调用、受管执行者调用、Skill 消费、受保护工具与 Outcome；Metric 不使用 Agent、package 或 Task ID 作为 label

#### Scenario: autonomous Work 完成

- **WHEN** autonomous Host 完成当前 Work Package 并通过 Validator
- **THEN** Trace 保留与 subagent 模式相同的 Action、package、Task、测试、Review 和 Check 语义，使两种模式可比较而无需后端猜测

### Requirement: 每个领域事实只产生一份规范观测 envelope

Telemetry Provider MUST 对已持久化领域事实执行一次允许列表映射并生成具有稳定身份的规范观测 envelope；不同目的地只能执行协议编码、传输和目的地确认，不得分别重新解释领域事实或产生不一致属性。

#### Scenario: 同一事件投递到桌面与团队后端

- **WHEN** 一个领域事件同时需要投递到本地桌面接收器和远端 OTLP 后端
- **THEN** 两次投递携带相同 envelope 身份、信号语义、事件名称和允许列表属性

#### Scenario: 目的地采用不同 OTLP 传输配置

- **WHEN** 本地与远端目的地使用不同端点、请求头、超时或批量设置
- **THEN** 传输差异不得改变 envelope 中的领域身份与观测含义

### Requirement: 遥测目的地独立确认和恢复

Telemetry Provider MUST 为每个目的地记录稳定身份、独立确认位置、重试结果和健康状态；增加、暂停或移除本地目的地不得重置远端确认位置，系统不得把多目的地传输宣称为 exactly-once。

#### Scenario: 本地成功而远端失败

- **WHEN** 桌面接收器确认 envelope 但远端 OTLP 后端超时
- **THEN** 本地 Cursor 推进，远端 Cursor 保持并单独重试，不向桌面重复制造逻辑状态

#### Scenario: 远端成功而本地失败

- **WHEN** 远端 OTLP 后端确认 envelope 但桌面接收器未运行
- **THEN** 远端 Cursor 推进，本地 Cursor 保持并在接收器恢复后重放

#### Scenario: 移除桌面目的地

- **WHEN** 用户禁用桌面应用或卸载本地目的地
- **THEN** 系统按明确保留策略停止该目的地积压增长且不修改其他目的地的 Cursor

### Requirement: 规范 envelope 保留桌面投影所需的权威关联

Telemetry Adapter MUST 把主规格定义的五阶段、Build action、Work、Task、attempt、Host、Validator、Runtime continuation、Skill 链路、验证、等待和恢复事实保留在同一规范 envelope 的非 Metric 记录中，并提供 Workspace、change、Run、父子执行、结果和观测时间的稳定关联；Metric 仍只使用有界低基数维度，缺失字段不得推断。本 requirement 只约束桌面消费所需的关联完整性，不建立第二套生命周期或事件命名权威。

#### Scenario: Host 开始执行一个 Work

- **WHEN** Runtime 已持久化可验证的 change、Run、阶段、Build action、Work、Task、attempt 和 Host 关系
- **THEN** 对应 Span 或 Log 可以通过稳定属性重建该执行关系且不包含 Prompt、回复或命令输出

#### Scenario: Skill 从交付进入已消费

- **WHEN** Runtime 已校验 Host Outcome 中与 Work Package 匹配的 consumed Skill layer
- **THEN** envelope 保留 Skill 身份、角色、resolved/delivered/consumed 状态与关联 Work，不包含 Skill 正文、Prompt 或 Agent 内部思考

#### Scenario: Run 进入人工阻塞

- **WHEN** 工作流创建需要人处理的 Human Decision
- **THEN** 遥测记录 change、Run、阶段、阻塞类别、请求身份和可公开下一步动作，不嵌入规格、设计图或决策正文

#### Scenario: 仅存在无法验证的下一步建议

- **WHEN** Runtime 没有持久化权威下一步动作
- **THEN** Telemetry 不导出推断的下一步属性，桌面或远端消费者可以明确表示缺失

### Requirement: 本地实时消费不改变远端 OTLP 契约

本地桌面目的地 MUST 消费与远端后端相同的标准 OTLP 信号和 Repoctopus 属性契约；领域层不得为桌面 UI 创建旁路状态协议，远端后端也不得成为桌面实时更新的查询依赖。

#### Scenario: 更换团队 OTLP 后端

- **WHEN** 团队把 SigNoZ 替换为另一个兼容 OTLP 的后端
- **THEN** 本地桌面投影、领域事件和规范观测 envelope 无需修改

#### Scenario: 远端后端无法访问

- **WHEN** 开发机暂时无法访问团队 OTLP 后端但桌面接收器可用
- **THEN** 桌面应用继续由本地上报实时更新且不轮询远端后端

### Requirement: Workspace intent 修订必须可观测且保持低基数

Runtime MUST 为 Execution Workspace binding failure、Build→Open intent revision、可信 isolation 决策、Open→Design 恢复和 execution checkpoint retirement 记录可关联 trajectory/OTLP 事实。Binding telemetry MUST 同时携带受限 error code 与 `intent-revision | binding-retry | halt` 恢复类别；Trace MAY 使用受控 run/work identity 做关联，Metric label MUST 只使用 phase、work kind、受限 binding error code/recovery、`current|branch|worktree` isolation 与 retirement boolean，不得包含 checkout 路径、branch、digest、错误文本、runId、workId、changeId、worktree 名称或个人身份。

#### Scenario: linked worktree 拒绝 current

- **WHEN** Open prevalidation 或 Build Configure 发现 `current-linked-worktree`
- **THEN** trace 记录受限 error code 与候选/旧 isolation，不导出绝对路径或本机 worktree identity

#### Scenario: 同 Run intent 修订成功

- **WHEN** 用户批准新 worktree intent且 Runtime进入 Design
- **THEN** trajectory 可关联 Build→Open wait、Human Decision、Open→Design、新 epoch 和旧 checkpoint retirement

#### Scenario: 不可修订身份漂移

- **WHEN** binding failure 分类为 remote identity 或 repository topology drift
- **THEN** 遥测记录有界 fail-closed 分类，不把自由文本或仓库 URL 作为 Metric label

### Requirement: 规划恢复必须上报权威失效与 checkpoint 退役事实

Runtime MUST 为 planning authority invalidation、lifecycle Design recovery 和 execution checkpoint retirement 记录可关联的 trajectory 与 OTLP 事实，使团队能够区分语义漂移、批准授权失效、原子恢复成功和遗留 torn checkpoint。正常 lifecycle 恢复 MUST 绑定 `change.lifecycle.transitioned`，遗留状态收敛 MUST 绑定幂等 `recovery.reconciled`；Trace MAY 携带受控 identity 关联，Metric label MUST 只使用 phase、work kind、invalidation kind、continuation reason 与布尔结果等低基数字段，不得包含 digest、路径、自由文本、runId、workId、changeId 或个人身份。

#### Scenario: Archive 在副作用前回到 Design

- **WHEN** Archive preflight 因 planning authority 失效回到 Design
- **THEN** trace 记录 from/to phase、失效类型、旧/新 epoch 与 execution 是否退役，Dashboard 可从同一 Run 解释恢复原因

#### Scenario: 遗留 checkpoint 被只读恢复防线忽略

- **WHEN** recovery 发现 `workExecution` 与 lifecycle current Work/epoch 不匹配
- **THEN** 系统记录 `checkpoint-superseded` 诊断或事件，但 Metric 不包含旧 workId、digest 或错误文本

#### Scenario: 正常 phase transition 保留匹配 checkpoint

- **WHEN** lifecycle transition 未替换 current Work且 checkpoint 仍匹配同一 workId/checkEpoch
- **THEN** Runtime 不上报虚假的 retirement，避免把普通重试或同 Work 校验误计为状态撕裂

### Requirement: 桌面激活结果形成有界观测事实

Repoctopus MUST 在 Change Run 权威事实持久化后记录版本化 Desktop activation 事件，并只输出 Workspace、change、Run、目标类别、`started | activated | unavailable | unsupported` 结果、固定 reason 和时间；不得记录 executable、命令行、安装路径、协议 payload、环境变量值或自由文本错误正文。

#### Scenario: 桌面激活请求被接受

- **WHEN** 操作系统接受首次启动或单实例转交请求
- **THEN** Trajectory 与本地/远端 OTLP 使用相同事件身份和结果类别，重复导出不产生第二个逻辑激活事实

#### Scenario: 桌面激活不可用

- **WHEN** Launcher 无法解析目标或启动请求失败
- **THEN** 遥测记录固定 unavailable reason 且远端目的地继续独立投递，不把本地观测损失解释为 Change Run 失败

### Requirement: 团队 Skill composition 必须形成可重放观测事实

Repoctopus MUST 在本地 Trajectory 持久化后，为 effective composition compile/reject/drift、team binding resolution 和 Skill resolved/delivered/consumed 生成版本化 Event/Span。记录 MUST 关联 Run、Work、Host invocation、binding role、结果和有界原因分类；Skill/binding 自由名称、Run/Work/repository、digest 只能作为 Trace/Event 属性，不得成为 Metric label。Skill 正文、Prompt、回复、本机路径和个人身份不得导出。

#### Scenario: team guidance 已交付但未消费

- **WHEN** Runtime 已把团队 guidance 放入 packet，而 Host outcome 没有确认对应 layer digest
- **THEN** envelope 分别表示 delivered 与 consumed missing，远端和桌面不得显示为已使用或方法已执行

#### Scenario: composition 在恢复时漂移

- **WHEN** 活动 Run 恢复发现 effective composition 与冻结摘要不兼容
- **THEN** Trajectory 与 OTLP 记录 drift 和阻断结果，不上传配置正文或 Skill 内容，也不合成后续 Work 成功

### Requirement: Open Evidence 恢复必须形成可重放观测事实

Runtime MUST 为 Open Provider Evidence acceptance/rejection、observation unavailable、repair Work派发、批准后重验、execution retirement和最终恢复记录可关联的 Trajectory与 OTLP事实。事件 MUST 允许离线复算一次 Open返工是否保留同一 Run、是否重复调用 Host以及何时建立新 Human Decision；Metric label MUST 仅使用 phase、source、result、postApproval和 retirement等有界字段，不得包含 digest、路径、诊断正文、changeId、runId、workId或个人身份。

#### Scenario: Strict validation 触发 Open repair

- **WHEN** Open Outcome后的 Provider Evidence因 strict validation失败而安装 replacement Work
- **THEN** Trace关联 Evidence拒绝、旧新 Work/epoch和 retirement，Metric记录 `source=strict-validation,result=repair-dispatched`且不包含高基数身份

#### Scenario: Provider observation unavailable

- **WHEN** Provider调用未返回可分类结果且 Runtime保留原 execution
- **THEN** 遥测记录 `result=reconcile`和 `host_replayed=false`，不把异常正文作为 Metric label

#### Scenario: 批准后漂移恢复

- **WHEN** Open批准后重验发现 planning摘要变化，新的 Open Work最终通过并建立新决定
- **THEN** Trajectory可按顺序关联旧决定失效、repair Work、Provider Evidence、新 Human Decision与 Open到 Design转换

### Requirement: 增量失效必须形成可复算观测事实

Runtime MUST 在本地提交增量失效后记录变化权威、变化类别、受影响 identity kind、保留/退役节点数量、失效范围是否精确、fallback 原因和 resulting continuation；Trace/Event MAY 携带允许列表内的旧新 identity 关联，Metric labels MUST 仅使用有界 authority、classification、scope、result 与 continuation kind。

#### Scenario: 局部 Plan revision 保留完成事实

- **WHEN** Build 或 Verify finding 只失效部分 Work Packages 并保留其余 completions
- **THEN** Trajectory 与 OTLP 记录受影响/保留数量、精确范围结果和旧新 Plan 关联，使团队可以复算返工放大率

#### Scenario: 无法计算最小范围

- **WHEN** Runtime 因缺少依赖身份而采用保守失效或 Human Decision
- **THEN** 事件记录 `scope=conservative` 与有界 reason code，不输出自由文本、Task 内容、路径或 digest 作为 Metric label

#### Scenario: composition 变化不触发 planning invalidation

- **WHEN** Runtime 接受 compatible composition adoption 且 planning semantic identity 不变
- **THEN** OTLP 关联 adoption 与恢复 continuation，不产生 planning invalidation 或 Design approval refresh 事件

### Requirement: Continuation 去重必须可观测

Runtime MUST 为相同 checkpoint 上的 continuation request、idempotent replay、revision conflict、dispatch suppressed 和 reconciliation 记录持久化可关联事实，使团队能区分正常恢复、重复调度缺陷和未知副作用；Metric labels MUST 使用有界 request kind、outcome、phase、Work kind 与 recovery classification。

#### Scenario: 重复 next 返回原 checkpoint

- **WHEN** 相同 Run revision 和 current Work 上的 `run next` 重放没有产生新事实
- **THEN** 遥测记录 `dispatch-suppressed` 或 idempotent replay，并关联原 Work/attempt，但不生成第二个 Work started Span

#### Scenario: 响应丢失后的 transition 重放

- **WHEN** 调用方重放已经成功提交的 transition 命令
- **THEN** 事件表示从 checkpoint 恢复既有 continuation，phase transition、invalidation 与 Human Decision requested 计数均不重复

#### Scenario: 未知外部结果进入 reconciliation

- **WHEN** Runtime 不能确定原 invocation 是否跨过副作用边界
- **THEN** Trajectory 与 OTLP 记录 `reconcile` continuation 和原 invocation 关联，不记录 retry 或新 Host invocation 成功

### Requirement: Runtime 稳定性指标必须来自审计事实

Telemetry Provider MUST 从持久事件派生重复批准率、Build Protocol 重建率、精确/保守失效率、保留 completion 比率、checkpoint 恢复结果、reconciliation 数量和重复派发抑制数量；这些 Metric 不得根据最终 phase、目录扫描、Dashboard 交互或日志文本推断。

#### Scenario: 团队评估 Runtime 稳定性

- **WHEN** 多个 Change 完成、返工或中断恢复
- **THEN** 后端可按有界 phase、authority、classification 和 result 聚合稳定性指标，并从 Trace/Event 回到具体审计链解释异常

#### Scenario: 缺少必要审计事实

- **WHEN** 某个旧 Run 没有计算指标所需的版本化事件
- **THEN** Provider 标记数据不可用，不从现有文件或终态猜测成功、失效或重复次数
