# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

### Requirement: OTLP 记录携带桌面状态所需的可信关联

Telemetry Adapter MUST 在事实真实可用时为非 Metric 记录提供 Workspace、change、Run、父子执行、阶段、执行主体、任务、验证、阻塞、下一步动作、结果和观测时间的稳定关联；Metric 仍只使用有界低基数维度，缺失字段不得推断。

#### Scenario: Agent 开始执行一个任务

- **WHEN** Runtime 已持久化可验证的 change、Run、执行主体、阶段和任务关系
- **THEN** 对应 Span 或 Log 可以通过稳定属性重建该执行关系且不包含 Prompt、回复或命令输出

#### Scenario: Run 进入人工阻塞

- **WHEN** 工作流创建需要人处理的 Human Decision
- **THEN** 遥测记录 change、Run、阶段、阻塞类别、请求身份和可公开下一步动作，不嵌入规格、设计图或决策正文

#### Scenario: 仅存在无法验证的下一步建议

- **WHEN** Runtime 没有持久化权威下一步动作
- **THEN** Telemetry 不导出推断的下一步属性，桌面或远端消费者可以明确表示缺失

### Requirement: 执行事件携带统一权威上下文

Runtime MUST 从当前已接受的 Work 和 claim 为 Work、Host、Skill、Tool、Validator、Wait、Reconcile 与 Continuation 事件构造一致的执行上下文；上下文至少包含 phase、Work identity/kind、attempt、checkEpoch 和事实存在时的 Task identity，Telemetry Adapter 不得通过相邻事件或最新 Run 快照补造缺失关联。

#### Scenario: Work 在 Host 中执行并完成验证

- **WHEN** Runtime 持久化该 Work 的 context delivery、Host boundary、Skill、Tool、Outcome 和 Validator 事件
- **THEN** 每个事件都携带同一 phase、Work、attempt、checkEpoch 和 Task 关联且消费者无需按时间邻近猜测

#### Scenario: 旧事件没有完整执行上下文

- **WHEN** 兼容读取器遇到缺失新字段的历史 envelope
- **THEN** 对应字段保持未知并标记 schema 能力，不把其他 Run 或 Work 的值填入历史事件

### Requirement: 生命周期和 Task 事实支持完整五阶段投影

Runtime MUST 持久化五阶段转换、Task 状态/修订、Task 开始/完成/失败/重开、当前 Work 和返工原因类别，使消费者可以确定性重建 `Open → Design → Build → Verify → Archive` 当前状态、历史转换和任务进度。

#### Scenario: Verify 失败要求返回 Build

- **WHEN** Evidence Gate 接受 implementation failure 并重新打开受影响 Task
- **THEN** 遥测关联原验证、返工类别、重新打开的 Task revision 和新的 Build Work，低基数 Metric 记录一次 verify-to-build 返工

#### Scenario: Archive 检测到规划语义漂移

- **WHEN** Runtime 接受 Archive 到 Design 的 fallback
- **THEN** 遥测保留同一 Run 身份并记录有界 fallback 类别、前后 phase 和受影响 Work，而不创建平行生命周期

### Requirement: Human Decision 和等待边界可分析

Runtime MUST 为 Open、Design、adopt-existing 和 design-revision 的 Human Decision 持久化请求、等待开始、决定和等待结束事实，并为 human、retry 与 external-fact 等等待提供有界类别和可计算时长；自由文本理由、规格正文和审批正文不得进入遥测。

#### Scenario: Open 等待人工确认

- **WHEN** Open Work 通过 Validator 并创建 Human Decision
- **THEN** Log/Span 关联 phase、request、wait 和 proposal identity，Metric 只记录 `open`、`human-decision` 与等待时长

#### Scenario: 用户要求修改 Design

- **WHEN** Design Decision 返回 changes requested
- **THEN** Runtime 记录有界结果和后续 Design Work，消费者可以区分人工等待、被要求修改和执行失败

### Requirement: Skill 遥测区分装填和可验证消费

Runtime MUST 为每个 Work 的 action 与 augmentation Skill 记录 resolved、delivered 和 Host-declared consumed 事实及版本摘要；产品界面和文档不得把 consumed 描述为对 Agent 内部思考的直接观测。

#### Scenario: 成功 Work 消费全部要求 Skill

- **WHEN** Host 返回成功 Outcome 并证明消费了所有已交付 Skill layer
- **THEN** 遥测按同一 Work/attempt 呈现每个 Skill 的 resolved、delivered、consumed 链路

#### Scenario: Host 未报告 Skill 消费

- **WHEN** Host 没有为已交付 Skill 提供消费证明
- **THEN** Runtime 不接受成功 Outcome，Dashboard 不把该 Skill 显示为已使用

### Requirement: Tool 与资源效率遥测保持有界和可选

Runtime MUST 记录受保护 Runtime 操作的 Tool 边界；Work Execution Host MAY 上报版本化有界 Tool 类别、结果、耗时、调用数以及可信可用时的模型版本和 Token/缓存聚合。系统不得上报命令、参数、路径、Prompt、回复、输出或把未上报解释为零。

#### Scenario: Host 执行测试

- **WHEN** Host 可靠观察到一次测试工具调用
- **THEN** 遥测可以记录 `test.run`、开始/结束、结果和耗时，并关联当前 Work/Task，不包含测试命令或输出

#### Scenario: Host 不支持工具观测

- **WHEN** Host 只返回 Work Outcome 而没有 Tool 或资源使用事实
- **THEN** Work 仍可按领域契约完成，消费者将这些效率字段显示为未知而不是零

### Requirement: Validator、阶段和返工具有真实持续时间

Runtime MUST 记录 Validator 开始与完成边界，并从 accepted transition、Work、Wait 和 Validator 事实计算阶段驻留、主动执行、人工等待、外部等待、验证与返工的低基数 Metric；Span 不得用同一时间戳伪造非零操作的开始与结束。

#### Scenario: Validator 执行后拒绝 Outcome

- **WHEN** Validator 从开始到完成返回 rejected 和有界 finding category
- **THEN** Span 使用真实边界，Metric 记录 profile、phase、result、finding category 和持续时间

#### Scenario: Change 在 Design 等待两次审批

- **WHEN** Design 因 changes requested 产生第二次 Human Decision
- **THEN** 阶段驻留包含两段等待，团队分析可以分别看到主动时间、等待时间和一次 Design 返工

### Requirement: 遥测管道健康本身可观察

Telemetry Provider MUST 为每个目的地暴露有界的 cursor lag、backlog 数量/字节/最老年龄、最近尝试结果、重试、gap、retention drop、Receiver 接受/拒绝和投递延迟事实；这些诊断不得依赖故障中的远端端点才能被本地 Dashboard 观察。

#### Scenario: 远端端点不可用但桌面可用

- **WHEN** 远端目的地连续失败且本地目的地继续确认
- **THEN** Dashboard 显示远端 backlog、最老年龄和失败类别，本地目的地保持健康，工作流领域结果不受影响

#### Scenario: 保留上限删除未确认 envelope

- **WHEN** Store 必须删除仍未被某目的地确认的 envelope
- **THEN** 先持久化 gap 与累计 drop 计数，消费者不得把此后投影视为完整历史

### Requirement: 团队健康指标可解释且保持低基数

Telemetry Provider MUST 提供可分别解释的流转、执行、质量和遥测健康指标，不得把 Run、change、Task、Work、Skill 自由名称或其他无界身份用作 Metric label，也不得只输出无法追溯原因的单一总分。

#### Scenario: 团队比较工作流版本

- **WHEN** SigNoZ 聚合多个 Run 的阶段耗时、返工、验证和恢复数据
- **THEN** 每个序列只使用 workflow/version、phase、Work kind、结果和有界原因等维度，并可通过关联 Log/Span 下钻到具体 Run

#### Scenario: 自定义 Skill 名称出现

- **WHEN** 一个团队插件提供未内置的 Skill 名称
- **THEN** Log 可以携带通过安全检查的精确名称，Metric 只使用 Skill 角色或 `custom` 类别以避免基数失控

### Requirement: 本地实时消费不改变远端 OTLP 契约

本地桌面目的地 MUST 消费与远端后端相同的标准 OTLP 信号和 Repoctopus 属性契约；领域层不得为桌面 UI 创建旁路状态协议，远端后端也不得成为桌面实时更新的查询依赖。

#### Scenario: 更换团队 OTLP 后端

- **WHEN** 团队把 SigNoZ 替换为另一个兼容 OTLP 的后端
- **THEN** 本地桌面投影、领域事件和规范观测 envelope 无需修改

#### Scenario: 远端后端无法访问

- **WHEN** 开发机暂时无法访问团队 OTLP 后端但桌面接收器可用
- **THEN** 桌面应用继续由本地上报实时更新且不轮询远端后端
