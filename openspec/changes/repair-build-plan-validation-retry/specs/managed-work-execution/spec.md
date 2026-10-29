# managed-work-execution Specification Delta

## ADDED Requirements

### Requirement: 无效 Build Plan candidate 必须生成新的 Plan Work

当前 `build.plan` Host Outcome 成功返回但 candidate 未通过结构、Task/acceptance 覆盖、包依赖、仓库/write scope 或 Plan Validator 时，Runtime MUST 保留原 Work、claim、invocation 和 Outcome 为不可变审计事实，记录有界拒绝原因并在同一 Plan Action 创建递增 `checkEpoch` 与 action attempt 的全新 `build.plan` Work。新 Work MUST 继续绑定已批准 Build Configuration、当前 planning/Task set、仓库拓扑和固定 Skill；不得覆盖旧 Outcome、重新开放旧 claim、跳过 Validator、手改 Run Store 或推进到 Execute。

#### Scenario: 候选遗漏已批准 Task

- **WHEN** Host 为当前 Plan Work 返回结构化 candidate，但至少一个 OpenSpec Task 或 acceptance criterion 未被任何 Work Package 覆盖
- **THEN** Runtime 拒绝候选、保留旧 Outcome并创建带有 `candidate-invalid` 原因的新 Plan Work，只有新 invocation 可以提交修正版候选

#### Scenario: Plan Validator 拒绝候选

- **WHEN** candidate 可规范化为 Build Plan，但当前 Validator 证明配置、Task set、仓库边界、依赖或 acceptance 输入不满足
- **THEN** Runtime 记录 `validator-rejected` 并创建绑定同一冻结配置的新 Plan Work，不接受该 revision或创建 Execute Work

#### Scenario: 拒绝后进程重启

- **WHEN** Runtime 已持久化 candidate rejection transition 与新 Plan Work，随后进程退出并重新启动
- **THEN** 恢复只暴露新的 Work identity、attempt 和 checkEpoch；旧 invocation 的重放或不同 Outcome继续被拒绝

#### Scenario: 未知 Runtime 错误

- **WHEN** Plan 处理遭遇 Store、Provider、Skill、CAS 或未分类程序错误，而不是可识别的 candidate/Validator 拒绝
- **THEN** Runtime fail closed 并保留可诊断错误，不把未知故障伪装成 Agent 可修正的 Plan retry
