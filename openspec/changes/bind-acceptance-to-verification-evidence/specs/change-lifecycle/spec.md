# change-lifecycle Delta Specification

## ADDED Requirements

### Requirement: Completion Claim 与验证事实分离

Change lifecycle MUST 区分 pending Task、Runtime Work Outcome 形成的 completion claim 与从官方 Tasks 导入的 completion claim；全部 claim 只允许结束或跳过 Build 调度，不得作为 Acceptance Evidence、Verify Gate 或 Archive 资格。

#### Scenario: 已实现 Change 首次进入 Runtime

- **WHEN** 获批 Tasks 全部已勾选但当前 Run 没有对应 Work Outcome
- **THEN** Runtime 记录 imported claims、避免重复派发 Build，并进入仍需完整 Acceptance Evidence 的 Verify

#### Scenario: Agent 只勾选全部 Tasks

- **WHEN** Agent 更新 checkbox 但没有产生满足 Acceptance coverage plan 的 Receipt
- **THEN** Runtime 不得越过 Verify 或进入 Archive

### Requirement: Verify 到 Archive 受 Acceptance Gate 保护

Change lifecycle MUST 只接受绑定当前 Verification Input、完整 Acceptance Set 和 coverage plan 的 satisfied Evidence Gate；Task revision 全部完成、Profile 节点总体成功或 Bundle identity 单独匹配均不足以触发 `Verify → Archive`。

#### Scenario: 弱 Profile 通过

- **WHEN** typecheck 与 architecture 节点通过但未覆盖当前 Change 的全部 Acceptance
- **THEN** Run 保持 Verify 并记录 incomplete Evidence，不创建 Archive Work

#### Scenario: Acceptance Trace 完整

- **WHEN** 当前 Bundle 的每条 Acceptance 都由允许的当前 Receipt 证明且 Gate 的 Run、Work、状态版本、composition 和指纹均匹配
- **THEN** Runtime 接受 Gate 并进入 Archive

### Requirement: 终结 Run 不公开执行型下一动作

Runtime、CLI、Dashboard 和 Telemetry MUST 在投影下一动作前先处理 Run 终态；`completed`、`failed` 和 `migration_required` 不得公开 `run next`、`archive.prepare` 或任何会产生副作用的执行建议。

#### Scenario: Archive 已完成

- **WHEN** Run 已接受 Publication Receipt 并处于 `phase=archive,status=completed`
- **THEN** 所有公共投影的 next actions 为空，历史 phase 仅作为终态上下文展示

#### Scenario: Run 正在等待可信决定

- **WHEN** Run 为非终态 waiting 且具有 Human Decision 条件
- **THEN** 投影只公开对应决定动作，不显示普通执行或重复 Archive 动作

