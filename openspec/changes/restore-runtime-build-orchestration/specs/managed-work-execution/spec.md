# managed-work-execution Specification Delta

## RENAMED Requirements

- FROM: `### Requirement: 验证失败必须创建受管 Repair Work`
- TO: `### Requirement: 验证失败必须修订 Build Plan 并创建普通 Work`

## ADDED Requirements

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 根据当前 Run、仓库拓扑、OpenSpec Tasks、隔离能力与 Host capabilities 生成 Build Configuration proposal；可信用户批准后，配置 MUST 以稳定 identity、schema version、semantic digest 和 approval Evidence 固定。Agent 与 Host 只能执行该配置，不得增删策略字段或以实际执行行为反向改写配置。

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成并行 Work Package，且 Host 声明兼容的 subagent coordination capability
- **THEN** Runtime 可以提出 `subagent-driven-development`，并在批准后把该模式绑定全部 Build Action

#### Scenario: Host 不支持批准配置

- **WHEN** 恢复时 Host 不再满足冻结 execution mode 或 isolation 的 capability contract
- **THEN** Runtime 在副作用前进入 blocked 或 `migration_required`，不得降级为 autonomous/current 或切换模式

### Requirement: Runtime BuildPlan 是 OpenSpec Tasks 的执行投影

Build Plan MUST 是 Runtime 管理的版本化执行产物，引用批准的 Build Configuration、OpenSpec planning digest 与稳定 Task IDs，并把 Task 投影为有依赖、仓库绑定、write scope、acceptance references、validator profile 和预期 Outcome 的 Work Package。Build Plan MUST NOT 包含第二套完成 checkbox、改写 Task 语义或成为 Specification Provider 产物；Task 的 scope、依赖与完成权威仍属于 OpenSpec Tasks。

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

## MODIFIED Requirements

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
