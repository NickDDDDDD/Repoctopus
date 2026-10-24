# Design

## Context

当前主规格把 Archive 建模为等待完整 Business MR 集合合入后才执行规格同步，并通过 GitHub Webhook、Event Inbox、长驻 Runner、PostMergeCoordinator、临时 merge checkout 和最终 Change MR 发布完成收尾。直接相关生产代码和测试已经形成独立子系统，而产品最重要的 Open、Design、Build、Verify 流程仍在快速完善。

新的产品边界是“重前置开发质量，轻后置交付协调”。规格代表团队接受的规范性意图，不要求与多个业务仓的分支合入在同一时刻发生。Repoctopus 对可控动作负责到“验证过的分支和 MR 已发布”；远端后续变化通过非阻塞的最终一致性审查处理。

固定参考为 Comet 0.5.0 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`：

- Classic archive preflight 重读 phase、branch、HEAD、Verify evidence 和交付授权，并在官方 OpenSpec archive 后验证唯一归档结果。
- Native archive transaction 用 prepared/applying/rolling-back/committed Journal 和文件身份 CAS 保护本地变更。
- Native workspace finish 执行 commit、push、create-or-reuse PR，并验证 base/head/head SHA 后返回；它不等待 PR 合入。
- Resume probe 只发现“归档已完成但交付尚未完成”，在下一次命令继续，不要求 daemon。

## Goals

- Archive 的复杂度只覆盖数据完整性、精确发布和响应丢失恢复。
- 多仓 Business MR 与最终 Change MR 发布完成即可终结同一 Change Run。
- 后续业务 MR 修改只有在语义影响规格时才产生新的规格工作。
- 正常开发、Archive 和一致性审查均不依赖监听端口、Webhook、Inbox 或长驻 Runner。
- 删除已无当前需求的基础设施，而不是保留未使用的扩展点。

## Non-Goals

- 不等待或自动合入 Business MR、最终 Change MR。
- 不提供跨仓原子事务，也不回滚已公开的 Git/MR 动作。
- 不自动判断并静默修改权威规格；语义影响不明确时必须进入结构化人工决定。
- 不修改已归档 Change；修正通过新的 OpenSpec change 表达。
- 不新增 ADR、implementation notes 或第五类 OpenSpec 规划工件。
- 不保留 Webhook/Event Inbox/Runner 的兼容运行模式；未来有实时需求时另建可选插件 Change。

## Decisions

### 1. Archive 以发布完成为终态

Archive 固定为四项 Work：

```text
archive.preflight
  → specification.close
  → delivery.publish
  → archive.complete
```

`delivery.publish` 覆盖全部业务仓分支/MR和 Workspace 规格分支/最终 Change MR。所有预期项目都有经过验证的 Publication Receipt 后，Runtime 接受 `archive.complete` 并将 Run 转为 `completed`。MR 的 open、merged 或 closed 状态不是终态条件。

后续远端变化不重开已完成 Run。生命周期 Receipt 证明 Repoctopus 当时发布了什么；一致性审查证明远端后来发生了什么，两者不可相互改写。

### 2. Publication Receipt 是唯一远端完成证明

每个发布项记录：

```text
changeId + generation
repository identity
kind: business | specification
remote + head branch + base branch
published head OID
MR identity + URL
provenance: runtime-created | recovered | human-created
verification timestamp
```

完整 Receipt 还绑定 Delivery snapshot、Verify evidence、规格关闭摘要和全部 item digest。扫描顺序不影响 digest，任一 item 缺失或远端 OID 不匹配都不能完成 Run。

发布前写稳定 Intent；调用中断后先按 repository/head/base 查询。唯一 MR 且 head OID 匹配时复用，零个匹配时创建，多个或不等价结果 fail-closed。人手工 push 和创建 MR 走相同采用逻辑，不伪造 Runtime Action。

### 3. OpenSpec 关闭只使用窄本地事务

`SpecificationClosureJournal` 只拥有隔离 checkout 内的 OpenSpec 文件副作用：

```text
prepared → applying → committed
                    ↘ rolling-back → rolled-back
```

prepared 记录 Provider/schema、活动 change、预期归档、受影响主规格、允许路径和文件身份；applying 调用官方 `openspec archive --yes --json`；提交前验证：

1. 活动 change 已消失；
2. 恰好新增一个对应归档目录；
3. 新 capability Purpose 已进入主规格；
4. 继续存在的受影响规格及整个 Store 严格校验通过，关闭计划中显式退役的 capability 主规格必须缺席；
5. diff 只包含关闭计划允许的规格和验证路径。

进程中断后按文件身份继续验证或回滚；并发修改导致 CAS 不匹配时保留现场并阻断。Journal 不记录 MR open/merged 状态，不承担跨仓 Saga。

### 4. 采用 Comet finish，而不是复制产品外壳

Repoctopus 采用 Comet 的动作顺序和不变量：commit → push → observe/create PR → verify exact remote → receipt。适配点仅有：

- Comet 单仓 finish 扩展为一个 Delivery snapshot 中的多仓发布项；
- Comet PR record 扩展为平台无关 MR record；
- Comet 本地状态映射为现有 Run/Action/Receipt Store；
- 最终规格 MR 使用 Workspace Repository 和 OpenSpec Store。

明确排除 Comet CLI、Classic/Native 双产品状态、用户目录、单仓假设和本地 merge 模式。默认只按行为重建；来源登记规则保持不变。

### 5. 最终一致性不属于 Change 生命周期

`consistency reconcile` 枚举具有 Publication Receipt 且尚有可观察业务 MR 的已完成 Change，读取每个 MR 的当前 head/state，并与发布 head 比较。它不创建等待状态，也不阻断新任务。

没有变化时返回 no-op。有变化时生成 `ConsistencyReviewRequest`，绑定原 proposal/design/spec 摘要、原 Verify evidence、原 head、当前 head 和最终 diff。它不扩展 Change phase 或 lifecycle Work；一个窄范围 `ConsistencyReviewService` 通过现有 Skill Registry 固定解析并快照 `to-spec`，输出：

- `no-spec-impact`: 仅实现、测试、流水线或内部结构变化，不改变行为契约；
- `spec-update-required`: 对外行为、配置、权限、数据契约或已接受范围变化；
- `uncertain`: 证据不足或语义存在争议，要求可信人工决定。

结果保存为 `ConsistencyReviewReceipt`，但不写回原 Run trajectory。`spec-update-required` 或人工确认需要修正时，通过正常 Open 阶段建立一个引用原 Change 和受影响 MR 的后续 OpenSpec change；不直接编辑归档目录。

### 6. Reconcile 是短生命周期拉取

提供显式 `repoctopus change reconcile [--change <id>]`。正常 `run start` 在完成参数解析和只读帮助处理后，执行一次有界、非阻塞的 Workspace reconcile：平台暂时不可用只产生诊断，不阻止新 Change 启动；副作用仅限保存结构化审查请求/回执或启动经人确认的普通后续 Change。

不轮询、不监听、不承诺实时。Dashboard 和 OTLP 可以展示最后审查时间、结论和 remediation change identity，但不得把 stale 状态解释为活动 Run 正在等待。

### 7. Webhook、Inbox 和长驻 Runner 整体退役

删除以下生产链：

```text
runner start
→ HTTP Host
→ GitHub Webhook Route / signature secret
→ Platform Delivery Envelope
→ File Event Inbox / lease / retry / dead letter
→ Platform Event Runner
→ GitHub Post-merge Processor
→ PostMergeCoordinator wake
```

项目配置删除 `platformEvents`、`postMerge.runnerIdentity` 和 webhook secret；GitHub API Token 移入/复用 Delivery Provider 凭据。`event status/replay/retry` 与相关文档、Telemetry 和状态目录一并删除。Cordis 不保留无调用者的 Service/Provider/Contributor。

### 8. Post-merge 产品语义退役

删除 `domains/post-merge`、`services/post-merge-*`、`workflows/post-merge.yaml`、临时 exact-merge checkout 和 post-merge Evidence profile。Archive 直接消费 Verify phase 已接受的 Evidence 和 Delivery snapshot，在 Workspace 的隔离 checkout 中关闭规格。

历史归档与 Receipt 保持只读，不批量迁移成新状态。活动但尚未完成的旧 Post-merge 状态通过一次性只读诊断列出；由于产品仍处于自举阶段，维护者选择重新运行新 Archive 或保留历史，不实现双写兼容 Coordinator。

### 9. 前置流程正确性优先

Tasks checkbox 只表达 Build 阶段可完成的实现工作；Verify、Archive、发布和一致性审查由固定 Work/Validator 表达。Design validator 拒绝依赖未来 phase 的 checkbox。

CLI 在 boot composition 前处理 `--help`、版本、未知参数和缺失必需参数，避免只读探测启动 reconcile 或创建默认 Run。这些修复直接保护前置开发流程，因此保留在本 Change。

### 10. 组件职责

- Lifecycle Engine：固定四项 Archive Work，接受 Publication Receipt 后完成 Run。
- Specification Provider：官方 OpenSpec schema、关闭事务和后置校验；不知道 MR 是否合入。
- Delivery Service/Adapter：commit、push、MR create-or-recover、精确远端核对；不决定语义影响。
- Consistency Reconciler：读取 Publication Receipt 和远端事实，创建审查请求；不重开 Run、不直接改规格。
- Consistency Review Service：通过 Skill Registry 固定 `to-spec` 快照，执行语义影响评估并输出有界 verdict；不拥有生命周期。
- CLI/Desktop/OTel：调用短生命周期命令和读取公共投影，不维护另一套状态。

## Migration Plan

1. 先建立单仓 tracer bullet：官方 OpenSpec archive、push、创建/复用最终 MR、精确 Receipt、Run completed，全程不查询 merge 状态。
2. 扩展为多仓 Publication Receipt 和部分发布恢复；保留现有 Delivery Provider 能力，fence 旧 Post-merge 入口。
3. 加入拉取式一致性审查与普通后续 Change 交接。
4. 删除 Webhook/Event Inbox/Runner/Post-merge production composition、配置、CLI、文档、测试和状态写入口。
5. 更新自举配置并用当前 Change 完成一次新 Archive；旧历史只读，不引入 definition/Receipt 批量迁移框架。

回滚以 Git commit 为边界：在删除旧生产链前保持新 tracer bullet 可独立通过；若新 Archive 失败，停止领取新 Work并保留 Closure Journal/Publication Intent 供诊断。已经 push 或创建的 MR 不自动删除，恢复时按稳定身份查询。

## Testing Strategy

- 领域测试覆盖四项 Archive Work、非法越级、Receipt 缺项、重复完成和完成后 reconcile 不重开 Run。
- OpenSpec 故障注入覆盖官方 archive 前、目录移动后、严格校验前和 Receipt 写入前中断，验证继续、回滚或 CAS blocker。
- 单仓 tracer E2E 证明 Verify → archive → push → create/reuse MR → completed，不需要 merge、Webhook 或长驻进程。
- 多仓测试覆盖扫描顺序、第二仓发布失败恢复、MR 创建响应丢失、人工创建 MR、远端 head 不匹配和多个匹配。
- 一致性测试覆盖 head 未变、实现级变化、契约变化、MR 关闭、`uncertain` 人工决定和后续 OpenSpec change 链接。
- 删除测试证明配置 schema 拒绝旧 webhook/runner 字段，公共 CLI 不再暴露 `runner start` 与 `event`，生产 composition 不含 HTTP/Webhook/Inbox Service。
- CLI 进程外测试证明 `run start --help` 和参数错误为零 composition、零 reconcile、零持久写入。
- 最终运行 OpenSpec strict、架构治理、来源、单元、E2E、package 和 tracer 验证。

## Risks / Trade-offs

- **规格 MR 可能先于业务 MR 合入**：规格是规范性目标；后续业务 head/state 变化由一致性审查发现，语义漂移通过新 Change 修正。
- **没有实时通知**：接受暂时 stale；下一次任务或显式 reconcile 收敛，换取没有 daemon/Webhook 运维成本。
- **语义影响不能完全自动判断**：Agent 输出结构化证据，`uncertain` 与规格修正需要可信人工决定。
- **删除已有平台事件能力的回退成本**：Git 历史保留实现；未来只有明确实时需求时才以独立可选插件重新引入。
- **旧活动 Post-merge 状态不自动迁移**：提供只读诊断和明确重新运行路径，避免为自举阶段状态维护永久兼容层。

## Assumptions and STOP Conditions

- **VERIFIED — 平台事实足够**：现有 `MergeRequestStatus` 与 GitHub Adapter 已返回 source/target branch、`headCommit`、state 和 merge metadata；Git Delivery 已能普通 push 并核对远端 OID。新 Publication Receipt 可以复用这些边界，不需要新增 GitHub Webhook API。
- **VERIFIED — Skill 来源可复用但没有现成一致性 phase**：现有 Skill Registry 和快照机制可解析 `to-spec`，Method Profile 只覆盖固定五阶段。实现必须增加窄范围 Review Service，不能伪造第六个 phase、复用 lifecycle WorkDescriptor 或建立第二套规格权威。
- **VERIFIED — Event 栈没有其他产品入口**：当前生产调用集中在 `runner start`、`event` 命令和 GitHub Post-merge processor；普通 Project composition、Desktop OTLP 和 Delivery API 不依赖它。
- **ASSUMPTION — 尚无外部消费者依赖 Runner/Event 公共入口**：仓库仍处于自举快速开发阶段。若删除前发现团队部署、第三方插件或已发布兼容承诺依赖这些入口，必须停止删除步骤并拆出显式 deprecation/migration Change。
- **ASSUMPTION — 首个 tracer 以 GitHub Provider 证明**：领域 contract 保持平台无关，但只要求现有 GitHub Adapter 完成第一条 E2E；不得为未配置的平台提前建立扩展框架。
- **STOP — OpenSpec 官方 archive 无法安全恢复**：若故障注入证明官方命令产生的中间状态无法通过 before/expected manifest 唯一继续或回滚，停止实现并保留隔离 checkout，不能以盲重放替代 Journal。
- **STOP — 语义审查无法绑定固定输入**：若 `to-spec` 评估不能同时绑定原规格摘要、原/新 head 和 diff identity，停止自动出 verdict，只保留 drift finding 与人工审查。

## Plan Review Notes

2026-10-24 review：旧计划因远端等待、Webhook、通用 Saga/GC/attempt/migration 混合而在 Scope 上不合格；重写后以单仓 tracer 开始，扩展多仓发布，再加入一致性审查，最后删除旧链。Completeness、Feasibility、Scope、Testability、Risk 和 Assumptions 均以本设计的边界、故障路径、验证矩阵与 STOP conditions 收敛到 5/5。规划不创建 implementation-notes 文件；实施偏差必须回写本 Change 的 `design.md`，重大语义变化重新经过 Design approval。

2026-10-25 self-host review：第一次真实 Archive 暴露出“领域组件完成但生产组合未闭合”的偏差。`SpecificationClosureJournal`、隔离 checkout 和候选校验已有独立测试，但 `OpenSpecProvider.close()` 仍在开发者工作树直接执行官方 archive；同时 planning manifest 未绑定 `.openspec.yaml`，导致 `retire_capabilities` 改变关闭语义后旧 Design approval 仍被复用。修正决定是：公共 Provider 关闭入口必须经过隔离事务并在候选验证后才同步精确允许 diff；中断恢复从 Journal 的 before/expected 文件身份重建同一 Receipt；Change-local Provider 元数据加入 planning semantic digest；回归测试必须调用生产 Provider 公共入口，并证明失败候选不污染开发者工作树。此偏差说明 task checkbox 只能表示实现声明，不能替代 production-composition tracer 与 self-host Archive 验收。

同日第二次 self-host review：隔离事务已正确阻止工作树污染，但候选校验把“受影响 capability”错误等同于“归档后必须存在的 capability”，因此拒绝 OpenSpec 按 `retire_capabilities: true` 正确删除的全 REMOVED capability。关闭计划现在显式绑定 `retiredCapabilities`：只有全量 REMOVED 且元数据授权退役的 capability 可进入该集合；候选必须证明这些主规格缺席，并只对其余受影响规格执行 strict spec validation。新增真实 OpenSpec 退役 fixture，避免用跳过 ENOENT 的方式削弱校验。
