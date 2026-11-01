# Spec Delta

## MODIFIED Requirements

### Requirement: 规划批准独立于 Change MR

Repoctopus MUST 在没有 Change MR 的情况下，通过当前 Specification Provider 校验 Proposal、Design、Delta Specs 和 Tasks，并使用结构化 Human Decision 记录批准、要求修改或拒绝；批准 MUST 绑定 change、Provider/schema、规范化规划语义身份、受影响能力和规范化目标分支身份。Change 分支 MUST 已公开并把 publication provenance 作为独立发布事实记录；composition、Build configuration/plan、执行进度、实现提交和 source remote/OID 不得进入 approval semantic identity，也不得单独使批准失效。

#### Scenario: 规划产物通过校验并获得批准

- **WHEN** 四类规划产物均由当前 Provider 声明为完成，Change 分支已公开且可信用户批准对应语义身份
- **THEN** Change Run 记录 Design approval Evidence，并允许进入 Build

#### Scenario: Provider 校验失败

- **WHEN** 任一规划产物缺失、无效或与当前 Provider 状态不一致
- **THEN** Runtime 不创建批准请求或进入 Build，并返回 Provider 的可定位诊断

#### Scenario: 没有可信人工交互通道

- **WHEN** Runtime 无法确认规划决定来自可信用户交互上下文
- **THEN** Runtime 保持 `design/waiting`，Agent、Runner、commit 和 MR 状态不得代替用户批准

#### Scenario: 批准后规划分支发生变化

- **WHEN** 四类产物语义、受影响能力、Provider/schema 或规范化目标分支身份与已批准事实不同
- **THEN** Runtime 使旧批准失效、返回 Design 并要求重新校验和人工决定

#### Scenario: Task 只更新完成 checkbox

- **WHEN** 已批准 Tasks 的稳定 ID、文字、结构、依赖、验收和需求映射未变，只有有效 Work 完成导致 checkbox 状态变化
- **THEN** Provider 的规划语义身份保持不变，Runtime 不要求重新批准 Design

#### Scenario: Change 分支只增加非规划提交

- **WHEN** Change 分支远端 OID 因实现、测试或合法收尾提交变化，但规划语义身份与目标分支不变
- **THEN** Runtime 更新 publication provenance，既有 Design approval 不仅因 OID 变化而失效

#### Scenario: 规划批准后尚未完成实现

- **WHEN** Change 已获得 Design approval 但 Verify 和 Archive 尚未完成
- **THEN** Runtime 不创建最终 Change MR，也不把 Design approval 解释为验证、远端副作用授权或规格关闭

### Requirement: Later phase 必须只读观察并在副作用前收敛规划授权

Build、Verify 和 Archive 中的 planning authority 检查 MUST 通过 Specification Planning 权威模块的只读接口分别观察当前 Provider planning semantic identity、strict validation、approval identity 与 publication provenance，不得由编排层拼装 Store 内部规则或在 lifecycle transition 前创建/刷新 Human Decision。仅 semantic 或 approval-authority 不再授权 lifecycle 时才可返回受限分类并原子恢复 Design；composition、执行进度和仅 publication provenance 的变化 MUST 交由各自权威处理。Status、Dashboard 和其他查询 MUST 保持只读。

#### Scenario: Build pull 发现语义变化

- **WHEN** Build pull 观察到 Provider semantic identity 与 lifecycle planning identity 不同
- **THEN** Runtime 不先改 approval Store，而是原子回到带当前 Work 的 Design；后续 Design gate 再生成绑定新身份的批准请求

#### Scenario: Archive preflight 发现 approval 失效

- **WHEN** Archive 尚未执行关闭或发布副作用，当前 Design approval 缺失、被拒绝、等待新决定或与 planning semantic identity 不匹配
- **THEN** Runtime 返回 `planning-revision-required` 和 Design checkpoint，且 Specification、Git 与平台发布 adapter 均未被调用

#### Scenario: 查询发现不一致

- **WHEN** status 或 Dashboard 读取到 approval 与 lifecycle 不一致
- **THEN** 查询报告可定位 freshness/diagnostic，但不修改 phase、approval 或 current Work；下一次受保护 Runtime pull 执行幂等收敛

#### Scenario: Archive 只发现发布来源更新

- **WHEN** planning semantic identity 与 approval identity 仍匹配，只有 publication provenance 更新
- **THEN** Runtime 保留 Design approval 和 Build/Verify 事实，只重新验证受 publication provenance 约束的 Archive 输入

## ADDED Requirements

### Requirement: Specification Planning 必须公开分层身份

Specification Planning MUST 分别公开 planning semantic、approval authority、publication provenance 与 validation observation 的版本化身份和依赖，不得以单一 snapshot digest 同时代表规划授权、Runtime composition、Build execution 或发布来源；每个观察结果 MUST 指明变化类别与其授权范围。

#### Scenario: 相同语义使用新的 composition

- **WHEN** Provider 观察到相同 planning semantic identity，但调用 Runtime 使用新的 composition identity
- **THEN** planning observation 保持 authorized，并把 composition 判定留给 Runtime compatibility 权威

#### Scenario: 远端地址仅大小写不同

- **WHEN** 两次 publication observation 的远端地址按托管平台和 Git 规则规范化后指向同一 remote，且 target/source branch identity 相同
- **THEN** Provider 产生相同 publication repository identity，不撤销 planning approval

#### Scenario: 观察基础设施不可用

- **WHEN** Provider 无法确定当前 semantic、approval 或 publication 身份
- **THEN** 观察结果为 unknown 并保留原 checkpoint 进入 reconciliation，不得伪造 drift 或创建新批准请求
