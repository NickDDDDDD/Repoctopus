# Spec Delta

## MODIFIED Requirements

### Requirement: 生命周期回退保留审计历史

Design revision、规划语义漂移、Verify 失败、实现输入漂移和 Archive 前置验证失效 MUST 在同一 Run 中通过追加 invalidation、递增 `checkEpoch` 与定义声明的回退转换处理；Runtime MUST 按稳定身份依赖关系只失效不再授权当前输入的批准、Work、Build 节点与 Evidence，并保留仍匹配的 Task completion、Build Configuration、Plan、Package completion、Outcome、Evidence 和 Receipt。普通回退不得创建替代 Run；外部或规格关闭副作用开始后的 Archive 不得回滚，只能 reconcile。

#### Scenario: Verify 发现实现失败

- **WHEN** 完整 verification input 下的阻断 Gate 不满足
- **THEN** 同一 Run 记录失败 Evidence、递增 epoch 并回到 Build 或进入 Build blocked，旧 Gate 不可用于后续修复输入

#### Scenario: Build 中修改规划语义

- **WHEN** Tasks 文字、结构、需求映射或其他规划产物语义变化
- **THEN** Runtime 在原 Run 中使旧 Design approval 和受影响 Work 失效、递增 epoch 并返回 Design，同时保留仍由新语义授权的下游事实

#### Scenario: 局部变化不影响已完成工作包

- **WHEN** Runtime 能证明变化只影响当前 Plan 的一个 Work Package 及其依赖后继
- **THEN** invalidation 只退役该范围的 execution 与 Evidence，其他匹配当前稳定身份的 Package completion 继续有效

### Requirement: 规划授权失效必须原子恢复 Design checkpoint

当 Build、Verify 或尚未发生不可逆副作用的 Archive 观察到当前 Specification Provider 的规划语义或 trusted Design approval 不再授权 lifecycle 的 planning identity 时，Runtime MUST 通过带 `semantic | approval-authority` 分类的受保护 transition 原子回到 Design，并在同一次 Run 提交中设置新的 `specification.plan` Work、递增 `checkEpoch`、退役不匹配的 execution checkpoint，且按依赖关系保留或失效 Tasks、Build Configuration、Plan、Package completion、Verification、Archive 与 Closure 输入。Runtime MUST NOT 将 composition、执行进度或仅 publication provenance 的变化误分类为 planning invalidation，也不得留下无 current Work 的 Design 中间态、复用无效 approval、创建第二个 Run 或要求手改 Store。

#### Scenario: Verify 收尾提交改变规划语义

- **WHEN** Change 已进入 Archive，但 Verify 收尾提交改变 Proposal、Design、Delta Specs、Tasks 语义或 Change metadata
- **THEN** 下一个受保护 Runtime pull 在任何关闭或发布副作用前一次提交 Design phase、新 `specification.plan` Work、新 epoch 与精确下游失效事实

#### Scenario: 当前 approval 不再有效但语义摘要相同

- **WHEN** Archive preflight 能读取相同 planning semantic digest，但无法证明与该 Run 绑定的 trusted Design approval 仍有效
- **THEN** Runtime fail closed 并回到新的 Design approval Work，不把 lifecycle 中的 planning identity 单独视为发布授权

#### Scenario: 重复观察相同失效

- **WHEN** 进程在恢复提交后退出，另一个 Runner 对同一 revision 再次观察相同规划失效
- **THEN** Runtime 返回已经存在的 Design checkpoint 或明确 revision conflict，不创建第二个 Work、第二次 invalidation 或重复副作用

#### Scenario: 陈旧 Runner 提交失效观察

- **WHEN** planning invalidation observation 的 `expectedRevision/fromPhase` 不再匹配 CAS 内读取的当前 Run
- **THEN** Runtime 拒绝该陈旧观察并要求调用方重读当前 Action，不覆盖较新的 phase、Work 或批准结果

#### Scenario: composition 变化但规划语义不变

- **WHEN** 当前 composition identity 与 Run 记录不同，但 Specification Provider 返回相同 planning semantic identity
- **THEN** Runtime 先走 composition compatibility 或 migration 判定，不刷新 Design approval，也不清空 Build Protocol

#### Scenario: 仅 publication provenance 改变

- **WHEN** source branch 的规范化 remote identity 或已发布 OID 改变，但规划语义、目标分支与批准 proposal 均未改变
- **THEN** Runtime 只刷新 publication provenance 或 Archive 输入，不返回 Design

## ADDED Requirements

### Requirement: Runtime 失效必须使用稳定身份依赖图

Change Run MUST 分别记录 planning semantics、approval authority、composition、Build Configuration、Build Plan、Work Package、execution checkpoint、verification input 与 publication provenance 的稳定身份及依赖；变化只能失效直接依赖该身份且无法证明兼容的事实，禁止用单一聚合摘要触发无差别重建。

#### Scenario: Build Plan 局部修订

- **WHEN** 新 Plan revision 保留某个 Work Package 的稳定 identity、依赖、输入和 Validator profile
- **THEN** Runtime 保留该 Package completion 及其匹配 Evidence，只为变化包及依赖后继创建新 Work

#### Scenario: 无法证明兼容范围

- **WHEN** Runtime 缺少计算安全最小失效范围所需的身份或依赖事实
- **THEN** Runtime fail closed 为受限 Human Decision、reconcile 或 definition 声明的保守失效，并记录未能保留的原因

### Requirement: 等价输入的 continuation 必须幂等

相同 Run revision、current Work、attempt、`checkEpoch` 与输入身份上的重复 `next`、`resume`、批准提交、Outcome 重放或恢复 MUST 返回同一逻辑 continuation 或明确的 revision conflict；Runtime 不得重建 Work、Build Configuration proposal、Build Plan、Human Decision request、invalidation 或外部副作用。

#### Scenario: 相同配置重复进入 Build Configure

- **WHEN** Runner 在 Build Configuration proposal 已提交后断开并以相同 checkpoint 恢复
- **THEN** Runtime 返回原 proposal 与待处理 continuation，不建立第二次配置批准

#### Scenario: 提交成功后响应丢失

- **WHEN** Run CAS 已接受 transition，但调用方未收到响应并重放相同命令
- **THEN** Runtime 从已提交 checkpoint 返回该 transition 之后的 continuation，不重复写入事实或执行副作用
