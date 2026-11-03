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

Repoctopus MUST 在 Run、ActionIntent、Receipt、日志和遥测中只持久化执行包 schema、各层 source/digest、整体 digest、所属 runId、Work attempt 和 checkEpoch；完整 `WorkExecutionPacket` 只能写入按 packet digest 寻址、不可变且不进入共享事实的私有内容存储。Skill 正文、Provider instructions、Prompt、绝对路径和不受控 change 输入不得写入共享 Run、日志或遥测。

#### Scenario: 进程在交付执行包后退出

- **WHEN** claim 已保存而宿主在提交 Outcome 前退出
- **THEN** 恢复方按 Run 中的 packet identity 从私有内容存储读取、校验并重新交付原 packet 和原 attempt，不从当前项目文件、日志或 Run 文件重组正文

#### Scenario: Skill 正文在恢复前漂移

- **WHEN** claim 后当前 Skill、Provider instructions 或 Change 内容与冻结 packet 不同
- **THEN** Runtime 仍用原 packet 恢复原 attempt，并把当前内容漂移留给后续 Work 或显式兼容检查，不把新正文注入旧 claim且不创建新 generation

#### Scenario: 私有 packet 内容缺失或损坏

- **WHEN** Run checkpoint 引用的 packet 无法按 digest 读取或内容身份校验失败
- **THEN** Runtime fail closed、保留原 claim并返回 `content-missing-or-corrupt` 或 `migration_required`，不重组 packet、不再次调用 Host且不猜测 Outcome

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

Repoctopus MUST 把当前 Work attempt、checkEpoch、claim、执行包 identity、Host invocation、Outcome、Validator、Human Decision 和 lifecycle transition 的有界 identity 纳入同一个权威 Change Run aggregate/checkpoint，并把完整执行包保存为该 identity 指向的不可变私有内容；ActionStore、packet 内容存储或其他投影不得拥有 attempt、claim、完成状态或 continuation。进程、Agent 或 Runner 中断后必须从原 Run 边界产生 `execute`、`ask`、`wait`、`reconcile` 或 `done` continuation，不得创建替代 generation，也不得仅凭 phase、旁路文件存在、可变内容重组或会话记忆重新开始。

#### Scenario: Action 内容写入后 Run claim 前中断

- **WHEN** 不可变 ActionIntent 或 packet 内容已写入内容库，但绑定其 identity 的 Run CAS 尚未成功
- **THEN** 这些内容是可忽略或可清理的孤立记录，不构成 claim，新 Runner 只按权威 Run 尝试领取且不得把内容库 latest 当作当前 attempt

#### Scenario: Run claim 成功后响应丢失

- **WHEN** Run checkpoint 已绑定 claim、packet、attempt 和 epoch identity，但领取响应在返回宿主前丢失
- **THEN** 新 Runner 从私有内容存储读取并验证同一 packet，恢复原 attempt且不创建第二个 claim

#### Scenario: Run 引用的 Action 内容损坏

- **WHEN** 权威 Run 引用的 ActionIntent、packet、Outcome 或 Receipt 内容缺失、损坏或摘要不匹配
- **THEN** Runtime fail closed 并返回 reconcile/repair 诊断，不从其他 Action 文件、当前项目内容、最新时间或 checkbox 猜测执行结果

#### Scenario: Host 调用后连接中断

- **WHEN** checkpoint 已记录原 Host invocation，但 Runtime 未取得可验证 Outcome
- **THEN** 新 Runner 保留同一 Work attempt、epoch、packet 和 scope，先观察原 Host并返回 reconcile 或等待，不自动再次调用 Agent或重发外部副作用

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

- **WHEN** repository commit/path binding、definition、composition、Specification Provider 或 packet identity 与 checkpoint 不一致
- **THEN** Runtime 在同一 Run 返回结构化 reconcile 或 `migration_required` 状态并保留原执行事实，不把漂移解释为未执行后重跑

#### Scenario: claim 后 Skill 或规划内容发生合法变化

- **WHEN** 原 packet identity 和私有内容完整，但当前 Skill 或规划文件因本 Work 的受管写入而变化
- **THEN** Runtime 不重新组装旧 packet、不把该变化误判为旧 claim 损坏，并继续从 Host invocation、Outcome 或 Validator 的真实断点恢复

### Requirement: 外部 Host Outcome 重放必须保持内容幂等

Repoctopus MUST 以 invocation identity 和稳定内容恢复已经持久化的外部 Host Outcome；Runtime 生成的完成时间不得使等价重放冲突，任何调用方提供的稳定字段漂移都必须 fail closed。

#### Scenario: 相同外部 Host Outcome 重复提交

- **WHEN** 同一 invocation 的外部 Outcome 已持久化，恢复进程再次提交相同 status、summary、consumed Skill layers、result、findings 与 delegation receipts，但产生了新的提交时间
- **THEN** Runtime 复用原 Outcome 与原 `completedAt`，不再次记录 Host completion，并继续原 fact、Action Outcome 与 Validator 边界

#### Scenario: 重放的外部 Host Outcome 内容漂移

- **WHEN** 同一 invocation 的重复 Outcome 在 status、summary、consumed Skill layers、result、findings 或 delegation receipts 任一稳定字段上不同
- **THEN** Runtime 拒绝该提交并保留原持久 Outcome，不重新调用 Host、不覆盖 checkpoint 且不推进 Work

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

Runtime MUST 从已通过 Design Human Decision 的版本化 `BuildStrategy` 读取 execution/TDD/review/isolation intent，并根据当前 Run、仓库拓扑、隔离事实与 Host capabilities 解析独立 `ExecutionBinding`。Strategy 以稳定 identity、semantic digest 和 approval Evidence 固定；Binding 以 repository/branch/head/worktree ownership、capability digest、可移植 semantic digest 和只在本地保存的 path/local digest 固定；实际 Skill composition identity 由独立 compatibility authority 固定和验证。Agent 与 Host不得增删策略字段、以执行行为反向改写 Strategy，或把机器绑定/composition 变化变成人工策略选择。

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成 Work Package，且 Host 声明兼容协调能力，用户在 Design approval 中接受 subagent Strategy
- **THEN** Runtime 固定该 Strategy 并把模式绑定全部 Build Action，Configure 只验证实际 ExecutionBinding

#### Scenario: Host 不支持批准配置

- **WHEN** 恢复时当前 Host 不满足冻结 execution mode 的 capability contract
- **THEN** Runtime 在副作用前寻找或等待兼容 Host 并重新验证 Binding，不静默降级 Strategy；只有请求改变策略语义时才需要新 Human Decision

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner 为批准的 current、branch 或 worktree intent 提供受影响仓库的本地 checkout facts
- **THEN** Runtime 以稳定 repository identity、branch、head、worktree identity、Workspace ownership 与 capability 验证 Binding；绝对路径只保存在本地 Run overlay

#### Scenario: 绑定变化但策略未变

- **WHEN** 同 isolation intent 下 checkout HEAD、Host 或本机路径发生兼容变化
- **THEN** Runtime 生成新 Binding identity、使依赖旧输入的 Plan/Evidence 失效并自动重验，不创建 Build Strategy approval

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

Runtime MUST 在创建 Execute Work 前验证 BuildPlan 对批准 Tasks、验收、仓库拓扑、依赖、repository/write scope、terminal report ownership、Host capability、ExecutionBinding、有效 Skill composition 和 BuildStrategy 的完整覆盖，并持久化绑定当前输入的 Plan Evidence。

#### Scenario: 低风险计划自动通过

- **WHEN** Plan Validator 证明全部 Task/acceptance、仓库边界、write scope、报告归属、能力、绑定和 composition 被覆盖，且风险策略不要求暂停
- **THEN** Runtime 接受 Plan Evidence 并生成第一个就绪 Execute Work，不创建虚假人工审批

#### Scenario: 计划的 write scope 与任务不一致

- **WHEN** Work Package 请求写入未被 Task、definition 或目标仓库允许的路径
- **THEN** Plan Evidence 返回结构化 planning finding 并留在 Plan revision，不等到 Execute 工具调用后才失败

#### Scenario: 计划触发可选人工暂停

- **WHEN** 计划包含 definition 声明的高风险副作用、跨仓不可逆顺序或其他暂停条件
- **THEN** Runtime 建立绑定 Strategy、Binding 与 plan digest 的 Human Decision，在可信决定前不创建 Execute Work

#### Scenario: 计划输入漂移

- **WHEN** Tasks、验收、仓库拓扑、Strategy、Binding、能力快照、Skill composition 或计划 identity 与 Plan Evidence 输入不一致
- **THEN** Runtime 使旧 Evidence 失效并按变化权威返回 Plan revision、Design 或 `migration_required`；composition 漂移不得单独刷新 Strategy approval

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

### Requirement: 外部 Build Execute Outcome 必须经过统一的两阶段消费

外部 Runner 为 `build.execute` Work 提交 Outcome 后，Runtime MUST 先把 `submitted` submission 显式接受为当前 attempt 的 Host 结果，再运行 package validator 并决定 validated success、finding recovery 或 halt；成功 submission MUST NOT 在 validator 前完成 package，失败 submission 的结构化 finding MUST NOT 因缺少旧内嵌 Host `outcome` 投影而丢失。重复 `next`、进程重启和同一 submission 重放 MUST 保持幂等，不得重复完成 Specification Task、Receipt 或 package。

#### Scenario: 外部 Runner 提交成功 Outcome

- **WHEN** 当前 Build Execute attempt 收到匹配 invocation/packet/context 的 `submitted/succeeded`
- **THEN** Runtime 接受该 submission并运行 package validator，只有 validator accepted 后才标记 Task 与 package 完成

#### Scenario: 外部 Runner 提交失败 Outcome

- **WHEN** 当前 Build Execute attempt 收到包含结构化 planning 或 implementation finding 的 `submitted/failed`
- **THEN** Runtime 接受该 submission并把 finding 交给正式 recovery 选择，不要求伪造旧内嵌 Host `outcome`

#### Scenario: 重启后重复消费同一 submission

- **WHEN** Runtime 在接受或验证 submission 后重启并再次执行 `next`
- **THEN** 已接受、已验证和已完成的事实不会重复写入，当前 continuation 从持久状态确定

### Requirement: 活动 Run 必须通过精确 adoption contract 采纳新的受保护语义

当自举 Change 修改当前 Run 使用的受保护 lifecycle/Runtime implementation 时，composition catalog MUST 只为该活动 Run 的唯一直接前驱声明精确 `{codeDigest, descriptorDigest}` adoption pair，相关 lifecycle contributor MUST 只声明直接前驱 version 可采用当前唯一语义；未明确列出的 digest pair 或 version MUST 保持 `migration_required`。该 contract MUST NOT 建立长期并行旧行为、通配 digest 或绕过 migration 检查的 Store 编辑路径。

#### Scenario: 当前活动 Run 采纳直接前驱

- **WHEN** 持久 Run 的 protected implementation digest pair 与 contributor version 精确匹配本 Change 声明的直接前驱
- **THEN** composition comparison 返回 compatible且 Run 可由新代码继续执行唯一的新 transition 语义

#### Scenario: 未声明的实现漂移

- **WHEN** 任一 code digest、descriptor digest 或 contributor version 不在精确 adoption contract 中
- **THEN** composition comparison 返回 `migration_required`，不得因只匹配其中一个 digest 或相邻版本而放行

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

### Requirement: Open repair 必须原子替换当前 execution

当 Open Provider Evidence或批准后重验要求返工时，Runtime MUST 在同一次 Run CAS中安装由当前 lifecycle definition物化的新 `change.intake` Work，并按统一 current execution判定退役 `workId/checkEpoch` 不匹配的旧 checkpoint。新 Work MUST 绑定当前 Project Snapshot、composition、Specification Root、Action Skill和 augmentation；历史 claim、packet、Host invocation、submission、Outcome、Receipt、Validator和 rejection MUST 保留在 trajectory。Status和 recovery不得把历史 execution重新投影为当前 continuation。

#### Scenario: Open Evidence 拒绝后建立 repair Work

- **WHEN** 当前 Open execution已产生成功 Outcome，但 Provider Evidence确定性拒绝该候选
- **THEN** lifecycle Work替换和旧 execution retirement由同一 CAS完成，恢复只返回新 Work的未领取 continuation

#### Scenario: Repair transition 进程中断

- **WHEN** 进程在提交 replacement CAS后、Host领取新 Work前退出
- **THEN** 新进程从同一 Run恢复完全相同的 workId、epoch、packet输入与 Skill composition，不重新创建 Work

#### Scenario: 陈旧 Runner 提交 repair

- **WHEN** Runner使用旧 lifecycle revision或旧 epoch尝试安装 Open repair Work
- **THEN** Runtime拒绝该提交并要求重读当前 Run，不覆盖已存在 Work、Wait或批准

#### Scenario: 遗留无 Work 的 Open blocker

- **WHEN** 冷启动读取修复前持久化的 `open/blocked/currentWork=null`状态
- **THEN** Runtime返回明确不可自动迁移诊断和重新开始提示，不伪造 repair Work或从可变文件反推冻结输入

### Requirement: Execution checkpoint 兼容性必须按依赖身份判定

Runtime MUST 以 current Work、attempt、`checkEpoch`、packet、Host invocation 及该 Work 声明的输入依赖逐项判断 execution checkpoint 是否仍可续行；未被变化身份依赖的 checkpoint MUST 保留，直接依赖不兼容身份的 checkpoint MUST 原子退役。Runtime 不得以全局 planning 或 composition 摘要不同为由无差别丢弃执行事实。

#### Scenario: 当前 Work 输入完全相同

- **WHEN** Runner 恢复时 current Work、attempt、epoch、packet 和全部声明输入身份均与 checkpoint 相同
- **THEN** Runtime 返回原 execution continuation，不创建新的 ActionIntent、packet、claim 或 Host invocation

#### Scenario: 变化不属于当前 Work 依赖

- **WHEN** Run 中某个 publication 或其他旁路身份变化，但当前 Work 的显式输入依赖均未变化
- **THEN** Runtime 保留原 execution checkpoint 并继续真实断点

#### Scenario: 当前 Work 的受保护输入不兼容

- **WHEN** 当前 Work 依赖的 Provider、definition、packet 或 repository binding 无法证明与 checkpoint 兼容
- **THEN** Runtime 原子退役当前投影并返回 `reconcile` 或 `migration_required`，不得从最新文件重组 packet 后重放 Host

### Requirement: 未知外部结果必须优先 reconciliation

当 Host、工具、Git、平台或 Specification 副作用可能已经开始但结果未知时，Runtime MUST 保留原 invocation、幂等键、attempt、packet 与输入身份并返回有界 `reconcile` continuation；只有取得确定性未执行证明后才可创建新 attempt，取得匹配 Receipt 或 Outcome 后必须从原 checkpoint 继续。

#### Scenario: Host 响应在提交后丢失

- **WHEN** Runtime 已记录 invocation，但无法确定 Host 是否完成了具有副作用的操作
- **THEN** 下一次 pull 返回原 invocation 的 reconciliation，不重新调用 Host

#### Scenario: reconciliation 发现匹配 Outcome

- **WHEN** Reconciler 找到绑定原 invocation、packet、attempt 和输入身份的持久 Outcome 或 Receipt
- **THEN** Runtime 幂等接纳该事实并从 Validator 或 transition 继续，不创建新的执行身份

#### Scenario: reconciliation 证明未执行

- **WHEN** 权威适配器能确定性证明原 invocation 未跨过副作用边界
- **THEN** Runtime 按 definition retry policy 创建更高 attempt，并保留原 attempt 的审计事实

### Requirement: 恢复不得重建已存在的人机协议

Human Decision request、Build Configuration proposal、Build Plan candidate rejection 和可纠正 Host submission MUST 作为原 checkpoint 的稳定协议事实恢复；重复 `next`、进程重启或 Runner 交接不得仅因重新观察当前文件而生成另一份 proposal/request 或改变其 hash。

#### Scenario: 等待 Build Configuration 决定时恢复

- **WHEN** Run 已持久化 Build Configuration proposal 和 Human Decision request，但尚未收到用户决定
- **THEN** 新 Runner 展示同一 request、proposal hash 和 choices，不重新进入 Configure Host Work

#### Scenario: 可纠正 submission 被拒绝后恢复

- **WHEN** 当前 invocation 已有 rejected submission 且冻结输入仍匹配
- **THEN** Runtime 保留原 claim/attempt/invocation 并等待新的 submission identity，不重新执行 Agent

### Requirement: BuildStrategy 与 ExecutionBinding 使用独立身份

Repoctopus MUST 分别持久化可移植 `BuildStrategy` 和本机可重建 `ExecutionBinding`，并让 Work input 同时引用两者。Strategy 变化表示人/团队语义变化；Binding 变化表示执行环境事实变化。Runtime MUST 使用不同 digest、Validator 和失效规则处理二者，且本机绝对路径不得进入 Strategy、OpenSpec 工件、共享配置摘要或 OTLP。

#### Scenario: 相同 Strategy 在另一台机器恢复

- **WHEN** 同一 Run 在具有兼容 Host 与仓库 checkout 的另一台 Runner 恢复
- **THEN** 已批准 Strategy 保持有效，Runtime 为新机器建立并验证新 Binding，再使依赖旧本地输入的 Work/Evidence 精确失效

### Requirement: Build Execute 前必须证明全部可写仓绑定合法 source branch

Runtime MUST 在 Build Plan 给出精确 write scopes 后、接受 Plan Evidence 或创建任何 Execute Work 前，把可写 repository 集合与冻结的 Execution Binding 和 protected branch policy 联合校验。匹配 protected pattern 的可写仓 MUST 被拒绝；只读仓 MUST NOT 因停留在 target/protected branch 被无关阻断。Runner 负责准备并公开 source branch/worktree，Runtime 不执行 Git branch 副作用。

当 Plan 因 protected branch finding 被拒绝后，Runtime MUST 把 rejected `build-plan-candidate`、精确 write scopes、旧 Execution Binding、protected policy 与 project snapshot 作为修正授权证据。Runner 完成对应 branch-only 修正后，无论通过 `run next` 还是进程重启后的 `run resume` 拉取，Runtime MUST 使用同一 classifier 建立新 Binding revision、精确失效旧 Plan checkpoint 并在同一 Run 重新派发 Build Configure。只有授权集合内仓库的 attached branch 变化可以走该路径；任何无关 branch、path、remote、topology、repository add/remove、worktree ownership、Host 或 capability 变化 MUST 继续进入通用 reconciliation 并 fail closed。

#### Scenario: 可写业务仓仍绑定 main

- **WHEN** 已验证 Plan 的 package write scope 包含 `web-design`，而当前 Execution Binding 把该仓绑定到受保护的 `main`
- **THEN** Runtime 在 Plan Outcome 终态化、Plan Evidence 和 Execute Work 之前返回结构化 finding，且不授予任何业务写权限

#### Scenario: 只读业务仓停留在 main

- **WHEN** `backend` 只作为读取或验证依赖出现在 Plan 中且没有任何 write scope，并绑定受保护的 `main`
- **THEN** Runtime 不因该只读仓拒绝 Plan，仍持续校验其 Binding 漂移和 HEAD 一致性

#### Scenario: 可写仓使用合法功能分支

- **WHEN** 每个 write scope repository 均绑定不匹配任何 protected pattern 的 attached source branch或合法 worktree
- **THEN** Runtime 可以继续接受 Plan Evidence并创建第一个就绪 Execute Work

#### Scenario: Runner 修正被拒绝的 checkout

- **WHEN** Plan 因 protected branch finding 被拒绝后，Runner 为相关仓准备并公开合法 source branch/worktree，再次拉取同一 Run
- **THEN** Runtime 通过既有 Binding drift/reconfigure 协议建立新 Binding revision，使旧 Plan 精确失效并重新规划，不要求编辑 Store 或启动第二个 Change Run

#### Scenario: 断点后通过 resume 恢复精确 branch 修正

- **WHEN** Plan 因 protected branch finding 被拒绝，Runner 只为 finding 中的可写仓准备并公开合法 attached source branches，随后 Host 进程重启并对同一 Run 调用 `run resume`
- **THEN** Runtime 使用与 `run next` 相同的授权 classifier，在同一 Run 创建一个 Build Configure revalidation Work，不设置 `reconciliationRequired`，也不丢失 Design approval、Build Strategy、Tasks 或 rejected outcome

#### Scenario: 已被错误标记的 matching Run 恢复

- **WHEN** 既有 `reconciliationRequired` 仅由同一 rejected Plan 要求的 branch-only 修正产生，且当前 frozen evidence、snapshot diff 与 protected write-set 仍精确匹配
- **THEN** Runtime 原子记录 authorized rebind、清除该 matching reconciliation projection并派发唯一的 Build Configure Work，重复 resume 保持幂等

#### Scenario: branch 修正夹带无关身份漂移

- **WHEN** Runner 修正 protected write repositories 的同时改变了无关仓 branch，或任一 checkout path、remote、topology、repository membership、worktree ownership、Host 或 capability 发生变化
- **THEN** Runtime 不授予 authorized rebind，保留或设置 `reconciliationRequired` 并 fail closed，不创建 Configure、Plan Evidence 或 Execute Work

#### Scenario: 多个 protected 写仓只完成部分修正

- **WHEN** rejected Plan 包含多个 protected write repositories，而当前 snapshot 只证明其中一部分已切换并公开合法 source branch
- **THEN** Runtime 不授予任何仍位于 protected branch 仓库的写权限，并以 next/resume 一致的结构化状态等待剩余修正或重新配置，不创建 Execute Work

### Requirement: Build workspace 进度必须与 Execution Binding 身份分离

Repoctopus MUST 把 `ExecutionBinding` 作为 Strategy、Host、repository、branch/worktree ownership 与初始 revision 的不可变授权基线，并使用独立、Runtime-owned `BuildWorkspaceCheckpoint` 表达 Build 期间逐仓前进的已接受 revision。正常实现 commit MUST NOT 被分类为 Binding identity drift，Host MUST NOT 充当 repository revision digest 的权威。

#### Scenario: 当前 Package 产生合法 commit

- **WHEN** 当前 Execute Work 在获授权 write scope 中产生 commit，所有 branch/worktree/owner/Host 身份保持不变，且新 HEAD 是当前 checkpoint HEAD 的后代
- **THEN** Runtime 接受 Package Completion 并建立下一 checkpoint revision，不返回 Configure，不丢失 Plan 或已完成 package

#### Scenario: Checkout 身份发生变化

- **WHEN** repository branch、isolation、worktree、workspace owner、Host 或 capability 与已接受 Binding 不一致
- **THEN** Runtime 使用现有 Binding revalidation 入口 fail closed，不把身份变化记录为普通 workspace progress

### Requirement: Runtime 必须按 Package write scope 推进 workspace revision

Repoctopus MUST 在每个 Package Completion 前重观察全部登记仓库，以最新 BuildWorkspaceCheckpoint 为基线，仅允许当前 package write scopes 覆盖的仓库保持原 HEAD 或 fast-forward；所有其他仓库 MUST 保持精确 HEAD。Checkpoint 更新、Completion acceptance 与下一 Work 创建 MUST 是同一受管生命周期转换。

#### Scenario: 未授权仓库同时变化

- **WHEN** 当前 package 只写 repository A，但 repository B 的 HEAD 相对 checkpoint 发生变化
- **THEN** Runtime 拒绝 completion 并指出 `unauthorized-head-change`，不吸收 B 的新 revision，也不推进 Task

#### Scenario: 写集仓库历史被改写

- **WHEN** 当前 package 写集中的新 HEAD 不是 checkpoint HEAD 的后代
- **THEN** Runtime 以 `non-fast-forward` fail closed，保留同一 Work/Outcome 供明确修复或 reconciliation

#### Scenario: 幂等恢复时 HEAD 未改变

- **WHEN** Package 实现已经存在于当前 checkpoint HEAD，Host 重新验证并提交完整 Evidence，但没有产生新 commit
- **THEN** Runtime 可以建立语义等价的下一 checkpoint revision并接受 completion，不要求伪造 HEAD 变化

#### Scenario: 兼容 Runtime adoption 后恢复已派发 Work

- **WHEN** composition compatibility gate 已接受精确直接前驱，Run 采用新 composition，但当前 Work 的 Action Intent 与 Work Packet 是采用前冻结的同一旧 snapshot
- **THEN** Runtime 必须按 Intent 与 Packet 的冻结身份恢复并验证 Outcome，不得因其 snapshot digest 不等于 Run 当前 composition digest 而重派发或拒绝

### Requirement: Repository revision Evidence 必须由 Runtime 观察

Repoctopus MUST 从 `build-package-completion` 与 `build-check-candidate` Host result 中排除 repository digest authority。Runtime MUST 通过项目 Git adapter 观察 branch/HEAD、验证 ancestry 并计算 checkpoint digest；Host 只能提交实现、验收、测试、TDD、delegation 与 review Evidence。

#### Scenario: Host 提交自造 repository digest

- **WHEN** Host result 包含旧 `repositoryDigest` 或其他未声明 repository state 字段
- **THEN** Work result schema 拒绝该 submission，且 Runtime 不使用该字段创建 Completion 或 Check Evidence
