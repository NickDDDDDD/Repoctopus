# Design

## Context

当前有三处独立的全仓 HEAD 判定。恢复分类器在当前 Package 写仓之外产生 `unaccepted-head`。Execute Outcome 的 checkpoint 推进只允许写集仓快进。Build Check 将所有登记仓的 live revision 与 checkpoint 整体比较。上次将 `resume` 和 `next` 接到同一路径后，仍保留这三处全仓等值假设。

本项目固定参考 Comet 0.5.1，同时检查了本次上游分支头 `2e33ae4`。Comet Classic 的恢复命令以运行 revision、阶段、待处理动作和未结算执行为守卫，分别派发继续 Build、修订 Plan 或 Design。[Classic 恢复实现](https://github.com/rpamis/comet/blob/2e33ae49fcf9bcd490153987d2095a3c6c08bd42/domains/comet-classic/classic-sdk-revision-application.ts)

Comet Classic 交付从检查结果取有边界的交付路径，对照 Git 提交及实际结果，基线已有变动和其他 Change 的工件有独立规则。它区分能参与检查的输入与获准发布的内容。这个边界可以应用到 Repoctopus。多仓绑定、包依赖与发布仍由 Repoctopus 原生 Runtime 实现。[Classic 交付输入](https://github.com/rpamis/comet/blob/2e33ae49fcf9bcd490153987d2095a3c6c08bd42/domains/comet-classic/classic-sdk-delivery-inputs.ts)

## Goals / Non-Goals

- 在 Windows 真实 Git 工作区验证无关快进不阻断 #114 和 #115 的合法工作包验收，以及不同进程恢复同一 Run。
- 依据调用当前 Work 所消费的实际输入保留有效进度，按依赖范围复核相关变化。保留 checkout、写授权与真实发布边界。
- 使用当前维护版本的 Run 协议完成测试。#105 另行依据版本及拒绝日志定位。

## Decisions

1. 先验证仓库拓扑、稳定身份、分支与 checkout，随后区分受管写入、无关外部快进、当前工作相关输入变化和不可判定变化。Runtime 使用 Git 祖先关系和可核验的变更集合，避免按 commit 作者、消息或只读标签推断权限。
2. 优先使用已绑定的 Package 仓库和依赖、现有证据输入策略、受管 Work 的检查及交付边界。Write scope 仅说明写权限。缺少可靠细粒度读证据时采用仓库粒度或阻断，避免把同仓的未知变动误归类为无关。
3. 共用判定并复用现有 Build 恢复与 Evidence 失效机制。恢复采用当前 Run 版本和 checkout 观察，保留历史接受事实，按依赖关系缩小需复核范围。仍在执行或提交未确认的 Work 按现有恢复契约处理。
4. 保持受管实现 OID 和交付边界可核验。外部变化单独观察，不能作为实现到达的凭证。若目标分支包含无法从实际发布差异安全隔离的外部改动，明确阻断并提示处理。
5. 正式 Design 通过公开 CLI、Git fixture 和现有独立验收工具锁定最小可实现的观测范围，重点复核 Execute 与 Check 的同一读写边界。

## Risks / Trade-offs

- 普通 Git 操作与 Runtime 并发时观察可能过期。恢复提交前必须重新观察，陈旧判定由状态版本和现有受管提交机制阻断。
- 单仓有复杂共享输入时，保守地重新验证或要求隔离可能增加一次操作。设计需证明它不会变成全仓 HEAD 的另一种等值比较。
- 各发布远端对分支差异的解释取决于最终 base 和 head。测试需比较真实发布坐标及 Git diff，同时证明已授权的实现仍能交付。
