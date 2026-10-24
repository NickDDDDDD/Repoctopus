# Spec Delta

## MODIFIED Requirements

### Requirement: 多仓发布计划可恢复且幂等

Repoctopus MUST 按稳定顺序执行逐仓普通 push 和 MR create-or-recover/create-or-adopt，在每个动作后持久化精确结果，并在重试时先查询远端、跳过已确认成功且事实仍一致的动作；计划完成不要求任一 MR 合入。

#### Scenario: 中途发布失败

- **WHEN** 一个仓库的远端动作失败且此前仓库已有动作成功
- **THEN** Runtime 保存部分 Publication Intent/Receipt、停止后续动作并明确说明不存在跨仓事务回滚

#### Scenario: 从失败点继续

- **WHEN** 失败原因解决后恢复同一交付计划
- **THEN** Runtime 核对已完成动作并从第一个未确认发布项继续

#### Scenario: 规格关闭与业务发布使用同一工作树

- **WHEN** 已验证的 Specification Closure 把 Receipt 中的精确允许 diff 同步到同时承载业务源分支的工作树
- **THEN** Delivery 只把与 Closure Receipt 完全相等的路径集合排除在业务清洁范围之外；任一缺失路径、额外修改或越界路径都必须阻断发布

#### Scenario: MR 创建响应丢失

- **WHEN** 托管平台已经创建 MR 但 Runtime 未持久化成功响应
- **THEN** Adapter 以仓库、源分支、目标分支和精确 head OID 查询并复用唯一 MR identity

### Requirement: MR 由平台端口管理但不自动合入

Repoctopus MUST 通过平台无关端口创建或采用 MR，并读取完成精确发布与后续一致性审查所需的 head、base、state 和 identity；Runtime 与任何 Adapter 都不得执行 merge、force-push、rebase 或删除远端分支。

#### Scenario: GitHub 仓库发布

- **WHEN** 已批准计划为 GitHub 仓库创建或采用 MR
- **THEN** GitHub Adapter 使用托管平台 API 完成动作并返回稳定 MR identity、base、head branch 和 head OID

#### Scenario: MR 已由人合入

- **WHEN** 人已经 push 经过验证的 head，并在 Runtime 恢复前创建甚至合入同 repository/base/head/head OID 的唯一 MR
- **THEN** Runtime 采用该 MR 并记录 `human-created` provenance，不要求 MR 由原 Agent 或 Runner 创建，也不把合入状态作为额外完成条件

#### Scenario: 请求自动合入

- **WHEN** 工作流或调用方要求 Repoctopus 执行 merge
- **THEN** Runtime 拒绝该动作并保持人工合入边界

### Requirement: 最终 Change MR 只在规格关闭后创建

Repoctopus MUST 在同一 Change Run 的 Archive 阶段确认 Verify Evidence 有效、主规格同步且 Change 已归档后，通过平台端口创建或幂等采用一个最终 Change MR；该 MR 只承载允许的规格、验证和关闭结果，创建后不等待合入。

#### Scenario: Change 仍在实施

- **WHEN** 当前实现没有满足 Verify Gate 或规格关闭后置条件
- **THEN** Runtime 保持当前 Build、Verify 或 Archive 状态且不创建最终 Change MR

#### Scenario: Change 已完成规格关闭

- **WHEN** Archive Work 取得有效规格关闭结果且业务发布项已准备
- **THEN** Runtime 发布登记的 Change 分支、创建或采用最终 Change MR，并把精确 item 写入 Publication Receipt

#### Scenario: 最终 MR 创建响应丢失

- **WHEN** 平台已经创建最终 Change MR 但 Runtime 没有持久化成功响应
- **THEN** Adapter 按仓库、源分支、目标分支和精确 head OID查询并复用唯一匹配 MR，不创建重复 MR

#### Scenario: 最终 MR 差异包含业务代码

- **WHEN** 最终 Change MR 相对目标分支包含允许规格、验证和关闭路径之外的修改
- **THEN** Archive Guardrail 拒绝发布并保留可定位的越权路径诊断

## ADDED Requirements

### Requirement: Publication Receipt 证明交付完成

Delivery MUST 为每个业务仓和 Workspace 规格仓生成版本化 Publication item，并以顺序无关摘要组成唯一 Publication Receipt；Receipt MUST 绑定 Change/generation、Delivery snapshot、Verify evidence、规格关闭摘要、repository、remote、base、head branch、published head OID、MR identity 和 provenance，且不得包含凭据、MR body、完整 diff 或绝对路径。

#### Scenario: 所有发布项精确匹配

- **WHEN** 每个预期分支的远端 OID 和唯一 MR 的 head/base 都匹配已批准输入
- **THEN** Delivery 签发完整 Publication Receipt 供 Archive terminal Validator 使用

#### Scenario: 同一仓库包含多个业务 MR

- **WHEN** 已批准 Delivery snapshot 为同一 repository 登记多个有明确拆分理由的 MR
- **THEN** Receipt 保留每个 MR 的独立 item，且 canonical digest 不受查询返回顺序影响

### Requirement: 外部发布动作以稳定身份恢复

每个 push 和 MR create-or-recover/create-or-adopt MUST 具有由 Change、generation、repository、base、head 与精确 head OID 组成的稳定身份；结果未知时必须先观察远端再决定复用、创建或阻断，不得盲重试。

#### Scenario: 恢复查询发现唯一等价结果

- **WHEN** 另一短生命周期执行者发现唯一 MR 的 repository/base/head/head OID 与稳定身份一致
- **THEN** 它复用远端结果并补写同一逻辑 Receipt，无需原开发者或 Runner identity 在线

#### Scenario: 恢复查询发现歧义或不等价结果

- **WHEN** 查询得到多个候选，或唯一候选的 base/head OID 不匹配
- **THEN** Runtime fail-closed 并报告差异，不覆盖远端、不自动分配替代发布

## REMOVED Requirements

### Requirement: 合入后状态由事件和主动核对共同推进

**Reason**: Archive 不再等待合入，也不接收平台事件；MR 后续状态只由短生命周期一致性审查按需读取。

**Migration**: 使用 Publication Receipt 作为 Change 完成证明，并以 `change reconcile` 检查后续 head/state 变化。
