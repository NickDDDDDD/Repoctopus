# Design

## Context

`BuildConfigurationProposal` 当前把稳定策略和 `bindingDigest`、`bindingStateDigest`、`hostId`、`hostCapabilities` 共同加入 semantic digest，随后建立 `build-configuration:*` Human Decision。该模型让机器事实变化与用户语义变化共享失效规则。

### 固定上游证据

2026-11-01 重新核对固定的 Comet `0.5.1`（`35c9860b77b42bafa0c2d80d8d695889f888a924`）与默认分支审计头（`63d2ba736a24090ee826c012b5963a579ca5fb8c`）。默认分支新增的 MiniMax Code 平台支持没有修改 Classic Runtime、Runtime SDK、Engine 或生命周期状态机，因此不改变本 Change 的参考边界，也不升级固定采用版本。

Comet Classic 的成熟边界是：Resolver 先选择 `configure`，有效配置才进入 `plan`；计划形成后必须记录与当前 plan ref 相符的 Plan Evidence，之后才能 Execute；恢复时保留有效配置和计划，只处理缺失、无效或用户明确要求改变的字段。Comet 的 Compat 路径把 `build_mode`、TDD、review 与 isolation 作为一次语义配置，Native SDK 路径也用 proposal hash 防止批准与配置输出错配。Repoctopus 采用这些不变量，但不复制 Comet 的单仓状态文件或额外 Build Plan 文档：OpenSpec Tasks 仍是任务权威，Run-local BuildPlan 只是执行投影；已批准的人/团队选择进入 Strategy，Host、checkout 与 HEAD 等可重建事实进入 Binding。

## Decisions

### 1. Strategy 只包含稳定选择

`BuildStrategy` 只包含 execution mode、TDD mode、review mode 和 isolation intent。它使用可移植 semantic digest，并随 Design planning snapshot 一起由可信用户批准。实际 Skill composition 的代码、版本和配置身份不进入 Strategy；Runtime 仍按独立 compatibility authority 判断 `same | compatible-adoption | migration_required`。

### 2. Binding 只包含执行事实

`ExecutionBinding` 包含 Host/capability snapshot、repository/branch/head/worktree ownership、可移植 semantic digest、local digest 和 state digest。绝对 checkout path 只保存在本地 overlay，不进入 Strategy、OpenSpec、共享配置或 OTLP。

### 3. Configure 不再建立常规批准

Build Configure 根据已批准 Strategy 与当前项目快照解析 Binding，并通过 Validator 检查 capability、isolation 和 Workspace ownership。兼容 Binding 变化使依赖旧输入的 Plan/Evidence 失效并自动重验，但不改变 Strategy。

### 4. Human Decision 按语义摘要去重

决定 identity 使用 `decisionKind + semanticDigest`。Open 和 Design 保持固定审查边界；只有策略字段未知、用户改变策略、definition 风险规则、外部授权或未知副作用才建立额外决定。Composition 不兼容进入 `migration_required`，兼容 adoption 保留原决定；两者都不得伪造 Strategy 变化。相同摘要的重试、恢复和返工记录 reused，不产生新待处理项。

### 5. Plan Evidence 在副作用前验证边界

Plan Evidence 核对 Tasks/acceptance、仓库拓扑、依赖、repository/write scope、terminal report ownership、Host capability、Strategy、Binding 和有效 Skill composition。低风险有效计划自动进入 Execute；只有 definition 的有界风险规则可请求额外人工暂停。

### 6. 返工精确失效

Binding/HEAD 变化重建 Binding 和 Plan Evidence；Strategy 未变且当前 composition 可兼容解释既有 Run 时复用 Design decision。Strategy 语义变化回到 Design 审查；composition 变化只走独立 compatibility/adoption 或 `migration_required`。Verify finding 返回 Build 时按影响范围修订 Plan/package，不重问相同配置。

### 7. 观测与桌面只展示有效决定

Trajectory/OTLP 分别记录 strategy proposed/approved/reused/invalidated、binding validated/drifted、decision created/reused/superseded 和 plan preflight finding。Desktop 只显示当前有效 Human Decision，并将自动 Binding 验证与人工等待分开。

## Risks / Trade-offs

- [Strategy 提前进入 Design approval 后，Build Configure 不再提供第二次常规确认] → Design proposal 必须展示完整 Strategy；真实策略变化使旧批准失效，实际 composition 则由独立兼容性权威验证，不能由 Configure 静默改写任一方。
- [Binding 允许跨 Host 或正常 HEAD 变化重建，错误实现可能把越权漂移当成兼容变化] → Validator 分别核对 repository identity、Workspace ownership、isolation intent、branch/worktree ownership 与 capability，Plan Evidence 只精确失效依赖旧 Binding 的结果。
- [OpenSpec Store 的本机注册表同一 Store ID 只指向一个 checkout，自举切换 worktree 时会 fail closed] → 当前流程只通过 OpenSpec 官方 unregister/register 做显式、可逆重绑定，不编辑 registry 或 Run 状态；Store 多 checkout 协调属于独立问题，不混入 Strategy/Binding 协议。

## Migration and Rollback

预发布阶段一次性切换持久化 schema 和生产路径，删除旧审批执行分支。若验证失败，回退整个 change commit；不并行维护两套可写协议。旧 Run 仅能只读诊断并提示重新开始。

## Stop Conditions

- Design planning snapshot 无法稳定绑定完整 Strategy；
- 现有恢复协议要求把本机绝对路径放入可移植身份；
- Plan Evidence 无法在 Execute 前取得 write scope 或终端报告所有权；
- 新模型仍会因兼容 Host/HEAD 变化建立人工决定。
