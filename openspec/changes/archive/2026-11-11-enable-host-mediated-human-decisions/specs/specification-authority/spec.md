## ADDED Requirements

### Requirement: 规划批准的宿主回传绑定当前提案

Repoctopus MUST 让宿主读取当前 Open 或 Design 批准请求的完整评审材料，并通过公开入口提交绑定 requestId、proposalHash 和审批阶段的真实用户决定。宿主交互与终端交互 MUST 复用同一规划批准权威；Runtime MUST 保留 Provider 校验、当前规划事实重验、独立阶段批准及 Open 执行隔离意图校验。

#### Scenario: Open 通过宿主批准

- **WHEN** 四类规划工件通过严格校验，用户通过 Host 审查当前 Open 提案并选择合法 isolation
- **THEN** Runtime 验证请求、当前提案及 isolation 后记录 Open 决定，按既有规划重验规则创建 Design Work；Host 不直接指定阶段

#### Scenario: Design 通过宿主批准

- **WHEN** Design Work 已接受，用户通过 Host 审查当前 Design 提案并批准
- **THEN** Runtime 记录独立 Design 决定并沿已批准规划与 Strategy 继续；Open 的答复不能替代本次 Design 审查

#### Scenario: 用户选择修改或拒绝

- **WHEN** 用户通过 Host 对当前规划提案选择要求修改或拒绝
- **THEN** Runtime 沿既有决定语义处理并保留选择依据，不生成批准事实，也不进入依赖批准的后继 Work

#### Scenario: 展示后规划发生变化

- **WHEN** Host 已展示规划提案，但回传前当前请求身份、规划语义或 Provider/schema 事实发生有效性变化
- **THEN** Runtime 拒绝把该答复用于未审查的新内容，并返回可定位的重新观察或评审指引

#### Scenario: Open 隔离选择缺失或不兼容

- **WHEN** Host 提交 Open 批准但缺少当前请求必需的 isolation，或选择与真实 checkout facts 不兼容
- **THEN** Runtime 在写入批准和 intent 之前拒绝响应，保留同一可纠正请求，不猜测隔离方式或部分批准

#### Scenario: Work Outcome 包含自行批准声明

- **WHEN** Agent 仅在 Work Outcome、摘要或结果中声明用户已批准，而没有独立决定入口接受的匹配响应
- **THEN** Runtime 不把该声明作为规划批准，不绕过 Open 或 Design 人工边界

#### Scenario: 交互记录与遥测保持边界

- **WHEN** 系统记录宿主交互及接受的规划决定
- **THEN** 决定来源与请求、提案身份可供核对，Trajectory 和 OTLP 继续由已持久化事实生成；遥测事件或 Dashboard 投影不能充当用户授权，指标不包含问答正文或凭据
