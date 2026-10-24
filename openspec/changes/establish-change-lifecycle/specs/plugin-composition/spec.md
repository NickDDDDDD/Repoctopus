# plugin-composition Specification

## ADDED Requirements

### Requirement: Lifecycle 扩展只挂接声明的安全点

Repoctopus MUST 通过独立 Cordis Service/Contributor 组合 Lifecycle Definition、Work Adapter、Validator 和 Lifecycle Extension，并把其身份纳入 composition snapshot；Extension 只能在 definition 声明的 checkpoint 增加受约束 Work 或 validation，不得直接转换 phase、替换核心 Human Decision、把失败 Gate 改为满足或提前关闭规格。

#### Scenario: 插件增加许可证验证

- **WHEN** Lifecycle Extension 在 Build 后声明一个允许的验证 checkpoint、固定 Work 输入和 Validator
- **THEN** Cordis 可以激活该扩展并把其身份固定到 Run，核心 phase transition 仍由 lifecycle handler 决定

#### Scenario: 插件尝试跳过 Design approval

- **WHEN** Extension 声明直接把 Open 或 Design 推进到 Build
- **THEN** composition validation 拒绝该插件并报告受保护 checkpoint

## MODIFIED Requirements

### Requirement: 平台事件能力保持插件化

Repoctopus MUST 把 HTTP Host、平台验签 Adapter、Event Inbox、Change Run Wake Coordinator 和 Runner 作为可独立替换的 Service、Provider 或 Contributor 组合，并由 Effect 管理路由、监听器、Timer 和领取租约；Coordinator 只能持久化平台事实并唤醒权威 Change Run，不得拥有 Post-merge 状态机或创建第二个 Run。

#### Scenario: GitHub Adapter 未配置

- **WHEN** project composition 没有启用 GitHub 事件 Adapter
- **THEN** 其他 Runtime、Skill、Specification 和手动 Archive reconcile 能力仍可启动，GitHub webhook 入口明确不可用

#### Scenario: Runner 插件卸载

- **WHEN** Runner Fiber 卸载且存在已持久化但未完成的投递
- **THEN** 新投递停止领取，活动处理排空到可恢复点，Inbox 事实保留给后续实例唤醒同一 Change Run

### Requirement: 新插件身份进入组合快照

Repoctopus MUST 把活动 Skill、Specification、Lifecycle Definition、Work、Validator、Extension 和平台事件实现的稳定身份、版本、代码摘要与配置摘要纳入 composition digest，并在 Run、Evidence 和 Archive Action 恢复前核对兼容性。

#### Scenario: Post-merge Coordinator 在中断期间升级

- **WHEN** 未完成 Change Run 恢复时 Coordinator 实现身份发生不兼容变化
- **THEN** 写操作进入 `migration_required`，只读状态和诊断仍可访问

#### Scenario: 未使用 Contributor 发生兼容变化

- **WHEN** composition 中一个未被当前或历史 Work 使用的 Contributor 以兼容方式升级
- **THEN** 系统记录新组合供后续 Work 使用，不使已有 accepted facts 失效
