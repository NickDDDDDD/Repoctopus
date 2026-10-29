# managed-work-execution Specification Delta

## ADDED Requirements

### Requirement: Intent 修订必须同步退役不匹配的 execution checkpoint

当 Workspace intent 修订 transition 替换或清除 lifecycle current Work 时，Runtime MUST 通过统一的 current execution 判定，在同一次 Run CAS 中比较新 current Work 与 `workExecution` 的 `workId/checkEpoch`；不完全匹配的 checkpoint MUST 从当前 Run state 退役，并在同一 transition event 记录 retirement fact，历史 claim、Host invocation、Outcome、Receipt 与 Validator facts MUST 保留在 trajectory。新的 Design Work MUST 可正常 claim，旧 Build Configure Host MUST NOT 被重放或继续投影为当前 continuation。

#### Scenario: Build Configure Outcome 后返回 Open

- **WHEN** Build Configure Host 已提交成功 Outcome但 binding 证明旧 intent 不可用
- **THEN** Build→Open transition 同一 CAS 清除当前 execution checkpoint并记录 retirement，Open wait 不返回旧 validator-pending

#### Scenario: 新 Design Work 建立

- **WHEN** 用户批准新的可绑定 intent并由 Runtime 创建 `specification.plan` Work
- **THEN** Run 只包含新 Work/epoch 的当前身份，旧 Build Configure execution 仅作为 trajectory 历史可读

#### Scenario: Transition 未替换 current Work

- **WHEN** lifecycle transition 后 current Work 的 `workId/checkEpoch` 仍与 execution checkpoint 完全一致
- **THEN** Runtime 保留 checkpoint且不记录虚假的 retirement
