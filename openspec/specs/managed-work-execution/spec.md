# managed-work-execution Specification

## Purpose

定义 Repoctopus 如何把 lifecycle Work 的完整固定指导安全交付给受管 Agent Host，并以可恢复 claim、受控能力和真实 Outcome 证明 Agent 在允许副作用前已经消费正确执行上下文。

## Requirements

### Requirement: Claim 返回完整且不可变的执行包

Repoctopus MUST 在成功持久化当前 Work claim 后向获授权宿主返回版本化 `WorkExecutionPacket`，包含 ActionIntent、完整有序上下文层、各层 identity、整体 digest、当前 Work 和允许能力；执行包内容不得在 claim 前暴露，也不得由调用方增删、替换或重排。

#### Scenario: 宿主领取 Build Work

- **WHEN** 受管宿主以当前 Run、Work、attempt、Runner identity 和兼容能力领取 Build Work
- **THEN** Runtime 先持久化 claim，再返回包含 action Skill 正文、Specification 指令、augmentations、Method Profile 和 change 输入的冻结执行包

#### Scenario: 调用方请求替换 Skill

- **WHEN** 调用方在领取参数中请求替换 action Skill、删除 TDD augmentation 或改变上下文顺序
- **THEN** Runtime 拒绝请求并保留未领取 Work，不生成降级执行包

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

### Requirement: Work Execution Host 是唯一受管 Agent 调用端口

Repoctopus MUST 通过版本化 Host Contributor 选择一个与 Work 能力兼容的执行端口；受管执行服务在调用 Host 前核对 claim、composition、完整上下文、能力、授权和写入范围，Host 只能收到冻结 Action、Work 和执行包。

#### Scenario: Host 执行正常 Work

- **WHEN** 当前 Host 支持 Work 所需能力且 preflight 全部通过
- **THEN** 受管执行服务只调用一次该 Host，并把 Host 返回的真实 succeeded 或 failed Outcome 交给现有 Action/Validator 链路

#### Scenario: 没有兼容 Host

- **WHEN** 当前 composition 没有支持 action Skill 或所需能力的 Host
- **THEN** Work 保持未执行并返回可定位诊断，不退化为 manual success 或直接推进阶段

#### Scenario: 两个 Host 声称同一默认执行范围

- **WHEN** composition 对同一 Work 产生多个同优先级且无法唯一选择的 Host
- **THEN** App Boot 或执行前检查 fail closed，并要求配置唯一 Host

### Requirement: 受管工具调用绑定活动执行会话

Repoctopus MUST 为 Host 调用建立短生命周期执行会话，所有受保护的 Specification、repository、process、Git 和平台操作都必须携带当前 claim identity，并由应用边界按 Work capability、side-effect class 与 write scope 核对；会话终结后授权立即失效。

#### Scenario: 首次写入发生在上下文交付之后

- **WHEN** Agent 请求创建测试、修改实现或写 Specification artifact
- **THEN** 应用边界只在对应执行包已交付、Host 调用处于活动状态且目标在当前 Work scope 内时允许操作

#### Scenario: Agent 使用普通外部进程绕过应用边界

- **WHEN** 未受管进程直接修改仓库文件且没有活动执行会话
- **THEN** 该修改只能在后续核对中形成 drift 或 blocker，不能获得受管 Receipt、完成 Task 或推进 phase

### Requirement: Outcome 必须来自原 Host 调用

Repoctopus MUST 让受管 Outcome 绑定执行包 digest、Host identity、执行会话、claim token、attempt 与 input digest；普通 CLI 文本、Agent 自述或另一 Host 的结果不得替代原调用结果。

#### Scenario: Host 返回真实失败

- **WHEN** Host 在当前执行会话中返回 failed Outcome 和有界摘要
- **THEN** Runtime 保存失败尝试但不完成 Work，并按 definition 决定诊断 retry、阻塞或回退

#### Scenario: 伪造成功结果

- **WHEN** 调用方提交缺少执行会话 identity、执行包 digest 不匹配或来自另一 Host 的 succeeded Outcome
- **THEN** Runtime 拒绝结果并保持原 Work 状态

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

### Requirement: Agent coordination checkpoint 不得成为完成权威

Repoctopus MAY 保存用于上下文压缩、Agent handoff 或子任务协调的有界 progress checkpoint，但它 MUST 与 Engine checkpoint、OpenSpec 工件和 completion evidence 分离；其存在、缺失或 checkbox 状态不得授权写入、形成 Receipt、完成 Task 或推进 phase。

#### Scenario: Coordination checkpoint 缺失

- **WHEN** 新 Agent恢复 Build 而 coordination checkpoint 不存在或已 stale
- **THEN** Agent按权威 Change Run、其绑定的不可变 Action 内容、实际文件和 Git事实核对进度，不能因为协调记录缺失而假定实现未发生并重复执行

### Requirement: 黑盒验收必须观察真实内容消费

Repoctopus MUST 使用生产 composition 和公共应用协议运行捕获 Host，断言 Host 收到每个阶段的完整正文、固定顺序和当前输入，并观察受保护副作用发生在 claim/context-delivered 之后；只断言 Skill 名称、layer source、digest、Run projection 或 mock 领域函数不得满足该验收。

#### Scenario: 捕获 Host 验收 Build

- **WHEN** 黑盒测试执行一个 fresh Change 的首个 Build Task
- **THEN** 捕获记录包含 action Skill 与 TDD/代码边界正文，事件顺序为 claim persisted、context delivered、host invoked、first protected write、Outcome accepted、Validator accepted

#### Scenario: 上下文正文未送达

- **WHEN** 生产协议只返回 layer identity 或 Host 没有读取完整执行包
- **THEN** 黑盒验收失败，即使 Task、Verify 和 Archive 最终状态均显示成功

#### Scenario: 黑盒只读取最终统一投影

- **WHEN** 验收只断言最终 `ChangeRunProjection`，或测试直接 import coordinator/reducer 来构造 Work、Outcome 或 completion observation
- **THEN** 该测试不得计入生产执行验收；合格验收必须通过独立进程公共协议，并交叉核对每一步 continuation/phase、追加式 trajectory identity 与实际受保护文件结果

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

### Requirement: 验证失败必须修订 Build Plan 并创建普通 Work

当 Verify 证明实现行为不满足当前批准规格时，Repoctopus MUST 在同一 Run 记录失败 Evidence、递增 `checkEpoch` 并返回 Build Plan revision。修订后的 Plan MUST 通过普通 Build Execute Work 和 Build Check 处理缺陷，保留仍有效的 Task completion 与 Work Evidence，只失效受影响输入；文件变化、Git commit、checkbox、fingerprint、phase 变化或特殊 repair 标签本身不得构成返工完成。

#### Scenario: Verify 失败后重新进入 Build

- **WHEN** Runtime 接受 implementation failure 并从 Verify 转换到 Build
- **THEN** projection 返回待修订的 Build Plan、失败 finding 和受影响 Evidence；Plan 接受后才返回普通可领取 Work，不创建 `verify.repair` 或 `implementation.repair`

#### Scenario: Agent 在受管 Repair Work 外修改代码

- **WHEN** 仓库 fingerprint 已改变但当前计划没有覆盖该变化的可验证 Outcome、Validator 和 completion claim
- **THEN** Runtime 保持 Build pending/blocked并报告旁路修改，不允许 Build Check 或再次进入 Verify

#### Scenario: 无法证明最小受影响 Task 集合

- **WHEN** Verify finding 没有可核对的 requirement、Task 或 Work Package links，Runtime 无法安全选择最小计划失效集合
- **THEN** Runtime 建立 Human Decision或采用 definition 声明的保守 plan invalidation 并记录依据，不静默重开全部 Task或保留不可信 completion

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 根据当前 Run、仓库拓扑、OpenSpec Tasks、隔离能力与 Host capabilities 生成 Build Configuration proposal；可信用户批准后，配置 MUST 以稳定 identity、schema version、semantic digest 和 approval Evidence 固定。Agent 与 Host 只能执行该配置，不得增删策略字段或以实际执行行为反向改写配置。

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成并行 Work Package，且 Host 声明兼容的 subagent coordination capability
- **THEN** Runtime 可以提出 `subagent-driven-development`，并在批准后把该模式绑定全部 Build Action

#### Scenario: Host 不支持批准配置

- **WHEN** 恢复时 Host 不再满足冻结 execution mode 或 isolation 的 capability contract
- **THEN** Runtime 在副作用前进入 blocked 或 `migration_required`，不得降级为 autonomous/current 或切换模式

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner 为当前、分支或 worktree 模式提供受影响仓库的本地 checkout facts
- **THEN** Runtime 以稳定 repository identity、branch、head、worktree identity、Workspace ownership 与本地 binding digest 验证并冻结配置；绝对路径只保存在本地 Run overlay

### Requirement: Runtime BuildPlan 是 OpenSpec Tasks 的执行投影

Build Plan MUST 是 Runtime 管理的版本化执行产物：Runtime 选择 `build.plan` Work并向 Host 交付批准的 Build Configuration、OpenSpec planning digest、稳定 Task IDs、拓扑与 action Skill，Host 只返回受 output contract 约束的结构化 candidate，Runtime 规范化、验证并接受 revision。Plan 把 Task 投影为有依赖、仓库绑定、write scope、acceptance references、validator profile 和预期 Outcome 的 Work Package；它不得包含第二套完成 checkbox、改写 Task 语义或成为 Specification Provider 产物，Task 的 scope、依赖与完成权威仍属于 OpenSpec Tasks。

#### Scenario: Host 提交结构化计划候选

- **WHEN** 当前 `build.plan` Work 的 Host 返回绑定 claim 和 input digest 的 `build-plan-candidate`
- **THEN** Runtime 验证 schema、边界与 Task references 后分配 plan identity/revision；自由 Markdown、路径指针或 Agent 自述成功不能成为已接受计划

#### Scenario: 计划拆分一个跨仓 Task

- **WHEN** 一个批准 Task 的实现需要两个仓库且可安全拆分执行
- **THEN** Build Plan 可以让多个 Work Package 引用同一 Task ID，并显式记录仓库、依赖和合并验收；Task 只在全部 required package completion 被接受后完成

#### Scenario: 计划尝试新增需求

- **WHEN** Build Plan 增加没有 Task/requirement 引用的新行为或改变批准验收
- **THEN** Plan Validator 拒绝计划并要求返回 Design 修订 OpenSpec 工件

#### Scenario: Plan revision 只改变执行顺序

- **WHEN** Verify 或 Build Check 要求调整包边界、依赖或执行顺序，但不改变 Task 语义
- **THEN** Runtime 创建递增 revision、保留旧计划审计历史并使受影响 Work input 失效，不要求重新批准 Design

### Requirement: Work Descriptor 只能由已接受计划派生

每个 Build Execute Work MUST 从当前已接受 Build Plan 的一个 Work Package 派生，并冻结 package revision、Task references、repository bindings、write scopes、配置 identity、Skill 组合、input digest、output contract 与 Validator。`autonomous` 模式由当前 Host 直接执行包；`subagent-driven-development` 模式由协调 Host 按包边界委派兼容执行者，但所有 Outcome 仍必须返回原 claim 并由 Runtime 验证。

#### Scenario: autonomous 执行当前包

- **WHEN** 当前配置为 autonomous 且 Work Package 依赖均已满足
- **THEN** Runtime 向唯一 Host 交付完整包和 Skill 内容，Host 不能领取其他未就绪包或修改计划

#### Scenario: subagent 执行越过包边界

- **WHEN** 协调 Host 或子 Agent 修改未包含在当前 Work Package write scope 的仓库或路径
- **THEN** Runtime 拒绝 Outcome、记录旁路修改并阻断依赖它的 completion claim

### Requirement: Plan Evidence 在执行前证明计划可行

Runtime MUST 在创建 Execute Work 前验证 BuildPlan 对批准 Tasks、仓库拓扑、依赖、write scope、Host capability、隔离绑定、Skill 组合与验收的完整覆盖，并持久化绑定当前配置和计划摘要的 Plan Evidence。Definition 的有界风险策略 MAY 建立 Human Decision；未触发暂停时 Runtime MAY 自动接受 Evidence，但 Agent 自述理解、计划文件存在或用户曾批准 Design 不得替代该验证。

#### Scenario: 低风险计划自动通过

- **WHEN** Plan Validator 证明全部 Task 与仓库边界被覆盖，能力与隔离可用，且风险策略不要求人工暂停
- **THEN** Runtime 接受 Plan Evidence并生成第一个就绪 Execute Work，不创建虚假人工审批

#### Scenario: 计划触发可选人工暂停

- **WHEN** 计划包含 definition 声明的高风险副作用、跨仓不可逆顺序或其他暂停条件
- **THEN** Runtime 建立绑定 configuration 与 plan digest 的 Human Decision，在可信决定前不创建 Execute Work

#### Scenario: 计划输入漂移

- **WHEN** Tasks、仓库拓扑、能力快照、隔离绑定或 Skill identity 与 Plan Evidence 输入不一致
- **THEN** Runtime 使旧 Evidence 失效并返回 Plan revision 或 Design，不复用旧批准开始执行

### Requirement: Build Check 汇总计划和任务完成事实

Build Check MUST 对当前 Build Plan revision 的 required Work Package completion、OpenSpec Task 映射、相关测试、标准 Review、仓库漂移和未解决 finding 执行 Runtime Validator；只有 Check Evidence 绑定当前 configuration、plan、implementation 与 repository digests 时才能请求 Verify。Review 强度在本版本固定为 `standard`，调用方不得关闭或降级。

#### Scenario: 包完成但 Task 验收未覆盖

- **WHEN** 所有 Execute Work 都报告成功，但至少一个 Task acceptance reference 没有对应 Validator Evidence
- **THEN** Build Check 失败并返回 Plan revision 或新的普通 Execute Work，不完成 Build

#### Scenario: Review 发现阻断问题

- **WHEN** 标准 Review finding 绑定当前 Work Package 且分类为 blocking
- **THEN** Build Check 保持未通过，并把 finding 作为 Plan revision 输入；finding 本身不是新的 lifecycle 或特殊 repair 类型

#### Scenario: Review 不能证明独立执行身份

- **WHEN** standard Review 由实现当前包的同一 Agent execution 自评，或 Host 不能提供与 implementation execution 区分的受管 reviewer identity
- **THEN** Build Check 保持 blocked，不把自评、自由文本 reviewer 名称或同一 invocation 的角色声明作为独立审查
