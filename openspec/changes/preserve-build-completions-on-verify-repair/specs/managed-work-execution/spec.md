## MODIFIED Requirements

### Requirement: 验证失败必须修订 Build Plan 并创建普通 Work

当 Verify 证明实现行为不满足当前批准规格时，Repoctopus MUST 在同一 Run 记录失败 Evidence、递增 `checkEpoch` 并进入 Build Plan 安排修复；原计划仍成立时允许复用其内容，实际变更时才产生新 revision。修复 MUST 通过普通 Build Execute Work 和新 Build Check 执行，只复用经当前输入校验仍有效的完成凭证。文件变化、Git commit、checkbox、phase 变化或修复标签本身不得证明修复完成，也不得默认使所有包失效。

#### Scenario: Verify 失败后重新进入 Build

- **WHEN** Runtime 接受 implementation failure 并从 Verify 转换到 Build
- **THEN** projection 返回待复核的 Build Plan、实际失败依据及可核对的影响范围，保留仍有效的包完成凭证；Plan 接受后才派发普通可领取 Work，不创建 `verify.repair` 或 `implementation.repair`

#### Scenario: Agent 在受管 Repair Work 外修改代码

- **WHEN** 仓库内容已改变，但当前普通修复执行没有覆盖这些变化的有效 Outcome、Validator 和 completion claim
- **THEN** Runtime 保持 Build pending 或 blocked 并报告旁路修改，不允许直接接受 Build Check 或重新进入 Verify

#### Scenario: 无法证明最小受影响 Task 集合

- **WHEN** 现有失败 Evidence、Acceptance coverage、已接受 Plan 和依赖身份仍无法证明安全的最小影响范围
- **THEN** Runtime 返回明确阻断、Human Decision 或带依据的 definition 保守失效，不静默重开全部 Task，也不无条件保留 completion
- **AND** 不要求团队新增并人工维护 finding→Task 或 finding→Package 的第二套权威清单

#### Scenario: Task 已完成但对应实现需要修复

- **WHEN** 一个 Task 已有受管完成事实，Verify 随后证明其实现存在缺陷，且 Task 的批准语义未变化
- **THEN** Runtime 用相同 Task ID 下的普通 Execute Work 验证修复，不通过新增影子 Task、重开 OpenSpec checkbox 或跳过受管 Host 来使执行可达

#### Scenario: 保留凭证的输入实际发生变化

- **WHEN** 修复过程中某个候选保留包的真实依赖、包契约或授权输入已变化
- **THEN** Runtime 使依赖该变化的完成凭证失效或明确阻断，不能只凭 package ID 相同就继续接受旧凭证

#### Scenario: 修复后重做检查

- **WHEN** 受影响包通过新的受管 Execute Outcome 验收，其余保留包的输入已重新核对有效
- **THEN** 新 Build Check 汇总当前有效的保留与修复完成凭证，Verify 运行当前有效输入所要求的真实检查，旧失败 Gate 不得作为成功依据

#### Scenario: 过期或未授权修复提交

- **WHEN** Host 使用旧 epoch、旧 claim、错误 invocation、缺失技能层消费证据或超出当前授权的能力提交修复结果
- **THEN** Runtime 保留现有拒绝与可纠正协议，不因修复重用放宽身份、Skill、权限或 Validator 校验
