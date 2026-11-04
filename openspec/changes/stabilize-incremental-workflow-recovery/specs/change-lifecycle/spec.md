# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: 失败分类必须决定真实返工路径

Runtime MUST 根据当前权威身份、持久化失败事实、输入依赖和副作用边界计算一个恢复处置；Host、Agent 与调用方不得提交目标 phase 或恢复动作。处置只允许 `revise-design`、`revise-plan`、`continue-build`、`invalidate-evidence`、`retry-infrastructure`、`reconcile-external` 或 `halt`，并在同一 Run 保留历史事实、精确失效下游依赖并递增合法 transition 的 `checkEpoch`。

#### Scenario: Verify 发现实现行为失败

- **WHEN** Verify review 或 Gate 证明实现不满足当前批准规格，但规格、设计和 Task 语义仍有效
- **THEN** Runtime 选择 `revise-plan` 返回 Build，由修订计划产生普通 Execute Work，不返回 Design或创建特殊 Repair lifecycle

#### Scenario: Verify 依赖暂时不可用

- **WHEN** 失败来自 Evidence Provider、命令环境或其他基础设施，且没有事实证明实现、计划或批准设计错误
- **THEN** Runtime 选择 `retry-infrastructure` 并保持 Verify blocked/retry，不重开 Build Task、不使 Design approval 失效

#### Scenario: Archive 前发现验证输入陈旧

- **WHEN** Archive 尚未开始规格关闭或外部 publication 副作用，且当前 Verify identity 仅因已声明 Evidence 输入变化而失效
- **THEN** Runtime 选择 `invalidate-evidence` 返回 Verify 并只重采受影响 Evidence；若副作用已经开始则选择 `reconcile-external` 并保持 Archive

#### Scenario: 批准规划语义已经改变

- **WHEN** Runtime 观察到当前 Proposal、Delta Specs、Design、Tasks 或 Change metadata 的规范化语义身份不再等于可信批准身份
- **THEN** Runtime 选择 `revise-design`，原子建立新的 Design Work并精确失效依赖旧规划的事实

#### Scenario: 当前 Build Work 输入仍有效

- **WHEN** Build Work 失败、中断或被校验拒绝，但其规划、计划、Binding、Work input 与副作用边界仍可安全续行
- **THEN** Runtime 选择 `continue-build` 并恢复同一 Work 的合法下一 attempt，不重建 Design、Build Strategy或 Build Plan

## ADDED Requirements

### Requirement: 恢复分类只选择最高受影响权威

Runtime MUST 按“规格与设计语义、Build Plan、实现执行、Evidence”的固定优先级比较当前身份与已接受 checkpoint，并为一次观察选择唯一恢复处置。高层身份变化 MUST 使其依赖的低层事实精确失效；同一变化不得先触发低层重验，再以相同根因触发更高层回退。

#### Scenario: 规划与 Evidence 同时变化

- **WHEN** 一次观察同时发现 planning semantic digest 与 Verification Input 不匹配
- **THEN** Runtime 只选择 `revise-design`，并把 Evidence 失效作为该处置的下游结果，不先返回 Verify再返回 Design

#### Scenario: Plan 变化但批准语义相同

- **WHEN** Work Package 边界、依赖、测试切面或检查命令需要调整，但 OpenSpec 规划语义和 Design approval仍有效
- **THEN** Runtime 选择 `revise-plan` 并保持 Build phase，不建立新的 Design Human Decision

#### Scenario: 只有 Evidence 输入变化

- **WHEN** 规划、Plan 和实现 checkpoint均有效，只有一个检查声明的输入面发生变化
- **THEN** Runtime 选择 `invalidate-evidence` 并只退役依赖该输入面的 Receipt、Bundle、Gate或 Check Evidence

### Requirement: 恢复重放必须收敛到同一 checkpoint

每个恢复处置 MUST 绑定原 observation、权威身份、受影响依赖集合、from revision 与 `checkEpoch`。重复 pull、进程重启或相同 observation 重放 MUST 返回既有恢复 checkpoint或 revision conflict，不得重复创建 Work、Wait、Plan revision、失效记录或人工批准。

#### Scenario: 同一 Plan finding 被重复提交

- **WHEN** 两个 Runner 对相同 Run revision、Plan identity和 finding identity提交恢复观察
- **THEN** 只有一个 `revise-plan` checkpoint被接受，另一个返回既有 checkpoint或明确冲突

#### Scenario: Archive 恢复后进程退出

- **WHEN** Runtime 已为输入漂移建立 `invalidate-evidence` checkpoint，但响应返回前进程退出
- **THEN** 下一次 pull 从该 checkpoint继续，不重新建立 Archive、Verify或 Design 回退链
