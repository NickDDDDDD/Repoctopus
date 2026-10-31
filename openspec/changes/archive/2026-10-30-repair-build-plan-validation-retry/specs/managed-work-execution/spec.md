# managed-work-execution Specification Delta

## ADDED Requirements

### Requirement: 被校验拒绝的 Host submission 必须保持当前 Work 可纠正

Runtime MUST 将 Host submission 与 accepted Action Outcome 建模为不同事实。当前 Work 的结构、领域或 Validator 校验通过前，submission MUST NOT 绑定为终态 Action Outcome或推进 lifecycle。对于可纠正拒绝，Runtime MUST 保留相同 `workId`、claim、attempt、`checkEpoch`、Host invocation、packet digest 与冻结输入，追加有界且不可变的 rejected submission，并允许原 invocation 使用新的 submission identity 提交修正版。Runtime MUST NOT 为首次候选拒绝创建新 Work、覆盖旧提交、重新执行外部副作用、跳过 Validator 或要求手改 Run Store。

#### Scenario: Build Plan candidate 遗漏已批准 Task

- **WHEN** Host 为当前 `build.plan` Work 提交结构化 candidate，但至少一个 OpenSpec Task 或 acceptance criterion 未被 Work Package 覆盖
- **THEN** Runtime 记录 `outcome-rejected`，保持同一 Work/claim/attempt/checkEpoch/invocation 可纠正，不绑定终态 Outcome，也不创建 Execute 或新的 Plan Work

#### Scenario: 使用新 submission identity 提交修正版

- **WHEN** 原 invocation 在一次 candidate 被拒绝后，使用新的 submission identity 提交覆盖完整且通过 Validator 的候选
- **THEN** Runtime 接受该 submission，原子绑定唯一终态 Action Outcome与 validator fact，并按 lifecycle 规则进入 Plan Evidence或 Execute

#### Scenario: submission identity 重放与冲突

- **WHEN** Host 重复提交相同 submission identity
- **THEN** 相同 payload digest 的提交幂等返回原结果，不同 payload digest 的提交返回 conflict，且两者都不覆盖已记录事实

#### Scenario: 拒绝后进程重启

- **WHEN** Runtime 已持久化 rejected submission 后退出并重新启动
- **THEN** 恢复仍暴露原 Work、claim、attempt、checkEpoch 与 invocation，并允许新的 submission identity 纠正，不重新调用 Host或创建新 Work

#### Scenario: 未知 Outcome 处理错误

- **WHEN** submission 处理遭遇 Store、Provider、Skill、CAS 或未分类程序错误，而不是确定性的候选或 Validator 拒绝
- **THEN** Runtime fail closed、记录 `outcome-processing-error` 诊断并停止自动推进，不把故障伪装成 Agent 可纠正候选

#### Scenario: 恢复预修复卡住的 Plan Run

- **WHEN** Runtime 能证明旧 checkpoint 的 Plan Outcome 已被提前终态化、lifecycle 尚未接受 Plan、候选可重现确定性拒绝且所有冻结身份兼容
- **THEN** Runtime 通过幂等兼容恢复保留旧 Outcome 为 rejected submission并恢复同一 Work的纠正入口；若任一条件无法证明则进入 `migration_required`
