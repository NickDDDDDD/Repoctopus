# Design

## Context

目标与非目标见 [proposal.md](proposal.md)。本文件是 Open 阶段的高层技术方案，正式 Design 阶段继续在同一文件深化并审查。

已读生产路径：`services/workflow-runs.ts` 的 `createVerifyFailureContinuation` 对实现失败直接传入当前 Plan 的全部 package IDs，`applyVerifyRecovery` 又无条件报告 `build-plan` 漂移；Build Protocol 随后从当前有效集合移除失效包的完成凭证。底层 `createBuildInvalidation` 已有依赖传播与保留 completion 的能力，但不能仅删除这一处全量参数：修复必须有普通 Execute 的真实可达路径，保留凭证也须通过实际输入复核。

Comet 固定基线 0.5.1 与只读核对的 0.5.2 Classic full 均在 Verify 失败后进入 `full.build.plan`，其转换不重开全部 OpenSpec Tasks；执行规则允许复用仍有效的原计划与证据。源码参考：

- https://github.com/rpamis/comet/blob/35c9860b77b42bafa0c2d80d8d695889f888a924/domains/comet-classic/classic-sdk-application.ts
- https://github.com/rpamis/comet/blob/0.5.2/domains/comet-classic/classic-sdk-application.ts#L2698
- https://github.com/rpamis/comet/blob/0.5.2/domains/comet-classic/classic-transitions.ts#L147
- https://github.com/rpamis/comet/blob/0.5.2/assets/skills-zh/comet-classic/reference/sdk-methods.md#L50

这只支持“返工入口不等于否定全部既有完成事实”的采用结论。Comet Classic 没有本产品同构的跨仓 Package Completion 模型，不能把下述依赖算法宣称为直接照搬其实现。公司原失败 Run 的 Attempt、Bundle 和节点日志不可从本环境读取，本 Change 不把此前 checkbox 推测当作已验证根因。

## Goals / Non-Goals

**Goals:** 保留当前五阶段和 Build 内部协议；在同一 Run 完成真实失败→修复计划→普通 Execute→Check→Verify，证明无关包未被重放、受影响包未被错误复用。

**Non-Goals:** 新的 Repair lifecycle、Work kind、finding 关联配置、影子 Tasks/计划权威、后台 Runner、旧格式双读或历史凭证自动复活；本次不发布 Release。

## Decisions

### 1. 保留 Plan 入口，分开修复安排与计划身份改变

Verify 失败事实必须关联实际 Attempt/Bundle/Gate。实现缺陷进入当前 Plan 的修复复核，既有批准规划、BuildStrategy 与兼容 Binding 保留；只有真实 Plan 内容变化才产生对应 revision 和 Plan 漂移。Evidence 输入漂移及环境不可用继续走既有分类，不能混成实现修复。

备选：继续全量清空最简单，但会放大局部缺陷并掩盖原因；无条件保留全部 completion 会接受不再有效的证据。采用 Runtime 基于事实的选择性保留，两者都不作为默认捷径。

### 2. 优先利用现有证据与计划关系确定范围

利用当前失败的机器 Evidence、已有 Acceptance coverage/Trace、Plan 的 acceptance/task/package 关系和包依赖计算受影响集合；不得仅凭失败节点所在仓库或 Host 自报列表推断安全范围，也不要求团队再维护一张关联表。范围经 Runtime 校验后才影响当前有效 completion 集合。无法界定范围时 fail closed，或使用已有 definition 中显式、带依据的保守扩大策略；真正全局影响允许全量重验。

### 3. 普通受管执行承载修复

复核后的 Plan 必须能派发修复包的普通 Execute Work，即使对应 OpenSpec Task 已完成。保留 Task ID 与批准语义，不把 checkbox 当执行调度权威。当前失败事实、修复范围、工作输入及已接受 completion 的关联必须能够在 Checkpoint 中恢复；具体数据形状和所需协议版本由正式 Design 核对，禁止临时兼容旧格式或篡改 Store。

### 4. 保留意味着重新核对其依赖仍有效

Package ID 相同不足以证明旧 completion 可复用。包契约、真实输入、依赖包、授权与有效执行身份仍需按现有权威检查；修复导致某个候选保留包的依赖变化时继续向下游失效。新的 Build Check 与 Verify 仍校验当前完整完成集合及当前输入，不把旧失败 Gate 或旧 epoch Outcome 提升为成功事实。

### 5. 保持现有架构及观测边界

Engine/Lifecycle 只执行合法转换和 Journal 事务；Cordis `WorkflowRuns` Service 协调已校验事实，Build Protocol 计算计划与 completion 的有效性；EvidenceCoordinator 负责机器输入、Receipt、Bundle 和 Gate，不能替 Host 执行实现修复；平台 Git/Store/Host Adapter 不推断目标 phase。CLI/Desktop/OTLP 消费同一持久化事实。沿现有事件记录实际失败、影响/保留数量、修复 Work 和新检查，不把原始错误消息、路径或 Token 放入指标标签。

## Risks / Trade-offs

- [局部范围被错误缩小] → 验证跨仓读取、共享依赖、真实全局变化和范围未知负例；缺证据不继续。
- [Plan 接受时保留成功但下一步又清空] → 生产路径跨 Plan/Execute/Check/Verify 分别断言原 completion identity 和调用次数，不能只断言最终 phase。
- [已完成 Task 导致修复 Execute 不可达] → 使用现有 Task ID 验证普通受管修复，禁止新增影子任务或手工改 checkbox。
- [修复代码改变其他包的输入] → 在接受修复、Check 和 Verify 前复核实际依赖；允许有依据的后续失效。
- [恢复重放或权限漂移] → 新进程公共 CLI 恢复矩阵，覆盖旧 epoch、错误 invocation、未授权分支和重复 next；保留原始失败及拒绝历史。
- [预发布协议需要调整] → 正式 Design 明确单一当前协议；旧开发数据明确拒绝，不加迁移层，不承诺修复公司旧 Run。
- [规格、权威资料或接口契约冲突] → 停止依赖该冲突的实施，通过当前 Change 审查解决，不能自行择一或静默修补。

## 验证策略

1. 在当前生产路径建立真实必败 RED：四个可区分包中一个实现检查失败，捕获现有代码无条件使全部 completion 失效的行为；不能通过改 projection 或手写 Store 制造通过。
2. 领域与生产组合回归覆盖独立包保留、依赖传播、未知范围阻断、真实全局失效、计划/设计真实变化，以及 checkbox/等价提交不触发返工的既有保护。
3. 在全新多仓实验目录使用实际打包安装的公共 CLI 和受管 Host 完成四包验收，注入可观察的单包实现失败并修复；记录 Execute/检查调用次数、原/新 completion ID、Plan 身份、失败及通过 Gate；在失败后、计划接受后、单包修复后和 Check 后交替新进程 resume/next。
4. 重跑旧 epoch、Skill layer、claim、能力和分支授权拒绝回归；保持普通 Check/Verify 约束，保留范围正确而输入已漂移的负例。
5. 使用 Comet 控制本 Runtime 修复，独立审查当前 diff。完整阶段门禁使用 `.comet/check-policy.json` 的精确 `npm.cmd run build` 和 `npm.cmd run verify`；结果由真实 Guard 收据确认，报告只记录已经发生的检查。

基线已实际执行 `npx.cmd vitest run test/runtime-recovery.test.ts test/build-protocol-domain.test.ts`，34 项通过。本文件不把该基线冒充缺陷 RED/GREEN，也不预先宣称后续多仓验收、完整 Verify 或归档完成。
