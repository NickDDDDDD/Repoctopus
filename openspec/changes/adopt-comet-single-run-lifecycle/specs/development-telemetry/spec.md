# development-telemetry Delta

## MODIFIED Requirements

### Requirement: 生命周期遥测来自权威 Change Run

Repoctopus MUST 只从 Workspace/change 对应的唯一权威 Change Run facts 和公共 projection 映射 runId、phase、status、checkEpoch、current Work、Task progress、wait condition、blocker 和 next action；Exporter、Desktop projection 和后端查询不得扫描 generation 目录、Git 或 MR 后自行推断另一套 lifecycle 状态。

#### Scenario: Run 进入等待状态

- **WHEN** Change Run 接受一个带稳定 wait condition 的转换
- **THEN** 遥测使用同一事件身份输出 runId、phase、status、checkEpoch、Work 和等待类别，桌面与远端目的地可投影出一致状态

#### Scenario: 阶段转换使检查失效

- **WHEN** Runtime 接受阶段转换并递增 checkEpoch，导致仍在执行或不可复用的旧检查失效
- **THEN** Trajectory 与 OTLP 关联原检查和新 epoch，输出有界 `phase-changed` 或 `stale-epoch` 分类，不产生另一条 Run trace

#### Scenario: 平台事实尚未被 Run 接受

- **WHEN** 平台或 Provider 已观察到外部结果，但 Change Run 尚未核对并接受该事实
- **THEN** 遥测可以报告处理状态，但不得提前把 change 阶段标记为已关闭或 completed

### Requirement: 受管 Change 执行必须产生完整可重放遥测

Repoctopus MUST 在同一权威 Change Run trajectory 中记录 Open、Design、Build、Verify、Archive phase，以及 state revision、checkEpoch、Work attempt、Host invocation、Skill 上下文、受保护工具调用、Validator、wait/reconcile 和 continuation 的已接受执行边界；Telemetry Provider MUST 只在这些事实持久化后将其投影为版本化 OTLP 信号，不得输出 lifecycle generation，也不得由 Exporter、Desktop 或后端查询根据目录、最终状态或对话推断缺失事实。

#### Scenario: Work 从领取推进到阶段转换

- **WHEN** 当前 Work 在同一 epoch 内依次完成 claim、context delivery、Host invocation、受保护工具调用、Outcome 和 Validator acceptance
- **THEN** Trajectory 与 OTLP 按相同 runId、attempt、epoch、稳定 identity 和顺序表示全部边界，最后的 lifecycle transition 不能替代或合成前序事件

#### Scenario: Open 与 Design 分别等待批准

- **WHEN** Open 或 Design Work 的 Outcome 与 Validator 已接受并建立各自 Human Decision
- **THEN** Trajectory 与 OTLP 分别记录 phase、Skill delivery/consumption、proposal hash、approval requested/accepted/rejected 和 transition；不得用单个 planning-approved 事件合并两个边界

#### Scenario: Verify 触发受管修复

- **WHEN** Verify implementation failure 使 task revision 重开并创建 Build Repair Work
- **THEN** Trajectory 与 OTLP 关联失败 Evidence、invalidation、phase transition、task reopen、Repair Work identity、TDD Skill 使用和新 completion claim，使团队能复算一次完整返工而不是只看到 phase 往返

#### Scenario: Archive 请求重新验证

- **WHEN** Archive 在副作用前发现 Verify 输入陈旧并返回 Verify
- **THEN** 遥测记录 reverify 分类、epoch 变化与新的 Evidence attempt；若副作用已经开始则记录 reconcile 而不是虚假的 Archive→Verify transition

#### Scenario: 本地提交失败

- **WHEN** Run CAS 或 transition journal 没有持久化某个 Host、工具、Validator、epoch 或 phase 成功事实
- **THEN** Telemetry 不得导出对应成功事件或完成 Span，即使 Host 在进程内曾返回成功

### Requirement: 效率 Metric 必须有界且可从审计事件复算

Telemetry Provider MUST 从相同的持久事件派生 phase、Work、Host、tool、Validator 和 wait 时长，以及 attempt、result、retry、reconcile、epoch invalidation、Skill delivery/consumption 与 tool call 计数。Metric label MUST 只使用有界的 phase、内置 work/tool kind、Skill role、结果、恢复和失效分类；run、change、task、repository、digest、checkEpoch 数值、自由 Skill/插件名和 invocation identity不得成为 Metric label。审计 Event/Trace MUST 保留足够的允许列表 identity，使团队可以复算聚合结果并定位效率瓶颈。

#### Scenario: 团队统计 Build 效率

- **WHEN** 多个 Change 执行 Build Work、工具调用、重试、epoch 失效和等待
- **THEN** 后端可以按 phase、work/tool kind 和有界结果分类聚合数量与耗时，并从事件关联到具体 Run 排查，而不会为每个 Run、epoch 或自定义名称创建 Metric time series

#### Scenario: 自定义 Skill 或工具名称无界

- **WHEN** 团队插件提供未在有界 metric catalog 中登记的 Skill 或 operation 名称
- **THEN** Event 可保留通过安全校验的真实 identity，Metric label 降级为 `custom` 或 `unknown`，并通过 cardinality gate
