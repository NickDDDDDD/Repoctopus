---
comet_change: preserve-build-completions-on-verify-repair
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-10-preserve-build-completions-on-verify-repair
status: final
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
3. 对闭包之外的包，只把其全部 Acceptance 均有当前 passed、verified、fresh/reused 机器 Receipt 支持的原 completion 列为候选保留；Host 自报 Evidence ID 和摘要不充当此证明。
4. 用既有包契约、依赖与输入观察进一步复核候选。任一已知漂移使对应包及其下游进入失效集合；观察失败返回 unavailable，不能当作内容相同或直接猜成全局漂移。

当 required 检查声明覆盖全部 Acceptance，推导出的全包范围是真实的声明影响，不是 fallback。测试中的四个独立包使用现有 Profile 的独立 coverage 与明确输入声明，不新增配置机制，也不承诺宽泛全仓检查失败时仍能保留其他包。

### 9. 对选定 Receipt 复核输入，复用既有依赖权威

EvidenceCoordinator 增加只读的修复事实读取和选定 Receipt 输入核对接口，复用现有 fingerprint observer、`evidenceReceiptInputCurrent` 及 `FileEvidenceInputProofs`，不另写文件摘要或依赖解释器：

- 校验 Receipt/Bundle 的规范化依赖和归属，并取得冻结 profile plan、node inputs 与当前 Run 授权下的仓库路径；
- 重新观察当前 node input snapshots，只比较选中 Receipt 及所需 producer 闭包的声明输入；不能先要求整个旧 Bundle fingerprint 不变，否则修复 A 会再次让独立 B 失效；
- 同时核对实际派生产物、producer manifest、输出存在性与 bytes，不能只重读 JSON 中保存的 digest；
- 只允许原来已经通过的机器 Receipt 支持保留；失效、未知或缺少依赖证明返回明确状态。

Receipt 的作用是证明原 package completion 仍有效，不把旧失败 Bundle 作为新成功 Gate。当前完整 Profile 的最终 Gate 仍由新的 Verify 输入、Attempt 与 Acceptance Trace 判定；确定性且依赖未变的机器 Receipt 继续按既有规则复用。

### 10. 复用同内容 Plan，并保护实际修复执行

Host 继续提交现有 schema 1 的 `build-plan-candidate { packages }`，不能自选范围或直接要求跳过 Work。Runtime 规范化候选，比较 run、Strategy、Binding、planning/task 语义、包契约、依赖和执行顺序；排除 revision/planId/digest 这些派生身份字段后与原 Plan 相同，则复用原 Plan 对象、revision 和 digest，不追加伪修订。真实内容变化才递增 revision。重复的 package key、缺失 Task/Acceptance 或越权 scope 仍由原 Validator 拒绝。

Plan 接受时对原 completion 作契约相同、范围允许和当前机器输入有效三重过滤，复核权限 envelope；没有扩大权限则不重复审批。通过既有 Plan Evidence 入口派发第一个没有有效完成凭证且依赖已满足的普通 Execute Work。修复完成时重新核对候选保留包：若当前修复使其声明输入漂移，追加有依据的局部失效并安排后续普通 Execute；观察不可用则保留原提交为可纠正/可恢复状态，不终态化已知外部执行或绕过校验。

Plan、Execute 与 Check 的受保护接受边界均将修复依据摘要和保留证明纳入验证输入，使用现有两阶段 Outcome acceptance 与 CAS 前复核，防止检查后、提交前漂移。新 Check 汇总原有效凭证和新修复凭证，使用当前 reviewer invocation；随后以新 Check 为前置，按当前批准 Task 与真实 Profile 输入创建新的 Verification Input，不改写原 Task 完成事实。修复 Execute 继续装载原方法技能，TDD 模式下保存本轮真实 RED/GREEN/regression，不用填写旧失败 Gate 的 ID 冒充新的 TDD 过程。

失败依据、范围与 Artifact 引用放入现有 Work packet 的 Runtime facts 上下文，并进入冻结 input digest；不增加方法 Skill 或人工技能消费豁免。Host 不能用旧 packet、旧 epoch 或自行填写的 completion 列表改变 Runtime 选择。未知范围保留已知失败和当前 checkpoint，返回有界阻断；重复 resume/next 不重做 Host review、不扩大影响范围、不自动建立另一轮 Attempt。

## 实施边界与协议影响

| 边界                                                 | 本次职责                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `domains/change-lifecycle`                           | 修复依据校验、范围推导、Plan 复用、包依赖闭包及合法转换；不得调用文件系统或 Provider           |
| `domains/runtime/recovery`                           | 表达 `revise-implementation` 的 Work 权威；保留其余恢复动作既有语义                            |
| `services/workflow-runs`                             | 从实际 Gate 装配事实，协调领域判断、受管执行及原子 checkpoint；不接受 Host 自选 phase/失效集合 |
| `services/evidence-coordinator` 与既有平台输入观察器 | 只读加载并核对选定机器证据，重读真实输入和产物；不执行产品修复                                 |
| Work packet、内置 Plan/Execute/Check Skill           | 交付当前修复依据及普通受管执行要求；保留技能装载和消费校验                                     |
| CLI/Desktop/OTLP                                     | 读取同一持久化状态，显示真实保留/失效数量和有界恢复原因，不自行计算新进度                      |

Build Protocol 使用 schema 3；原 schema 2 开发 checkpoint 在标准读取边界明确拒绝，不推断缺失的修复字段。Package Completion、Host 四种 Build result 的结构保持原 schema。已有 Observation/Decision 不新增并行存储层，只扩展当前 Action 契约；所有持久化新事实均校验形状与摘要。由新实现生成新的 composition/source 身份，不添加任意兼容前驱、双读、旧数据转换或自动复活旧 Run 的路径。第三方参考仅采用行为思路，代码及来源审计随实现更新。

## Risks / Trade-offs

- [局部范围被错误缩小] → 验证跨仓读取、共享依赖、真实全局变化和范围未知负例；缺证据不继续。
- [Plan 接受时保留成功但下一步又清空] → 生产路径跨 Plan/Execute/Check/Verify 分别断言原 completion identity 和调用次数，不能只断言最终 phase。
- [已完成 Task 导致修复 Execute 不可达] → 使用现有 Task ID 验证普通受管修复，禁止新增影子任务或手工改 checkbox。
- [修复代码改变其他包的输入] → 在接受修复、Check 和 Verify 前复核实际依赖；允许有依据的后续失效。
- [恢复重放或权限漂移] → 新进程公共 CLI 恢复矩阵，覆盖旧 epoch、错误 invocation、未授权分支和重复 next；保留原始失败及拒绝历史。
- [预发布协议变化] → 使用单一 Build Protocol schema 3，旧开发数据明确拒绝，不加迁移层，不承诺修复公司旧 Run。
- [规格、权威资料或接口契约冲突] → 停止依赖该冲突的实施，通过当前 Change 审查解决，不能自行择一或静默修补。

## 验证策略

1. 在当前生产路径建立真实必败 RED：四个可区分包中一个实现检查失败，捕获现有代码无条件使全部 completion 失效的行为；不能通过改 projection 或手写 Store 制造通过。
2. 领域与生产组合回归覆盖独立包保留、依赖传播、未知范围阻断、真实全局失效、计划/设计真实变化，以及 checkbox/等价提交不触发返工的既有保护。
3. 在全新多仓实验目录使用实际打包安装的公共 CLI 和受管 Host 完成四包验收，注入可观察的单包实现失败并修复；记录 Execute/检查调用次数、原/新 completion ID、Plan 身份、失败及通过 Gate；在失败后、计划接受后、单包修复后和 Check 后交替新进程 resume/next。
4. 重跑旧 epoch、Skill layer、claim、能力和分支授权拒绝回归；保持普通 Check/Verify 约束，保留范围正确而输入已漂移的负例。
5. 使用 Comet 控制本 Runtime 修复，独立审查当前 diff。完整阶段门禁使用 `.comet/check-policy.json` 的精确 `npm.cmd run build` 和 `npm.cmd run verify`；结果由真实 Guard 收据确认，报告只记录已经发生的检查。

基线已实际执行 `npx.cmd vitest run test/runtime-recovery.test.ts test/build-protocol-domain.test.ts`，34 项通过。本文件不把该基线冒充缺陷 RED/GREEN，也不预先宣称后续多仓验收、完整 Verify 或归档完成。

### 必须分别通过的矩阵

| 场景                                     | 必须观察的结果                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 四个独立包，A 的机器检查失败             | 返回 Plan，保留 B/C/D 原 completion ID；同内容 Plan 身份不变；只新增 A 的 Execute，随后 Check/Verify 通过 |
| B 依赖 A，C/D 独立                       | A/B 进入修复，C/D 保留；不能以 B 先前 passed 为由绕过依赖失效                                             |
| B 的机器输入还读取 A 文件/产物           | A 修复改变该输入后，B 必须失效或阻断；验证真实内容而非仅 metadata                                         |
| 全 Acceptance 覆盖的失败检查             | 有证据地扩大到全部包，不能为了保持进度错误保留                                                            |
| 未归属 finding、未知 node 或依赖不可观察 | 当前已知失败保留，稳定阻断，重复 next 不新增 review/Execute/Attempt                                       |
| 同内容 Plan 重提与真实候选变化           | 前者复用身份；后者新 revision，仍只保留契约和真实输入都有效的包                                           |
| 权限扩大、配置或 Design 真实漂移         | 原 authority 路径拦截，旧配置批准不授权新范围                                                             |
| Plan/Execute/Check 最终接受前输入变化    | 保护边界拒绝或精确重算，不先终态化 Outcome 再产生无法补交的半状态                                         |
| 四个修复边界的新进程 resume/next         | 原 Run、失败事实、范围和保留凭证稳定，已接受修复不重放                                                    |
| Git/checkbox 等价提交及旧提交拒绝        | 原输入归一化、身份、技能、能力、分支和 reviewer 校验继续生效                                              |

单元 RED/GREEN 后才扩大到生产组合与真实安装包；完整 `npm.cmd run verify` 留给同一 Comet Run 的正式 Verify Gate，避免把后续阶段检查写成阻止进入 Verify 的 Build 勾选条件。
