# Spec Delta

## ADDED Requirements

### Requirement: 核心组合不包含无当前需求的事件基础设施

Project composition MUST 只装载当前命令所需的 Runtime、Skill、Specification、Delivery、Telemetry 与一致性审查能力；产品 catalog 和公共 CLI 不得注册 HTTP Webhook Host、Event Inbox、Platform Event Runner 或无请求范围的 Post-merge Coordinator。

#### Scenario: 普通项目组合启动

- **WHEN** 用户执行 Change 生命周期或一致性审查命令
- **THEN** composition 不打开监听端口、不创建 Event Inbox 状态且不启动轮询 Fiber

#### Scenario: 新插件尝试恢复核心 Webhook

- **WHEN** 内置插件声明无当前 Change 请求的监听路由、Inbox lease 或后台平台事件循环
- **THEN** 架构治理检查拒绝其进入核心组合，并要求通过独立未来 Change 证明需求

## REMOVED Requirements

### Requirement: 平台事件能力保持插件化

**Reason**: 当前产品不需要实时平台事件，整套 Webhook/Inbox/Runner 插件链删除而非保留空扩展点。

**Migration**: Delivery Adapter 主动查询 MR；一致性审查由短生命周期命令调用。

### Requirement: 新插件身份进入组合快照

**Reason**: 原要求和场景把平台事件与 Post-merge Coordinator 作为组合输入；这些能力已经退役。

**Migration**: 使用“活动插件身份进入组合快照”要求，只纳入当前产品实际装配的能力。

## ADDED Requirements

### Requirement: 活动插件身份进入组合快照

Repoctopus MUST 把活动 Skill、Specification、Lifecycle Definition、Work、Validator、Extension、Delivery 与一致性审查实现的稳定身份、版本、代码摘要与配置摘要纳入 composition digest，并在 Run、Evidence 和 Archive Action 恢复前核对兼容性。

#### Scenario: Archive 实现在中断期间升级

- **WHEN** 未完成 Change Run 恢复时 Archive、Delivery 或 Specification 实现身份发生不兼容变化
- **THEN** 写操作进入 `migration_required`，只读状态和诊断仍可访问

#### Scenario: 未使用 Contributor 发生兼容变化

- **WHEN** 某个已安装 Contributor 没有进入当前 composition
- **THEN** 其版本变化不改变当前 composition digest 或阻断当前 Run
