# managed-work-execution Specification Delta

## ADDED Requirements

### Requirement: 只有匹配当前 lifecycle Work 的 execution checkpoint 才可续行

Runtime MUST 仅把 `workId` 与 `checkEpoch` 同时匹配 Change lifecycle current Work 的 `workExecution` 视为当前 execution checkpoint。Lifecycle transition 替换或清除 current Work 时，Runtime MUST 在同一次 Run CAS 中退役不匹配的 checkpoint，并把历史 claim、submission、Outcome、Receipt 与 Validator 事实保留在 trajectory。读取遗留 torn state 时，recovery MUST 以 lifecycle current Work 为准，MUST NOT 加载旧 intent、返回旧 continuation、重放旧 Host 或让 status 查询修改业务状态。

#### Scenario: Build 回到 Design

- **WHEN** Build planning drift transition 选择新的 Design Work，而 Run state 仍含旧 Build checkpoint
- **THEN** transition commit 同时移除旧 checkpoint，recovery 返回新 Design Work 的未领取执行入口，不返回旧 Build `validator-pending`

#### Scenario: Lifecycle 清除 current Work 等待 transition

- **WHEN** current Work 已被合法清除且旧 execution checkpoint 尚存在于遗留持久状态
- **THEN** recovery 返回 `transition-pending` 并把旧 checkpoint 标记为 superseded diagnostic，不把旧 Work 恢复为当前 Work

#### Scenario: 审计历史仍可读取

- **WHEN** execution checkpoint 因 lifecycle transition 被退役
- **THEN** trajectory 仍保留原 claim、Host submission、Outcome、Receipt、Validator 和退役关联，Dashboard 可以解释历史但不能将其投影为当前执行
