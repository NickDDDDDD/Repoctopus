# Comet Design Handoff

- Change: preserve-build-completions-on-verify-repair
- Phase: design
- Mode: compact
- Context hash: 1ca3ecf5f425531c74b45ca987fba63cbe62d562e7259cd9700b36fcea17dfda

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/preserve-build-completions-on-verify-repair/proposal.md

- Source: openspec/changes/preserve-build-completions-on-verify-repair/proposal.md
- Lines: 1-33
- SHA256: 7978f5ede4ffb166ff5086a68cc37e6f5ece7ebff3b43d4586932017210bcba1

```md
# Proposal

## Why

Verify 的真实实现失败当前会把全部 Work Package 无条件加入失效集合，即使缺陷只影响一个独立包，也会清空当前有效 package completions 并重新计划。现有规格已经要求保留未受影响的完成事实，但生产 Verify 路径没有兑现；同时固定的 `plan-constraint-changed` 标签把“需要修复实现”混同为“计划身份已经改变”，妨碍团队诊断返工原因。

## What Changes

- 保留同一 Run 中 Plan → Execute → Check → Verify 的返工顺序，将重新进入 Plan 解释为复核并安排本轮修复，不无条件宣告原 Build Plan 发生漂移。
- 由 Runtime 使用失败 Evidence、当前已接受计划及真实依赖校验影响范围，保留仍有效的包完成凭证；需要修复的包及受影响的下游包通过普通受管 Execute Work 重新验收。
- 计划内容确实改变时才产生对应 Plan revision；规格或设计语义改变仍走已有 Design 权威。无法证明影响范围时明确阻断，或采用显式、可审计的保守扩大策略，不静默清空全部包。
- 保留 OpenSpec Task IDs、完成语义、有效审批、BuildStrategy 和兼容的 ExecutionBinding；新 Build Check 与 Verify 仍须消费当前真实证据。旧 epoch、旧输入或未经受管执行的 Outcome 不得借修复被接受。
- 用生产组合和独立多仓公共 CLI 场景证明局部修复、依赖传播、未知范围、真实全局失效及跨进程恢复。现有 Trajectory/OTLP 返工记录应如实反映原因和保留/失效范围。

本次是从失败 Verify 到受管修复并重新验证的一个完整垂直切片。不新增 Repair lifecycle、特殊 Work kind、第五份规划文档、人工维护的 finding→Task 关联表或团队配置开关；不把普通 checkbox/commit 重新引入失效身份。不恢复公司现场已经失效的旧凭证，不承诺旧开发协议兼容或自动迁移。本次不发布 Release、不整合 Dashboard 分支，也不处理其他三个活动提案。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：明确 Verify 修复规划与 Plan 身份漂移的区别，约束局部失效、保留事实、保守扩大及同一 Run 恢复。
- `managed-work-execution`：约束普通 Plan/Execute/Check 如何承载修复，验证可保留 completion 的真实依赖及新修复执行的有效性。

## Impact

- 生产边界：`WorkflowRuns` 负责失败分类与生命周期协调，Build Protocol 负责计划、依赖和完成凭证；EvidenceCoordinator 继续负责机器证据及其输入权威，Cordis 组合和 Host 端口保持现有职责。
- 可能涉及 Build invalidation、修复执行输入、Checkpoint、Validator、投影及测试；结构化字段或协议身份的必要变化在 Design 明确，并按预发布项目规则拒绝不支持的旧数据，不增加双读或迁移分支。
- 验收继续使用真实受管 Host、公共 CLI、精确 check-policy argv、独立审查及完整 Verify。基线 `f47eabf` 上已有 34 项 Build Protocol/Recovery 测试通过，这不代表本次缺陷已有 RED/GREEN。
- 参考固定 Comet 0.5.1（`35c9860b77b42bafa0c2d80d8d695889f888a924`），并只读核对 0.5.2 的 Classic full 失败路由。Comet 提供回 Plan 安排修复和保留已有任务事实的模式；它没有与本产品同构的多仓 package completion 失效算法。本次采用思路，不引入 SDK、第三方源码或新依赖，不变更固定上游版本及许可证。

```

## openspec/changes/preserve-build-completions-on-verify-repair/design.md

- Source: openspec/changes/preserve-build-completions-on-verify-repair/design.md
- Lines: 1-155
- SHA256: 6cc4c6af69a7790c72db8f3ea9cccf5e4b0a3f987915644c73e38009f02418d4

[TRUNCATED]

```md
---
comet_change: preserve-build-completions-on-verify-repair
role: technical-design
canonical_spec: openspec
---

# Design

## Context

目标与非目标见 [proposal.md](proposal.md)。Open 已获批准；本文件是在同一设计文档上深化的正式候选，尚待 Design 审批，没有实施产品代码。本轮没有修改已批准的 delta specs 或十个稳定 Task IDs。

已读生产路径：`services/workflow-runs.ts` 的 `createVerifyFailureContinuation` 对实现失败直接传入当前 Plan 的全部 package IDs，`applyVerifyRecovery` 又无条件报告 `build-plan` 漂移；Build Protocol 随后从当前有效集合移除失效包的完成凭证。底层 `createBuildInvalidation` 已有依赖传播与保留 completion 的能力，但不能仅删除这一处全量参数：修复必须有普通 Execute 的真实可达路径，保留凭证也须通过实际输入复核。

Comet 固定基线 0.5.1 与只读核对的 0.5.2 Classic full 均在 Verify 失败后进入 `full.build.plan`，其转换不重开全部 OpenSpec Tasks；执行规则允许复用仍有效的原计划与证据。源码参考：

- https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/comet-classic/classic-sdk-application.ts
- https://github.com/rpamis/comet/blob/0.5.2/domains/comet-classic/classic-sdk-application.ts#L2698
- https://github.com/rpamis/comet/blob/0.5.2/domains/comet-classic/classic-transitions.ts#L147
- https://github.com/rpamis/comet/blob/0.5.2/assets/skills-zh/comet-classic/reference/sdk-methods.md#L50

这只支持“返工入口不等于否定全部既有完成事实”的采用结论。Comet Classic 没有本产品同构的跨仓 Package Completion 模型，不能把下述依赖算法宣称为直接照搬其实现。公司原失败 Run 的 Attempt、Bundle 和节点日志不可从本环境读取，本 Change 不把此前 checkbox 推测当作已验证根因。

进一步核对：现有 `continue-build` 严格表示同一个 Build Work、同一 epoch 下增加 attempt；不能把 Verify 到 Build 的新一轮修复硬塞入该语义。固定 Comet 0.5.1 Native 的 `native-sdk-verify-decision.ts` 已把 `revise-implementation` 与 `retry-verifier` 分开。本设计只采用这种恢复分类思路与名称，不引入 Native SDK、Child workflow 或其执行实现。

源码：https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/comet-native/native-sdk-verify-decision.ts

## Goals / Non-Goals

**Goals:** 保留当前五阶段和 Build 内部协议；在同一 Run 完成真实失败→修复计划→普通 Execute→Check→Verify，证明无关包未被重放、受影响包未被错误复用。

**Non-Goals:** 新的 Repair lifecycle、Work kind、finding 关联配置、影子 Tasks/计划权威、后台 Runner、旧格式双读或历史凭证自动复活；本次不发布 Release。

## Decisions

### 1. 保留 Plan 入口，分开修复安排与计划身份改变

Verify 失败事实必须关联实际 Attempt/Bundle/Gate。实现缺陷进入当前 Plan 的修复复核，既有批准规划、BuildStrategy 与兼容 Binding 保留；只有真实 Plan 内容变化才产生对应 revision 和 Plan 漂移。Evidence 输入漂移及环境不可用继续走既有分类，不能混成实现修复。

备选：继续全量清空最简单，但会放大局部缺陷并掩盖原因；无条件保留全部 completion 会接受不再有效的证据。采用 Runtime 基于事实的选择性保留，两者都不作为默认捷径。

### 2. 优先利用现有证据与计划关系确定范围

利用当前失败的机器 Evidence、已有 Acceptance coverage/Trace、Plan 的 acceptance/task/package 关系和包依赖计算受影响集合；不得仅凭失败节点所在仓库或 Host 自报列表推断安全范围，也不要求团队再维护一张关联表。范围经 Runtime 校验后才影响当前有效 completion 集合。本次对无法界定的范围选择明确阻断，不新增保守策略开关或审批类型；失败检查本身覆盖全部 Acceptance 时，可以根据既有声明证明全局影响并全量重验。

### 3. 普通受管执行承载修复

复核后的 Plan 必须能派发修复包的普通 Execute Work，即使对应 OpenSpec Task 已完成。现有 Execute 选择依据是缺少有效 package completion 的包，不是 pending Task；因此保留这一机制，精确退役受影响包的凭证即可使其重新可执行，不重开 checkbox。普通 Execute 使用已冻结的 autonomous/subagent 协调方式与 TDD 配置；本次开发自身拟采用 autonomous + TDD + thorough，等待用户明确确认。

### 4. 保留意味着重新核对其依赖仍有效

Package ID 相同不足以证明旧 completion 可复用。包契约、真实输入、依赖包、授权与有效执行身份仍需按现有权威检查；修复导致某个候选保留包的依赖变化时继续向下游失效。新的 Build Check 与 Verify 仍校验当前完整完成集合及当前输入，不把旧失败 Gate 或旧 epoch Outcome 提升为成功事实。

### 5. 保持现有架构及观测边界

Engine/Lifecycle 只执行合法转换和 Journal 事务；Cordis `WorkflowRuns` Service 协调已校验事实，Build Protocol 计算计划与 completion 的有效性；EvidenceCoordinator 负责机器输入、Receipt、Bundle 和 Gate，不能替 Host 执行实现修复；平台 Git/Store/Host Adapter 不推断目标 phase。CLI/Desktop/OTLP 消费同一持久化事实。沿现有事件记录实际失败、影响/保留数量、修复 Work 和新检查，不把原始错误消息、路径或 Token 放入指标标签。

### 6. 修复依据保存在现有 Build Protocol 中

`BuildProtocolState` 升为单一当前 schema 3，增加必需但可为 null 的 `verifyRepair`。该结构没有自己的阶段、轮次计数或工作流，只保存当前修复所依据的不可变事实：

- source：失败 Attempt、Bundle、原 Verification Input digest、源 epoch 与原 Plan digest；
- scope：已证明的失败 node/Acceptance IDs、初始受影响包和依赖闭包，以及既有 `BuildInvalidation.digest`；
- retention：候选保留的原 completion ID、包契约 digest 及支持其当前有效性的机器 Receipt IDs；
- digest：以上事实的规范化内容摘要，用于当前 Work input 和磁盘完整性检查，不新增 generation 或全局身份注册表。

沿用原 `PackageCompletionEvidence` schema 1，保留项对象逐字节不变；不重签、改写或伪造原 invocation。Runtime 需要证明这些历史凭证在本次输入下仍可用，而不是声称它们来自本次修复。`verifyRepair` 随已保护的转换与 checkpoint 原子保存，成功 Verify 接受后退出当前上下文；历史失败及处置保留在追加式 Trajectory 中。再次 Verify 失败以新失败事实建立下一份依据，仍使用既有 epoch/attempt 机制。

### 7. 使用独立恢复分类表达实现修订

在既有 `RecoveryAction` 增加内部 `revise-implementation`，归 Work 权威，原因使用已有 `implementation-failed`，改变的身份是受影响的 completion，而非无事实依据的 `build-plan`。它只能在当前 Verify、已冻结 Verification Input、当前失败 Gate 和完整修复依据全部匹配时，通过现有 `verify.failed` 转换创建下一 epoch 的普通 `build.plan` Work。

这不是新 phase、Skill、公共 CLI 命令或 Work kind。现有 `continue-build` 对同一 Build Work 的有界 retry 保持原约束；`revise-plan` 仍用于真正的计划约束变化；`revise-design`、证据失效与基础设施重试继续由既有最高受影响权威决定。恢复记录的类型集合不再把包修复描述成 Plan 漂移，具体包实例范围仍以修复依据为准，不能按类型标签全量清空。

### 8. 失败范围和保留证明的生成规则

新增领域纯函数负责范围推导，由 Service 提供实际读取且校验过的事实：

1. 核对失败 Bundle、Attempt binding、Gate、Verification Input、Plan、Task revision 与 composition，拒绝不属于当前 Run/Work 的事实。
2. 从可信的 required 失败节点及可证明由它阻断的下游节点，沿冻结 Acceptance coverage/Trace 找到受影响 Acceptance，再映射已接受 Plan 的包，扩展 Plan `dependsOn` 闭包。未知 node、缺失关联、无法解释的 missing Trace 或未归属的阻断性 finding 返回 `scope-unavailable`。

```

Full source: openspec/changes/preserve-build-completions-on-verify-repair/design.md

## openspec/changes/preserve-build-completions-on-verify-repair/tasks.md

- Source: openspec/changes/preserve-build-completions-on-verify-repair/tasks.md
- Lines: 1-26
- SHA256: 532da6a81ca63a15fb60d33e2725af91757d6572b45546eec230e20f5c0549d7

```md
# Tasks

## 1. 局部 Verify 修复垂直切片

- [ ] 1.1 在领域和生产 Verify 路径建立真实 RED：四个可区分的已完成包中一个实现检查失败，断言原代码错误地失效全部 completion，保存失败命令和原因；回归不能只比较最终 projection。 <!-- comet-task:445e47c3-f66a-4390-9a76-a9b8fbdd81e0 -->
- [ ] 1.2 修正 Verify 失败分类及修复 Plan 复核，使用现有失败 Evidence、Acceptance/Plan 关系验证范围，保留真实输入仍有效的独立包凭证；以局部失败回归转绿及原 Plan 语义身份保持为验收。 <!-- comet-task:da090b63-9a31-43a1-b82c-805a0a29be61 -->
- [ ] 1.3 让已完成 Task 的实现修复通过普通受管 Execute、新 Check 和 Verify 完成，沿用 Task IDs 及有效配置，不新增 Repair Work kind 或影子任务；以同一 Run 真正执行单包修复、其余包 Execute 计数不增加为验收。 <!-- comet-task:1532b36d-0809-4d7b-974f-36a60807a939 -->
- [ ] 1.4 将实际失败、影响/保留范围、修复 Work 与新检查接入既有 Trajectory/OTLP 记录，补齐本组对应设计说明与回归；验收恢复原因不虚报 Plan 漂移、事件可关联且指标不包含高基数或敏感原文。 <!-- comet-task:7872e6c7-872a-490c-817e-4b87cf035268 -->

## 2. 依赖与权威边界

- [ ] 2.1 覆盖包依赖传播、跨仓读取、无法证明范围的阻断及有依据的真实全局失效；验收仅受影响闭包失效，未知范围不伪造最小集合，真实全局变化不错误保留凭证。 <!-- comet-task:732baf3b-8ef1-46e1-8987-4f3c1b33556c -->
- [ ] 2.2 复核保留 completion 的实际包契约、依赖、输入及授权，覆盖真实 Plan/Design 变化和修复期间的输入漂移；验收沿相应权威恢复，等价 checkbox/commit 提交的既有保护仍通过。 <!-- comet-task:1cb4397d-0cba-43f3-9f72-91198bc0a336 -->
- [ ] 2.3 验证旧 epoch、错误 invocation、缺失 consumed layers、能力或分支越权、重复或畸形 Outcome 的拒绝；验收原始失败/拒绝历史保留，修复不能绕过 Host、Validator、Build Check 或 Verify。 <!-- comet-task:22fddfd1-41fc-49bb-8658-a6ffc9ccc628 -->

## 3. 恢复与交付验证准备

- [ ] 3.1 在失败持久化、修复 Plan 接受、单包修复完成及新 Check 接受后分别退出并以新进程 resume/next；验收同一 Run、稳定保留凭证、正确修复进度和无重复 Execute，不重复审批有效配置。 <!-- comet-task:ae91bbe7-9ad9-48b4-8239-2ccc013b261e -->
- [ ] 3.2 使用本次实际打包安装的公共 CLI 在全新多仓实验目录完成四包局部失败→修复→Check→Verify 场景，保存节点/Execute 次数、Plan/completion/Gate 身份及负例；不得以源码内部调用或手改 Store 冒充安装包验收。 <!-- comet-task:ca51bd44-ea75-4e37-b880-c464bde108bb -->
- [ ] 3.3 完成当前实现的独立审查，整理真实 RED/GREEN、相关回归和多仓安装包回执，固定验证报告及 check-policy 的完整命令入口，确保后续 Comet Verify 可以实际执行；此勾选不宣称后续完整阶段检查、归档、CI 或发布已经完成。 <!-- comet-task:996f4530-3aae-4e0a-8671-23d51e0ff58b -->

## Workflow follow-up

- 当前 Open 产物经用户审查后进入正式 Design；深化同一 design.md 并取得正式设计及本 Change 执行配置批准后才能实施。
- Build 任务及检查就绪后，同一 Comet Run 实际执行精确 `npm.cmd run build` 与 `npm.cmd run verify`；完整检查通过前不得归档。
- 完整 Verify 与独立审查合格后，再核对归档及交付授权；本次不发布 Release，不覆盖旧实验 Store，也不修改其他活动 Change。

```

## openspec/changes/preserve-build-completions-on-verify-repair/.openspec.yaml

- Source: openspec/changes/preserve-build-completions-on-verify-repair/.openspec.yaml
- Lines: 1-2
- SHA256: 309e6764c826c3fc6250bcce33b56b7e44adebafc76c7df25f058663d6de4299

```md
schema: spec-driven
created: 2026-11-09

```

## openspec/changes/preserve-build-completions-on-verify-repair/specs/change-lifecycle/spec.md

- Source: openspec/changes/preserve-build-completions-on-verify-repair/specs/change-lifecycle/spec.md
- Lines: 1-47
- SHA256: af5022512b472bdcdfe33d1a16fe263db83c1f776b4ab92822d17dae334d82aa

```md
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

```

## openspec/changes/preserve-build-completions-on-verify-repair/specs/managed-work-execution/spec.md

- Source: openspec/changes/preserve-build-completions-on-verify-repair/specs/managed-work-execution/spec.md
- Lines: 1-41
- SHA256: a2040b795fb152e46fffdbd252e3844bace318ba12bb1400127ab2654e6a6a5a

```md
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

```
