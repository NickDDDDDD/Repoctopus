# implementation-evidence Delta

## MODIFIED Requirements

### Requirement: Evidence Profile 编译完整 Acceptance Coverage Plan

用于 Change Verify 的 Evidence Profile MUST 显式声明 required 节点覆盖的 Acceptance selector，并在执行任何节点前解析为绑定完整 Acceptance Set、Profile plan、仓库和配置摘要的不可变 coverage plan；缺失、未知、重复或仅由 optional 节点覆盖的 Acceptance 必须阻断执行。相同的确定性 coverage resolver MUST 在 Design 规格与 Tasks 冻结后、创建 Design Human Decision 或 Build Work 前执行只读 preflight；该 preflight 不得运行 Evidence 节点、创建 Attempt 或计算正式 Verify 仓库 fingerprint。preflight 完成后、写入审批请求前 MUST 重新核对 Planning Manifest identity，防止预检与获批内容来自不同版本。

#### Scenario: Profile 没有覆盖 UI Acceptance

- **WHEN** Design Tasks 包含 UI 行为 Acceptance，但 Profile 只有未声明覆盖该 Acceptance 的 typecheck 节点
- **THEN** Runtime 在建立 Build Work 和运行 typecheck 前保持 Design，并报告未覆盖的 Acceptance identity

#### Scenario: 共享 Profile 显式覆盖全部 Acceptance

- **WHEN** required 节点使用 `*` selector 且 Profile、配置和 Acceptance Set 可被固定
- **THEN** Design preflight 解析出每条 Acceptance 到节点的显式映射，随后 Verify 把同一映射连同仓库和执行输入固定进 Verification Input

#### Scenario: coverage 只由 optional 节点声明

- **WHEN** 每条 Acceptance 都只能匹配 optional Evidence 节点
- **THEN** Design preflight fail closed，不创建 Build Work，也不把 optional 结果提升为正式门禁

#### Scenario: 修正 Profile 后重试 Design

- **WHEN** Design 因 coverage 不完整而阻断，团队通过正常共享配置变更补齐 selector
- **THEN** Runtime 从原 Design checkpoint 重新执行只读 preflight；不得要求重做已完成 Host Work、手改 Store 或伪造 Evidence Receipt

#### Scenario: preflight 期间 Planning Manifest 漂移

- **WHEN** Runtime 完成 coverage 解析后发现 Tasks 或其他受保护规划产物的 semantic digest 已变化
- **THEN** Runtime 保持 Design 并丢弃该次预检结果，不创建 Design Human Decision；下一次推进重新观察当前规划

## ADDED Requirements

### Requirement: Acceptance coverage 使用单一确定性解析权威

Repoctopus MUST 用同一个纯领域 resolver 处理 Design preflight 和 Verification Input 的 Acceptance selector 语义、required 节点过滤、稳定排序、Acceptance Set hash 与诊断。编排层、项目接入层和 Agent MUST NOT 复制或放宽该解析规则。

#### Scenario: 相同输入在两个阶段解析

- **WHEN** Design preflight 与 Verify 使用相同 Tasks 和 Evidence Profile plan
- **THEN** 两者得到相同的 Acceptance Set、节点映射和稳定摘要

#### Scenario: selector 在 Design 后变为未知

- **WHEN** Profile selector 不再匹配冻结的 Task、Requirement 或 Acceptance identity
- **THEN** Resolver 在副作用前返回同一类未知 selector 诊断，不能由 Verify 静默解释成通配覆盖

