# Spec Delta

## MODIFIED Requirements

### Requirement: Change 生命周期使用固定五阶段

内置 Change lifecycle MUST 按 `Open → Design → Build → Verify → Archive` 的顺序推进，并只允许定义声明的自循环或回退；分支发布、MR 创建和规格关闭 MUST 作为 Archive 工作表达，不得增加独立 Deliver、Post-merge 或 Consistency 阶段。MR 合入状态不得成为 Archive 等待条件或 Change Run 终态前置事实。

#### Scenario: Design 尚未批准

- **WHEN** 当前 Change 缺少有效规划批准且调用方请求开始 Build
- **THEN** Runtime 拒绝跨阶段并保持 Design，同时返回缺失的校验或人工决定

#### Scenario: Business MR 等待合入

- **WHEN** Archive 已关闭规格并取得覆盖全部业务仓和规格仓的有效 Publication Receipt，但 Business MR 仍待人工合入
- **THEN** Change Run 进入 `completed`，不等待任一 MR 合入且不创建 Deliver、Post-merge 或 Consistency 阶段

## ADDED Requirements

### Requirement: Archive 终态绑定精确发布证明

Change Run MUST 只在 Archive 的 OpenSpec 关闭结果通过后置验证，且全部预期业务发布项和最终规格发布项都具有 repository、base、head、published head OID 与唯一 MR identity 的完整 Publication Receipt 后进入 `completed`；MR 的 open、merged 或 closed 状态不得改变该判断。

#### Scenario: MR 已创建但尚未合入

- **WHEN** 全部发布项都精确匹配远端，Business MR 和最终 Change MR 仍处于 open
- **THEN** Runtime 接受 Publication Receipt 并完成同一 Change Run

#### Scenario: 发布项缺少精确远端身份

- **WHEN** 任一预期仓库没有可验证的 published head OID 或唯一匹配 MR
- **THEN** Runtime 保持 `phase=archive` 并阻断完成，返回缺失或歧义的发布项

#### Scenario: 已完成 Change 的 MR 后续变化

- **WHEN** 一致性审查发现业务 MR 的 head 或 state 在 Change Run 完成后变化
- **THEN** 系统保留原 Run 和 Publication Receipt，只创建独立审查事实或后续 Change，不重开或回退原 Run

### Requirement: Tracked Task 只表达 Build 阶段可完成工作

Repoctopus MUST 只把无需未来 Verify、Archive、MR 合入、发布或一致性审查事实即可证明完成的官方 Tasks checkbox 映射为 Build Work；跨阶段步骤必须由 lifecycle definition 的固定 Work、Validator 或非跟踪 Workflow follow-up 表达。

#### Scenario: Tasks 包含未来阶段 checkbox

- **WHEN** 规划清单把 Verify 报告、规格归档、MR 发布或后续一致性审查写成 tracked checkbox
- **THEN** Design 校验阻断批准并要求把该步骤改为生命周期 Work 或非跟踪说明

#### Scenario: Build 任务包含当前可执行验收

- **WHEN** checkbox 的实现与验收命令都能在 Build 阶段当前输入上完成
- **THEN** Runtime 将其映射为 Build Work，并由对应 Validator 决定是否完成
