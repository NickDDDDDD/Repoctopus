# Spec Delta

## ADDED Requirements

### Requirement: 产品运行时使用短生命周期入口

Repoctopus MUST 通过请求范围的 CLI、Desktop 或受保护 Service 调用装配项目 composition、执行当前工作并有界关闭；核心工作流不得要求监听端口、Webhook、Event Inbox、轮询 Timer 或长驻 Runner 才能完成或恢复。

#### Scenario: 正常 Change 命令执行

- **WHEN** 用户启动、继续、验证、归档或核对一个 Change
- **THEN** Host 装配所需项目能力、执行请求、持久化 Receipt 并关闭插件树，不留下后台监听器

#### Scenario: 下一次命令恢复未确认发布

- **WHEN** 前一次短生命周期命令在 push 或 MR 创建响应前中断
- **THEN** 新命令从 Intent 和远端当前事实恢复，不依赖旧进程、Runner lease 或事件投递

### Requirement: 只读 CLI 命令不得启动项目副作用

帮助、版本、状态、inspect、doctor 和参数错误 MUST 在装配 Project composition 前完成解析；这些请求不得执行一致性审查、创建 Run 或写持久状态。

#### Scenario: 请求子命令帮助

- **WHEN** 用户执行 `run start --help` 或 `change reconcile --help`
- **THEN** CLI 只输出对应子命令用法，零 composition、零 reconcile、零 Run 写入

#### Scenario: 必需参数缺失

- **WHEN** 用户意图启动 Change Run 但缺少受保护的必需参数
- **THEN** CLI 返回参数错误，不回退到默认 workflow 或执行启动前检查

### Requirement: 人工等待与按需恢复不占用进程

WorkflowRuns MUST 把等待用户决定或可重试输入表示为 Change Run 内持久化的 phase、status 与条件，不要求单一进程、IDE 会话或 Fiber 持续存活；Archive 不得等待 MR 合入，已完成 Change 的一致性审查不得建立生命周期等待条件。

#### Scenario: 等待人工决定期间产物漂移

- **WHEN** `design/waiting` 的 Run 被用户响应唤醒但当前规划语义摘要已变化
- **THEN** Runtime 拒绝旧决定并生成基于当前摘要的新等待事实

#### Scenario: 已完成 Change 尚未执行一致性审查

- **WHEN** 远端 MR 可能已变化但尚无下一次任务或显式 reconcile
- **THEN** 原 Run 保持 completed，系统只报告最后审查时间，不维持后台进程或 waiting 状态

## MODIFIED Requirements

### Requirement: 自举开发使用产品公共能力

Repoctopus MUST 能用已发布或当前工作树构建的产品入口执行自身真实 change 的需求澄清、规格校验、实施 Evidence、交付、规格关闭和后续一致性审查，不得使用只存在于测试中的旁路状态转换或要求 Webhook/长驻 Runner。

#### Scenario: Repoctopus 交付自身 change

- **WHEN** 维护者以 Repoctopus 仓库作为项目运行自举工作流
- **THEN** Run、Evidence、Delivery、规格关闭和 Publication Receipt 均通过生产 composition 与公共服务完成，并留下可核对 Trajectory

## REMOVED Requirements

### Requirement: 外部事件通过受保护入口启动 Run

**Reason**: Webhook、平台投递和 Event Inbox 整体退役，外部事件不再启动或唤醒 Run。

**Migration**: Archive 以 Publication Receipt 完成，后续事实由短生命周期 consistency reconcile 拉取。

### Requirement: 人工等待与后台恢复不占用进程

**Reason**: 原要求把等待 MR 合入和平台事件唤醒纳入核心 Runtime；新模型只保留人工决定等待和短生命周期按需恢复。

**Migration**: 使用“人工等待与按需恢复不占用进程”要求，Archive 不再创建 merge wait。
