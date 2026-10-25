# implementation-evidence Delta Specification

## ADDED Requirements

### Requirement: Evidence Profile 编译完整 Acceptance Coverage Plan

用于 Change Verify 的 Evidence Profile MUST 显式声明 required 节点覆盖的 Acceptance selector，并在执行任何节点前解析为绑定完整 Acceptance Set、Profile plan、仓库和配置摘要的不可变 coverage plan；缺失、未知、重复或仅由 optional 节点覆盖的 Acceptance 必须阻断执行。

#### Scenario: Profile 没有覆盖 UI Acceptance

- **WHEN** Verification Input 包含 UI 行为 Acceptance，但 Profile 只有未声明覆盖该 Acceptance 的 typecheck 节点
- **THEN** Runtime 在运行 typecheck 前拒绝计划并报告未覆盖的 Acceptance identity

#### Scenario: 共享 Profile 显式覆盖全部 Acceptance

- **WHEN** required 节点使用 `*` selector 且 Profile、配置和 Acceptance Set 被固定到 Verification Input
- **THEN** Runtime 把该声明解析为每条 Acceptance 到节点的显式映射，并在任一输入变化时使计划失效

### Requirement: Evidence Bundle 保存完整 Acceptance Trace

Change Verify 的 Evidence Bundle MUST 为不可变 Verification Input 中每条 Acceptance 保存恰好一个有序 Trace entry，并只在 entry 引用 coverage plan 允许的全部 required 节点在当前输入下产生的 `verified` 且通过的 Receipt 时标记 passed；未知、重复、缺失、observed、superseded 或失败证据必须 fail-closed。

#### Scenario: 所有命令成功但一条 Acceptance 没有映射

- **WHEN** Profile 节点全部通过但 Bundle 无法为某条 Acceptance 找到允许的 Receipt
- **THEN** Bundle 结果为 `incomplete` 且 Gate blocked，不得用 Profile 总体成功替代 Trace

#### Scenario: Receipt 覆盖完整且当前有效

- **WHEN** 每条 Acceptance 都引用 coverage plan 允许的 required verified Receipt，Receipt 输入指纹与 Verification Input 一致且没有阻断 Finding
- **THEN** Bundle 可以产生 passed Acceptance Trace 并参与 Change Verify Gate

### Requirement: Acceptance Gate 绑定 Trace 与 Verification Input

EvidenceCoordinator MUST 只为 Trace 的 Acceptance Set Hash、Verification Input digest、Profile plan、composition 和输入指纹均与当前 Verify Work 相同的 Bundle 投影 satisfied Gate；独立 Evidence Bundle、旧 schema Bundle 或普通成功摘要不得满足 Change Verify。

#### Scenario: 独立运行完整 Profile

- **WHEN** 用户脱离 Change Run 执行相同 Evidence Profile并得到 passed Bundle
- **THEN** Bundle 保持可审计但因没有当前 Acceptance context 与 Work identity而不能推进 Change Run

#### Scenario: Acceptance 在采集后变化

- **WHEN** Evidence 采集完成后 Tasks Acceptance 或 Requirement mapping 改变
- **THEN** Gate 重新核对发现 Acceptance Set Hash 漂移并拒绝推进

### Requirement: Retention 保留 Acceptance Trace 引用闭包

Evidence retention MUST 把已接受 Bundle 的 Acceptance Trace、所有 entry 引用 Receipt 及其 Artifact 视为同一引用闭包；清理、恢复和验证报告不得产生与 Bundle 不同的 Acceptance 结论。

#### Scenario: 清理已接受 Verify Bundle

- **WHEN** 某个 Receipt 仍被已接受 Bundle 的 Acceptance Trace 引用
- **THEN** 清理保留 Receipt 与 Artifact，即使该节点已超过普通时间期限
