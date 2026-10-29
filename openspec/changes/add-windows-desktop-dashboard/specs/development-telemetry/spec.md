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
