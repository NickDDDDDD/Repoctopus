# delivery-governance Delta

## MODIFIED Requirements

### Requirement: Publication Receipt 证明交付完成

Delivery MUST 为每个业务仓和 Workspace 规格仓生成版本化 Publication item，并以顺序无关摘要组成唯一 Publication Receipt；Receipt MUST 绑定 Change、权威 runId、Delivery snapshot、Verify evidence、规格关闭摘要、repository、remote、base、head branch、published head OID、MR identity 和 provenance，且不得包含 lifecycle generation、凭据、MR body、完整 diff 或绝对路径。

#### Scenario: 所有发布项精确匹配

- **WHEN** 每个预期分支的远端 OID 和唯一 MR 的 head/base 都匹配已批准输入与同一 runId
- **THEN** Delivery 签发完整 Publication Receipt 供 Archive terminal Validator 使用

#### Scenario: 同一仓库包含多个业务 MR

- **WHEN** 已批准 Delivery snapshot 为同一 repository 登记多个有明确拆分理由的 MR
- **THEN** Receipt 保留每个 MR 的独立 item，且 canonical digest 不受查询返回顺序影响

#### Scenario: Receipt 来自另一 Run

- **WHEN** Archive Validator 收到 changeId 相同但 runId 不匹配的 Publication Receipt
- **THEN** Runtime 拒绝完成当前 Run并报告身份差异，不按文件时间、generation 或 MR 状态选择替代 Receipt

### Requirement: 外部发布动作以稳定身份恢复

每个 push 和 MR create-or-recover/create-or-adopt MUST 具有由 runId、Change、repository、base、head 与精确 head OID 组成的稳定身份；Publication 与 Specification Closure Journal 必须按 runId 和逻辑 publication item 定位。结果未知时必须先观察远端再决定复用、创建或阻断，不得盲重试或通过递增 generation 重发。

#### Scenario: 恢复查询发现唯一等价结果

- **WHEN** 另一短生命周期执行者从同一 runId Journal 发现唯一 MR 的 repository/base/head/head OID 与稳定身份一致
- **THEN** 它复用远端结果并补写同一逻辑 Receipt，无需原开发者或 Runner identity 在线

#### Scenario: 恢复查询发现歧义或不等价结果

- **WHEN** 查询得到多个候选，或唯一候选的 runId、base、head OID 不匹配
- **THEN** Runtime fail-closed 并报告差异，不覆盖远端、不自动分配替代发布或新 generation

## ADDED Requirements

### Requirement: Archive 在副作用前验证审批身份

Runtime MUST 在创建 specification closure Work 前验证有效 Design planning approval 的 repository/remote/source/target coordinates 与实时远端 Change branch，并在执行任何 push 或 MR 前重复同一只读校验。Design approval 的 OID 表示 Design 边界，不得被误当作 Build 后实现 OID；Archive 的最终 OID MUST 同时匹配实时远端 source branch 与 isolated closure candidate baseOid。若旧兼容实现已经产生 isolated closure 但尚未开始远端 publication，Runtime MAY 在同一 Run 中将冻结的错误 `remoteOid` 纠正为该共同证明的值；除该 OID 外的任何输入变化 MUST 被拒绝，且纠正后 MUST 创建新 epoch 的受管 publication Work。

#### Scenario: 错误 OID 在规格关闭前被拒绝

- **WHEN** Archive intent 的 Change branch OID 与有效 Design approval 或实时远端 source branch 不一致
- **THEN** Runtime 在创建 specification closure Work 前拒绝 preflight，且不产生 closure、push 或 MR 副作用

#### Scenario: 已关闭规格但尚未发布时纠正 OID

- **WHEN** 兼容升级恢复一个已有 isolated closure、没有 Publication Receipt 的 Archive，且 Design approval 的 branch coordinates 一致、实时远端 OID 等于 closure candidate baseOid，冻结输入仅该 OID 错误
- **THEN** Runtime 保持 runId 与 closure 不变，递增 checkEpoch并建立新的 delivery publication Work；业务交付、Evidence、policy、branch 名或 target 的变化均被拒绝

#### Scenario: 实时远端已越过本地 closure baseline

- **WHEN** publication 前只读校验发现实时 Change branch 已前进，旧 approval 与 isolated closure candidate 都不再匹配待发布实现，且尚未放行任何远端 publication 动作
- **THEN** Runtime 在同一 runId 内使旧 approval、Evidence、Archive input 与本地 closure candidate 失效，递增 checkEpoch回到 Design并要求重新批准和验证
