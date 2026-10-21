# Spec Delta

## ADDED Requirements

### Requirement: Skill 与规格能力使用独立 Cordis Service

Repoctopus MUST 把 Skill 目录和规格权威分别定义为独立 Cordis Service，由 Provider 提供实现、由 Workflow Consumer 注入使用；不得建立通用 Capability Resolver、第二套依赖容器或把具体 OpenSpec 与 Skill 路径写入 Engine。

#### Scenario: 默认 Provider 被替换

- **WHEN** 项目组合选择兼容的 Skill 或 Specification Provider
- **THEN** Cordis 依据 Inject 和 Fiber 激活新实现，消费者不改用例状态机

#### Scenario: Provider 卸载

- **WHEN** 活动 Provider 所属 Fiber 被卸载
- **THEN** Cordis 撤销 Service 或登记项，并阻止新操作使用已经失效的实现

### Requirement: 平台事件能力保持插件化

Repoctopus MUST 把 HTTP Host、平台验签 Adapter、Event Inbox、Post-merge Coordinator 和 Runner 作为可独立替换的 Service、Provider 或 Contributor 组合，并由 Effect 管理路由、监听器、Timer 和领取租约。

#### Scenario: GitHub Adapter 未配置

- **WHEN** project composition 没有启用 GitHub 事件 Adapter
- **THEN** 其他 Runtime、Skill、Specification 和手动 Delivery 能力仍可启动，GitHub webhook 入口明确不可用

#### Scenario: Runner 插件卸载

- **WHEN** Runner Fiber 卸载且存在已持久化但未完成的投递
- **THEN** 新投递停止领取，活动处理排空到可恢复点，Inbox 事实保留给后续实例恢复

### Requirement: 新插件身份进入组合快照

Repoctopus MUST 把活动 Skill、Specification、平台事件和 Post-merge 实现的稳定身份、版本、代码摘要与配置摘要纳入 composition digest，并在 Run、Evidence 和 Delivery 恢复前核对兼容性。

#### Scenario: Post-merge Coordinator 在中断期间升级

- **WHEN** 未完成 Run 恢复时 Coordinator 实现身份发生不兼容变化
- **THEN** 写操作进入 `migration_required`，只读状态和诊断仍可访问
