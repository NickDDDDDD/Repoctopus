# development-telemetry Specification Delta

## ADDED Requirements

### Requirement: Build 协议的配置计划执行检查必须可观测

Repoctopus MUST 在本地 Trajectory 持久化后，为 Build Configure、Plan、Plan Evidence、Execute 与 Check 输出版本化 Span/Event，并关联 runId、phase、action kind、attempt、checkEpoch、配置与计划 revision/digest、execution/tdd/review/isolation 的有界枚举、Work Package identity、Task references、repository role、Skill delivery/consumption、Validator result 和 duration。Metric labels MUST 使用有界枚举；run、Task、package、仓库与 digest 只能作为 Trace/Event attributes 或关联资源，不得成为高基数 Metric labels。

#### Scenario: Build Configuration 获得批准

- **WHEN** Runtime 持久化配置 proposal、可信批准与冻结 identity
- **THEN** OTLP 表示 configure action、选择的有界策略、approval latency 和结果，但不导出用户输入正文或本机路径

#### Scenario: isolation binding 被接受

- **WHEN** Runtime 接受 Runner/Host 提供的多仓 execution workspace binding
- **THEN** Trajectory 记录 repository role、isolation 枚举、binding semantic digest 和验证结果；OTLP 不导出 checkout 绝对路径、用户名或本机 worktree 名称

#### Scenario: Plan revision 修复 Verify finding

- **WHEN** Verify failure 使当前计划部分失效并接受新的 revision
- **THEN** Trajectory 与 OTLP 通过稳定 finding classification 和前后 plan identity 关联 invalidation、revision、Execute 与 Check，使团队能计算返工率和计划稳定性

#### Scenario: subagent 包被委派

- **WHEN** 配置为 subagent-driven-development 且协调 Host 执行一个 Work Package
- **THEN** Trace 以父子 Span 关联协调调用、受管执行者调用、Skill 消费、受保护工具与 Outcome；Metric 不使用 Agent、package 或 Task ID 作为 label

#### Scenario: autonomous Work 完成

- **WHEN** autonomous Host 完成当前 Work Package 并通过 Validator
- **THEN** Trace 保留与 subagent 模式相同的 Action、package、Task、测试、Review 和 Check 语义，使两种模式可比较而无需后端猜测

## MODIFIED Requirements

### Requirement: 受管 Change 执行必须产生完整可重放遥测

Repoctopus MUST 在同一权威 Change Run trajectory 中记录 Open、Design、Build、Verify、Archive phase，以及 state revision、checkEpoch、Build Action、配置与计划 revision、Work attempt、Host invocation、Skill 上下文、受保护工具调用、Validator、wait/reconcile 和 continuation 的已接受执行边界；Telemetry Provider MUST 只在这些事实持久化后将其投影为版本化 OTLP 信号，不得输出 lifecycle generation，也不得由 Exporter、Desktop 或后端查询根据目录、最终状态或对话推断缺失事实。

#### Scenario: Work 从领取推进到阶段转换

- **WHEN** 当前 Work 在同一 epoch 内依次完成 claim、context delivery、Host invocation、受保护工具调用、Outcome 和 Validator acceptance
- **THEN** Trajectory 与 OTLP 按相同 runId、attempt、epoch、稳定 identity 和顺序表示全部边界，最后的 lifecycle transition 不能替代或合成前序事件

#### Scenario: Open 与 Design 分别等待批准

- **WHEN** Open 或 Design Work 的 Outcome 与 Validator 已接受并建立各自 Human Decision
- **THEN** Trajectory 与 OTLP 分别记录 phase、Skill delivery/consumption、proposal hash、approval requested/accepted/rejected 和 transition；不得用单个 planning-approved 事件合并两个边界

#### Scenario: Verify 触发受管修复

- **WHEN** Verify implementation failure 使当前计划 Evidence 失效并返回 Build Plan revision
- **THEN** Trajectory 与 OTLP 关联失败 Evidence、invalidation、phase transition、旧新 plan identity、受影响 Work Package、后续普通 Execute Work、Skill 使用和新 Build Check，使团队能复算一次完整返工而不是只看到 phase 往返

#### Scenario: Archive 请求重新验证

- **WHEN** Archive 在副作用前发现 Verify 输入陈旧并返回 Verify
- **THEN** 遥测记录 reverify 分类、epoch 变化与新的 Evidence attempt；若副作用已经开始则记录 reconcile 而不是虚假的 Archive→Verify transition

#### Scenario: 本地提交失败

- **WHEN** Run CAS 或 transition journal 没有持久化某个 Host、工具、Validator、epoch、Build Action 或 phase 成功事实
- **THEN** Telemetry 不得导出对应成功事件或完成 Span，即使 Host 在进程内曾返回成功
