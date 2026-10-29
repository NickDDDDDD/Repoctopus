# desktop-observability-dashboard Delta

## ADDED Requirements

### Requirement: 人工等待只展示当前有效语义决定

桌面应用 MUST 从标准 OTLP 事实投影当前有效 Human Decision，并展示 phase、decision kind、有界 reason、创建时间和其绑定的 Strategy/composition/Plan revision；相同 semantic digest 的重试、恢复或返工不得产生重复待处理卡片。界面 MUST 区分真正需要用户选择、Runtime 正在自动重验 ExecutionBinding，以及历史已复用/失效决定。

#### Scenario: Build Configure 重验 checkout

- **WHEN** 当前 Strategy 已批准而 Runtime 正在验证新的 ExecutionBinding
- **THEN** Dashboard 显示自动验证状态和受影响 Work，不显示“请再次批准 Build Configuration”

#### Scenario: 相同摘要重复投递

- **WHEN** receiver 因 OTLP 重试收到同一 decision created/reused 事实
- **THEN** 投影收敛为一张当前卡片并保留历史事件，不增加待处理数量

#### Scenario: 团队方法语义改变

- **WHEN** effective composition 变化使 Design approval 失效并产生新决定
- **THEN** Dashboard 显示 `composition_changed` reason 和新旧 revision 关联，不把它描述成普通 Host/binding 故障

## MODIFIED Requirements

### Requirement: 当前 Work 显示 Skill 装填与消费状态

桌面应用 MUST 按 Action、内置 augmentation、team guidance、augmentation replacement 和 required check 角色列出当前或所选 Work 的 Skill，并分别显示 resolved、delivered、consumed、method verified、验证失败或未上报。界面 MUST 将 consumed 描述为 Host 声明并经 Runtime 校验的内容消费证明，将 method verified 描述为 Method Receipt/Validator 的机器核对结果；二者均不得描述为 Agent 内部思考证据。

#### Scenario: Design Work 装填两个 Skill

- **WHEN** Runtime 为 Design Work 上报 Action、`codebase-design` 和一个团队 guidance 的完整链路
- **THEN** Dashboard 按角色和冻结顺序展示三个 Skill，以及各自 resolved、delivered、consumed 和适用的 method verified 状态

#### Scenario: Skill 只完成交付

- **WHEN** Dashboard 已收到 Skill resolved 与 delivered，但尚未收到该 Work 的 consumed
- **THEN** Skill 显示为已交付、消费尚未上报，不得提前显示已使用或方法已验证

#### Scenario: Skill 已消费但 TDD 方法失败

- **WHEN** TDD layer consumed，而 Method Validator 拒绝 RED/GREEN Receipt
- **THEN** Dashboard 同时显示“已消费”和“方法验证失败”及有界原因，不把 Work 或 TDD 表示为成功

#### Scenario: Skill 消费证明被 Runtime 拒绝

- **WHEN** Host 声明的 Skill layer 或 Method Receipt 与 Work Package 不匹配且 Runtime 拒绝 Outcome
- **THEN** Dashboard 显示消费或方法校验失败及有界原因类别，不把该 Skill 或 Work 表示为成功完成

#### Scenario: 团队 required check 阻断

- **WHEN** required check Work 或其 Method Validator 失败
- **THEN** Dashboard 在当前 checkpoint 显示独立检查、团队 binding 角色和阻断结果，不把它伪装成核心 Action 失败或新 phase
