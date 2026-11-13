# 工作流健康观测规格变更

## MODIFIED Requirements

### Requirement: 本地 Dashboard 与远端后端必须消费相同 OTLP 协议

Repoctopus MUST 从同一份已持久化领域事实生成规范观测 envelope。本地桌面端通过 OTLP 即时显示 Change、Work、Skill、等待和恢复。远端可按信号选择和合批发送 envelope。两处收到同一事实时，事件身份、关联字段和含义 MUST 一致。

#### Scenario: 同一事件由不同 OTLP 目的地消费

- **WHEN** 一个已持久化的阶段转换同时上报本地和远端
- **THEN** 两端收到相同的事件及 Run 身份和阶段变化
- **AND** 桌面投递无需等待远端合批或查询远端后端

#### Scenario: 本地 Dashboard 未运行

- **WHEN** 工作流执行期间桌面 Receiver 不可用
- **THEN** 远端上报和工作流继续执行，桌面按既有有界恢复规则处理

### Requirement: 遥测目的地独立确认和恢复

Telemetry Provider MUST 按目的地和 OTLP 信号独立记录投递进度。远端默认 MUST 保留统计所需事实及必要诊断，按有界批次发送。团队可显式启用细粒度诊断。导出失败 MUST 保留可重试的投递进度，工作流结果保持有效。

#### Scenario: 本地成功而远端失败

- **WHEN** 桌面接收器确认 envelope 但远端 OTLP 后端超时
- **THEN** 本地确认进度推进，远端待确认的信号独立重试，桌面不重复制造逻辑状态

#### Scenario: 远端成功而本地失败

- **WHEN** 远端 OTLP 后端确认 envelope 但桌面接收器未运行
- **THEN** 远端确认进度推进，本地确认进度保持并在接收器恢复后重放

#### Scenario: 移除桌面目的地

- **WHEN** 用户禁用桌面应用或卸载本地接收器
- **THEN** 停止该目的地积压增长，远端确认进度保持有效

#### Scenario: 单个信号明确投递失败

- **WHEN** 同批 Log 已确认成功且 Metric 投递失败
- **THEN** 恢复时仅重试仍待确认的信号，已确认的 Log 不因 Metric 失败而重发

#### Scenario: 重放或确认结果未知

- **WHEN** Runtime 恢复后重发具有相同身份的工作流事实
- **THEN** 团队统计按照稳定身份去重，重复送达不会增加计数
- **AND** OTLP 部分拒收和结果未知均保留可诊断状态

#### Scenario: 暂停或移除一个目的地

- **WHEN** 团队暂停或移除桌面或远端目的地
- **THEN** 该目的地按相应保留规则处理，另一目的地的确认进度不受影响

### Requirement: 工作流健康和效率度量必须可复算

Repoctopus MUST 从持久化 Run 启动、已批准 Build 配置、当前生命周期、已接受的阶段转换和终态导出可关联的事实。看板 MUST 使用唯一 Run 和转换身份，并提供运行量及配置分布、终态失败率、未到终态占比和完成 Run 平均回退次数。已有权威周期继续可供同口径的效率基线查询。

#### Scenario: 按配置查看运行量

- **WHEN** 团队查看统计期内启动的 Change Run
- **THEN** 每个唯一 Run 计一次，并按该 Run 截止时有效的已批准执行方式、测试方式和隔离方式归类
- **AND** 尚未批准配置的 Run 单列，重复审批、恢复和重试不增加 Run 数

#### Scenario: 工作流执行失败

- **WHEN** 团队查看某统计期的 Run 终态
- **THEN** 分子为同期进入失败终态的唯一 Run 数，分母为同期进入完成或失败终态的唯一 Run 数

#### Scenario: 定位未到终态的 Run

- **WHEN** 统计期内启动的 Run 在统计截止时尚未完成或失败
- **THEN** 该 Run 进入未到终态分子，总量使用同期启动的唯一 Run
- **AND** 可查看最后确认的阶段、状态、原因与停留时长，缺失原因显示未知

#### Scenario: 分析平均回退次数

- **WHEN** 团队查看统计期内进入完成终态的 Run
- **THEN** 按每个 Run 完整生命周期统计实际接受的跨阶段回退，使用同一完成 Run 集合计算总平均及按目标、具体路径的分项平均
- **AND** 零回退 Run 纳入分母，同阶段重试不计入，窗口前发生的回退仍归属该完成 Run

#### Scenario: 团队比较交付周期

- **WHEN** 查询使用相同 workflow/version 及周期定义对比当前窗口和基线窗口
- **THEN** 可用权威周期计算差异，缺失基线或未完成 Run 表示为未知

## ADDED Requirements

### Requirement: 工作流健康看板可导入并对账

Repoctopus MUST 交付可导入的 SigNoz Dashboard 与公开字段说明。四项指标 MUST 明确统计窗口、分子、分母、去重粒度和下钻方式。无样本时 MUST 显示无样本。

#### Scenario: 本地多仓验收

- **WHEN** 在本地 SigNoz 导入看板，并用真实多仓 Run 覆盖完成、失败、等待、阻塞和跨阶段回退
- **THEN** 通过本地 MCP 与 Runtime 记录对账，核对四项指标、分组和下钻结果
- **AND** 对比同一工作流场景的 HTTP 请求数、入库记录数和重复记录数，并验证单信号失败后的恢复
