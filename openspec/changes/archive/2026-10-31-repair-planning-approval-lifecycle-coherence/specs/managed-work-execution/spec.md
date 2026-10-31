# managed-work-execution Specification Delta

## ADDED Requirements

### Requirement: 只有匹配当前 lifecycle Work 的 execution checkpoint 才可续行

Runtime MUST 仅把 `workId` 与 `checkEpoch` 同时匹配 Change lifecycle current Work 的 `workExecution` 视为当前 execution checkpoint。Lifecycle transition 替换或清除 current Work 时，Runtime MUST 在同一次 Run CAS 中退役不匹配的 checkpoint，并把历史 claim、submission、Outcome、Receipt 与 Validator 事实保留在 trajectory。读取遗留 torn state 时，recovery MUST 以 lifecycle current Work 为准，MUST NOT 加载旧 intent、返回旧 continuation、重放旧 Host 或让 status 查询修改业务状态；下一次受保护 `run next/resume` MUST 在新 claim 前通过幂等 CAS 退役该 checkpoint。

#### Scenario: Build 回到 Design

- **WHEN** Build planning drift transition 选择新的 Design Work，而 Run state 仍含旧 Build checkpoint
- **THEN** transition commit 同时移除旧 checkpoint，recovery 返回新 Design Work 的未领取执行入口，不返回旧 Build `validator-pending`

#### Scenario: Lifecycle 清除 current Work 等待 transition

- **WHEN** current Work 已被合法清除且旧 execution checkpoint 尚存在于遗留持久状态
- **THEN** recovery 返回 `transition-pending` 并把旧 checkpoint 标记为 superseded diagnostic，不把旧 Work 恢复为当前 Work

#### Scenario: Runtime pull 收敛遗留 torn checkpoint

- **WHEN** status 已只读识别出旧 checkpoint 与 lifecycle current Work 或 epoch 不匹配，随后 Runner 调用 `run next` 或 `resume`
- **THEN** Runtime 在选择下一 Action 或允许 claim 之前用一次幂等 CAS 移除旧 checkpoint并记录 `recovery.reconciled`；并发重复 pull 不产生第二次退役事实

#### Scenario: 审计历史仍可读取

- **WHEN** execution checkpoint 因 lifecycle transition 被退役
- **THEN** trajectory 仍保留原 claim、Host submission、Outcome、Receipt、Validator 和退役关联，Dashboard 可以解释历史但不能将其投影为当前执行
