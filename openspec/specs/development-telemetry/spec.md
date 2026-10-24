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

### Requirement: 平台事件处理可追踪但不泄露载荷秘密

Repoctopus MUST 为平台投递的接收、去重、领取、重试、完成和死信输出关联事件，并使用 Delivery ID、Source、事件类型、change、Run 与状态关联；签名、Token、Header、Cookie 和原始载荷默认不得导出。

#### Scenario: 重复 GitHub Delivery 被去重

- **WHEN** Event Inbox 识别到重复 Delivery ID
- **THEN** 遥测记录去重结果和原投递关联，不输出签名或请求正文

### Requirement: Post-merge Run 输出阶段与证据关联

Repoctopus MUST 为同一 Change Run Archive 阶段的合入事实核对、临时检出、Evidence Gate、规格同步、路径审计、commit、push 和 MR 创建输出可关联状态，并引用持久 Work、Receipt 或 Artifact 身份而非嵌入完整内容；不得以独立 Post-merge Run 表达这些步骤。

#### Scenario: 规格同步因冲突停止

- **WHEN** Archive Work 生成 Human Decision 并使 Change Run 进入 blocked 或 waiting
- **THEN** 遥测记录 phase、status、冲突类别、change、Run、Work 和请求身份，不记录设计图或规格正文

#### Scenario: Webhook 唤醒 Archive

- **WHEN** 平台投递使同一 Change Run 从 `archive/waiting` 恢复执行
- **THEN** 遥测关联 Delivery ID、wake identity 和原 Run，不生成新的 Post-merge Run identity

### Requirement: 个人学习遥测默认关闭

Repoctopus MUST 把 `.repoctopus/learning/` 视为个人数据边界，默认不扫描、不建立 Artifact 且不输出文件数量、主题名称或内容摘要；只有用户显式配置的团队知识提升动作可以进入普通审计链。

#### Scenario: Teach 写入个人笔记

- **WHEN** Skill 在个人学习目录新增或修改文件
- **THEN** 开发遥测不产生针对这些文件的采集事件

### Requirement: 生命周期遥测来自权威 Change Run

Repoctopus MUST 只从已接受的 Change Run facts 和公共 projection 映射 phase、status、current Work、Task progress、wait condition、blocker 和 next action；Exporter、Desktop projection 和后端查询不得扫描目录、Git 或 MR 后自行推断另一套 lifecycle 状态。

#### Scenario: Run 进入等待状态

- **WHEN** Change Run 接受一个带稳定 wait condition 的转换
- **THEN** 遥测使用同一事件身份输出 phase、status、Work 和等待类别，桌面与远端目的地可投影出一致状态

#### Scenario: 平台事实尚未被 Run 接受

- **WHEN** Inbox 已收到合入事件但 Change Run 尚未核对并接受该事实
- **THEN** 遥测可以报告投递处理状态，但不得提前把 change 阶段标记为已关闭或 completed
