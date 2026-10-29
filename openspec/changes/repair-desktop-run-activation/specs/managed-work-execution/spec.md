# Spec Delta

## MODIFIED Requirements

### Requirement: 受管 Work 必须从原执行断点恢复

Repoctopus MUST 把当前 Work attempt、checkEpoch、claim、执行包、Host invocation、Outcome、Validator、Human Decision 和 lifecycle transition 的有界 identity 纳入同一个权威 Change Run aggregate/checkpoint，并通过 Run CAS 与可恢复 journal 提交每个执行边界；ActionStore 或其他投影不得拥有 attempt、claim、完成状态或 continuation。进程、Agent 或 Runner 中断后必须从原 Run 边界产生 `execute`、`ask`、`wait`、`reconcile` 或 `done` continuation，不得创建替代 generation，也不得仅凭 phase、旁路文件存在或会话记忆重新开始。已经持久化的外部 Host Outcome MUST 以同一 invocation 的稳定内容幂等恢复：除 Runtime 生成的完成时间外内容相同的重复提交复用原 Outcome，任何稳定字段漂移都必须 fail closed。

#### Scenario: Action 内容写入后 Run claim 前中断

- **WHEN** 不可变 ActionIntent 已写入内容库，但绑定其 identity 的 Run CAS 尚未成功
- **THEN** 该内容是可忽略或可清理的孤立记录，不构成 claim，新 Runner 只按权威 Run 尝试领取且不得把 ActionStore latest 当作当前 attempt

#### Scenario: Run claim 成功后响应丢失

- **WHEN** Run checkpoint 已绑定 claim、packet、attempt 和 epoch identity，但领取响应在返回宿主前丢失
- **THEN** 新 Runner 从同一 Run 恢复原 attempt，并在摘要与 epoch 一致时重新交付同一 packet，不创建第二个 claim

#### Scenario: Run 引用的 Action 内容损坏

- **WHEN** 权威 Run 引用的 ActionIntent、Outcome 或 Receipt 内容缺失、损坏或摘要不匹配
- **THEN** Runtime fail closed 并返回 reconcile/repair 诊断，不从其他 Action 文件、最新时间或 checkbox 猜测执行结果

#### Scenario: Host 调用后连接中断

- **WHEN** checkpoint 已记录原 Host invocation，但 Runtime 未取得可验证 Outcome
- **THEN** 新 Runner 保留同一 Work attempt、epoch 和 scope，返回 reconcile 或等待原 Host，不自动再次调用 Agent或重发外部副作用

#### Scenario: Outcome 后 Validator 前中断

- **WHEN** 原 Host Outcome 已持久化且 identity 匹配，但 Validator 尚未接受
- **THEN** 恢复从原 Outcome 的 Validator 继续，不重新交付执行包或调用 Agent

#### Scenario: 相同外部 Host Outcome 重复提交

- **WHEN** 同一 invocation 的外部 Outcome 已持久化，恢复进程再次提交相同 status、summary、consumed Skill layers、result、findings 与 delegation receipts，但产生了新的提交时间
- **THEN** Runtime 复用原 Outcome 与原 `completedAt`，不再次记录 Host completion，并继续原 fact、Action Outcome 与 Validator 边界

#### Scenario: 重放的外部 Host Outcome 内容漂移

- **WHEN** 同一 invocation 的重复 Outcome 在 status、summary、consumed Skill layers、result、findings 或 delegation receipts 任一稳定字段上不同
- **THEN** Runtime 拒绝该提交并保留原持久 Outcome，不重新调用 Host、不覆盖 checkpoint 且不推进 Work

#### Scenario: Design Validator 的外部依赖暂时失败后重试

- **WHEN** Design Host Outcome 已持久化，但 Provider 或远端检查暂时失败而使 Design 进入 blocked
- **THEN** Runtime 保留同一 `currentWork`、attempt、epoch 与权威 claim，后续 `run next` 从原 Outcome 重试 Validator；只有 Validator accepted 后才能清除该 Work 或进入 Human Decision、Build 与后续 phase

#### Scenario: Validator 后 transition 写入中断

- **WHEN** Validator accepted 已持久化而 lifecycle transition 尚未完整提交
- **THEN** Runtime 通过 recoverable journal 幂等完成原 transition与唯一一次 epoch 递增，并且 Trajectory 只出现一次对应推进事实

#### Scenario: Verify Validator 后 Evidence gate 投影前中断

- **WHEN** Verify Host review Outcome 与 Validator accepted 已持久化，Evidence attempt 已完成或可恢复，但 gate 尚未投影到 Change Run
- **THEN** 新 Runner 复用同一受验证 review、Work attempt、epoch 与 Evidence attempt 完成 gate 投影，不重新调用 Agent、不重复写 Validator 事实，也不把 `validated` 误判为缺少 review Outcome

#### Scenario: 等待用户决定时更换 Agent

- **WHEN** Change Run 在 Human Decision Wait 中断或由新 Agent接管
- **THEN** 恢复展示相同 proposal hash 与 choices，不重新生成提案、不丢失批准边界，也不代替用户选择

#### Scenario: 恢复时多仓或执行组合漂移

- **WHEN** repository commit/path binding、definition、composition、Skill、Specification Provider 或 packet digest 与 checkpoint 不一致
- **THEN** Runtime 在同一 Run 返回结构化 reconcile 或 `migration_required` 状态并保留原执行事实，不把漂移解释为未执行后重跑
