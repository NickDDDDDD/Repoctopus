# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: 持久事实只保存执行上下文身份

Repoctopus MUST 在 Run、ActionIntent、Receipt、日志和遥测中只持久化执行包 schema、各层 source/digest、整体 digest、所属 runId、Work attempt 和 checkEpoch；Skill 正文、Provider instructions、Prompt、绝对路径和不受控 change 输入不得写入这些共享事实。

#### Scenario: 进程在交付执行包后退出

- **WHEN** claim 已保存而宿主在提交 Outcome 前退出
- **THEN** 恢复方使用同一 runId、attempt 和 epoch 重新解析并核对完整上下文，内容一致才重新交付原 attempt，不从日志或 Run 文件恢复正文

#### Scenario: Skill 正文在恢复前漂移

- **WHEN** 重新解析的任一层 digest 与已持久化执行包 identity 不同
- **THEN** Runtime 阻断当前 Work、记录结构化差异并使同一 Run 进入 `migration_required` 或声明的兼容恢复，不把新正文注入旧 claim且不创建新 generation

#### Scenario: Work 结果跨越阶段边界

- **WHEN** Host Outcome 或 Validator 结果绑定的 checkEpoch 不再等于当前 Run epoch
- **THEN** Runtime 保留结果供审计但拒绝接受，并从权威 checkpoint 返回当前 continuation

### Requirement: 受管 Work 必须从原执行断点恢复

Repoctopus MUST 把当前 Work attempt、checkEpoch、claim、执行包、Host invocation、Outcome、Validator、Human Decision 和 lifecycle transition 的有界 identity 纳入同一个权威 Change Run aggregate/checkpoint，并通过 Run CAS 与可恢复 journal 提交每个执行边界；ActionStore 或其他投影不得拥有 attempt、claim、完成状态或 continuation。进程、Agent 或 Runner 中断后必须从原 Run 边界产生 `execute`、`ask`、`wait`、`reconcile` 或 `done` continuation，不得创建替代 generation，也不得仅凭 phase、旁路文件存在或会话记忆重新开始。

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

## ADDED Requirements

### Requirement: Host 只能报告发现而不能选择阶段

Repoctopus MUST 让 Host Outcome 只表达当前 Work 的结果、产物、工具事实和 definition 允许的有界 finding classification；Outcome schema MUST NOT 接受 `targetPhase`、任意 continuation 或伪造 Human Decision。Runtime MUST 在验证 Outcome 后根据当前 phase、checkpoint、retry policy、批准和副作用边界选择下一 Work、Human Decision、wait、reconcile、transition 或 done。

#### Scenario: Host 报告设计假设无效

- **WHEN** Build Host 返回绑定当前 Work 的 `design_assumption_invalid` 发现
- **THEN** Runtime 建立稳定 Human Decision并保持当前状态，只有可信批准修订后才能使旧依据失效并回到 Design；Host 不能直接完成转换

#### Scenario: Host 指定目标 phase

- **WHEN** Host Outcome 或调用方额外字段尝试指定 Design、Build、Verify、Archive 或 completed
- **THEN** Runtime 拒绝该 Outcome 或忽略未声明字段并记录协议错误，不据此修改 lifecycle

#### Scenario: 普通 Build 失败重复发生

- **WHEN** 同一逻辑 Build Work 连续返回可重试 implementation failure
- **THEN** Runtime 仅按有界 retry policy 创建后续 attempt；达到上限时进入稳定 blocked/Human Decision，而不是无限重派或创建另一 Run

### Requirement: 验证失败必须创建受管 Repair Work

当 Verify 证明实现行为不满足当前批准规格时，Repoctopus MUST 在同一 Run 记录失败 Evidence、重新打开有依据的 OpenSpec task revision，并由 Runtime 创建 Build Repair Work。Repair Work MUST 使用 Build 的固定 Skill 组合并完整经过 intent、claim、packet、Host invocation、Outcome、Validator 和 completion claim；文件变化、Git commit、checkbox、fingerprint 或 phase 变化本身不得构成修复完成。

#### Scenario: Verify 失败后重新进入 Build

- **WHEN** Runtime 接受 implementation failure 并从 Verify 转换到 Build
- **THEN** projection 返回可领取的 Repair Work及其受影响 task revision，不返回只有标签而不可执行的 `verify.repair` 状态

#### Scenario: Agent 在受管 Repair Work 外修改代码

- **WHEN** 仓库 fingerprint 已改变但当前 Repair Work 没有可验证 Outcome、Validator 和 completion claim
- **THEN** Runtime 保持 Build pending/blocked并报告旁路修改，不允许再次进入 Verify

#### Scenario: 无法证明最小受影响 Task 集合

- **WHEN** Verify finding 没有可核对的 requirement/task links，Runtime 无法安全选择最小重开集合
- **THEN** Runtime 建立 Human Decision或采用 definition 声明的保守集合并记录依据，不静默把所有已完成 Task 保持 closed
