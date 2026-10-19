# Spec Delta

## ADDED Requirements

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
