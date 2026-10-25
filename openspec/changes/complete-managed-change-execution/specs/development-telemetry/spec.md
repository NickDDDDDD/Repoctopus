# development-telemetry Delta Specification

## ADDED Requirements

### Requirement: 受管 Change 执行必须产生完整可重放遥测

Repoctopus MUST 在同一权威 Change Run trajectory 中记录 Open、Design、Build、Verify、Archive phase，以及 Work attempt、Host invocation、Skill 上下文、受保护工具调用、Validator、wait/reconcile 和 continuation 的已接受执行边界；Telemetry Provider MUST 只在这些事实持久化后将其投影为版本化 OTLP 信号，不得由 Exporter、Desktop 或后端查询根据目录、最终状态或对话推断缺失事实。

#### Scenario: Work 从领取推进到阶段转换

- **WHEN** 当前 Work 依次完成 claim、context delivery、Host invocation、受保护工具调用、Outcome 和 Validator acceptance
- **THEN** Trajectory 与 OTLP 按相同稳定 identity 和顺序表示全部边界，最后的 lifecycle transition 不能替代或合成前序事件

#### Scenario: 本地提交失败

- **WHEN** Run CAS 或 transition journal 没有持久化某个 Host、工具、Validator 或 phase 成功事实
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

Telemetry Provider MUST 从相同的持久事件派生 phase、Work、Host、tool、Validator 和 wait 时长，以及 attempt、result、retry、reconcile、Skill delivery/consumption 与 tool call 计数。Metric label MUST 只使用有界的 phase、内置 work/tool kind、Skill role、结果和恢复分类；run、change、task、repository、digest、自由 Skill/插件名和 invocation identity不得成为 Metric label。审计 Event/Trace MUST 保留足够的允许列表 identity，使团队可以复算聚合结果并定位效率瓶颈。

#### Scenario: 团队统计 Build 效率

- **WHEN** 多个 Change 执行 Build Work、工具调用、重试和等待
- **THEN** 后端可以按 phase、work/tool kind 和结果聚合数量与耗时，并从事件关联到具体 Run 排查，而不会为每个 Run 或自定义名称创建 Metric time series

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
