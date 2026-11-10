## MODIFIED Requirements

### Requirement: Verify 失败通过 Build Plan revision 返工

当 Verify 接受实现缺陷时，Runtime MUST 在同一 Run 保留失败 Evidence、递增 `checkEpoch` 并返回 Build Plan 复核及安排修复；只有计划内容实际变化时才形成对应 Plan revision。Runtime MUST 基于可核对的影响范围及实际输入依赖保留仍有效的 Task completion 和 Package completion；修复通过普通 Execute Work、新 Build Check 和 Verify 完成。单纯进入返工不得声明原计划发生漂移，不得重开全部 Task、创建 Repair lifecycle、特殊 Work kind 或并行修复权威。

#### Scenario: 缺陷只影响一个工作包

- **WHEN** Verify 的失败证据与当前已接受计划可证明缺陷只影响一个 Work Package，且批准规格和 Task 语义未改变
- **THEN** Runtime 仅使该包及受影响下游包的完成凭证失效，保留其他当前有效的完成凭证，通过 Plan 安排普通 Execute Work 修复并重新 Check 和 Verify
- **AND** 进入 Plan 时不得仅因阶段回退而把全部包进度归零；原计划内容未变时保留原计划语义身份

#### Scenario: 缺陷改变设计语义

- **WHEN** Verify finding 证明批准设计或 Task 语义本身无效
- **THEN** Runtime 按既有语义漂移规则返回 Design，不把设计修改伪装成普通实现修复，并按真实变化重新核对后继事实

#### Scenario: 无法确定最小影响范围

- **WHEN** 已持久化的失败证据、当前计划及依赖事实不足以安全界定修复范围
- **THEN** Runtime 返回可操作的阻断或 Human Decision，或使用 definition 显式声明的保守扩大策略并记录依据；不得仅因范围未知而静默失效所有包，也不得伪造最小范围并继续复用不可信凭证

#### Scenario: 真实全局失效

- **WHEN** 可核对的规划或依赖变化证明全部包均受影响
- **THEN** Runtime 可以使全部相关完成凭证失效，并记录全局影响依据，不能把保留进度优先于正确性

#### Scenario: 修复期间新进程恢复

- **WHEN** 在失败已持久化、修复计划已接受、修复包已完成或新 Check 已接受的边界退出，随后由新进程调用 resume 或 next
- **THEN** 同一 Run 恢复原失败证据、当前修复范围和仍有效的完成凭证，不重复审批有效配置、不重放已接受修复，也不再次扩大失效范围

## ADDED Requirements

### Requirement: Verify 返工原因必须与真实受影响权威一致

Verify 恢复记录 MUST 区分实现缺陷、真实计划变化、规划授权变化、证据漂移和基础设施不可用。重新进入 Plan 本身 MUST NOT 作为 Build Plan 身份改变的证据；实现缺陷恢复 MUST 关联实际失败 Evidence 与影响范围，保留既有失败记录，供 CLI、Trajectory 和遥测一致解释。

#### Scenario: 实现失败但计划未变

- **WHEN** Verify 检查发现实现缺陷，且当前批准规划与已接受 Plan 的语义身份仍然有效
- **THEN** 恢复记录说明实现修复原因，不把 `plan-constraint-changed` 或 `changedIdentities: build-plan` 作为无事实依据的固定标签

#### Scenario: 只有证据或环境问题

- **WHEN** 检查输入漂移或 Evidence Provider 暂时不可用，且没有证据证明实现或计划本身失败
- **THEN** Runtime 沿已有证据失效或基础设施重试路径处理，保留仍有效的 Build 完成事实，不通过包归零掩盖证据问题
