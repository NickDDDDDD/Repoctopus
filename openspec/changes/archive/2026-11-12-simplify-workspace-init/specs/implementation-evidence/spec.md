# Spec Delta

## MODIFIED Requirements

### Requirement: Evidence Profile 编译完整 Acceptance Coverage Plan

用于 Change Verify 的 Evidence Profile MUST 显式声明 required 节点覆盖的 Acceptance selector，并在执行任何节点前解析为绑定完整 Acceptance Set、Profile plan、仓库和配置摘要的不可变 coverage plan。缺失、未知、重复或仅由 optional 节点覆盖的 Acceptance MUST 阻断执行。Design 规格与 Tasks 冻结后，已配置的选定 Profile MUST 使用相同确定性 resolver 做只读 preflight，之后复核 Planning Manifest identity；最小配置尚未配置默认 Profile 时 MUST 记录待配置事实并保留原 Acceptance Set；显式指定不存在的 Profile MUST 返回可定位配置错误。此预检不得执行 Evidence 节点、创建 Attempt 或计算正式 Verify 仓库 fingerprint。

#### Scenario: Profile 没有覆盖 UI Acceptance

- **WHEN** Design Tasks 包含 UI Acceptance，但已选 Profile 的 required 节点没有覆盖它
- **THEN** Runtime 在建立 Build Work 前保持 Design，报告未覆盖的 Acceptance identity

#### Scenario: 共享 Profile 显式覆盖全部 Acceptance

- **WHEN** 已选 Profile 的 required 节点覆盖全部 Acceptance
- **THEN** Design preflight 解析每条 Acceptance 的节点映射
- **AND** Verify 继续将有效映射和真实执行输入固定进 Verification Input

#### Scenario: 选定 Profile 尚未配置

- **WHEN** 用户以最小 Workspace 配置开始开发，未显式指定 Profile 且默认 Profile 缺席
- **THEN** Runtime 允许进入 Build 并保留已确认的 Acceptance Set
- **AND** 进入正式验证前使用同一 resolver 编译已批准 Profile，缺失或覆盖不足时不执行节点、不发放 Gate

#### Scenario: preflight 期间 Planning Manifest 漂移

- **WHEN** Runtime 发现 Tasks 或其他受保护规划产物的 semantic digest 已变化
- **THEN** Runtime 丢弃此次预检并保持 Design，从当前规划重新观察

#### Scenario: coverage 只由 optional 节点声明

- **WHEN** 已选 Profile 的 coverage 只由 optional 节点声明
- **THEN** Design preflight 拒绝继续，不创建 Build Work，也不把 optional 结果提升为正式证据

#### Scenario: 修正 Profile 后重试 Design

- **WHEN** 已配置 Profile 的覆盖只来自 optional 节点或不完整，之后获批修正
- **THEN** Runtime 从原 Design checkpoint 重试预检并保留有效 Host Work
