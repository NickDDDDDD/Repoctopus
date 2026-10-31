# Design

## Context

`BuildConfigurationProposal` 当前把稳定策略和 `bindingDigest`、`bindingStateDigest`、`hostId`、`hostCapabilities` 共同加入 semantic digest，随后建立 `build-configuration:*` Human Decision。该模型让机器事实变化与用户语义变化共享失效规则。

## Decisions

### 1. Strategy 只包含稳定选择

`BuildStrategy` 包含 execution mode、TDD mode、review mode、isolation intent 和有效 Skill composition identity。它使用可移植 semantic digest，并随 Design planning snapshot 一起由可信用户批准。

### 2. Binding 只包含执行事实

`ExecutionBinding` 包含 Host/capability snapshot、repository/branch/head/worktree ownership、可移植 semantic digest、local digest 和 state digest。绝对 checkout path 只保存在本地 overlay，不进入 Strategy、OpenSpec、共享配置或 OTLP。

### 3. Configure 不再建立常规批准

Build Configure 根据已批准 Strategy 与当前项目快照解析 Binding，并通过 Validator 检查 capability、isolation 和 Workspace ownership。兼容 Binding 变化使依赖旧输入的 Plan/Evidence 失效并自动重验，但不改变 Strategy。

### 4. Human Decision 按语义摘要去重

决定 identity 使用 `decisionKind + semanticDigest`。Open 和 Design 保持固定审查边界；只有策略字段未知、用户改变策略、composition 语义不兼容、definition 风险规则、外部授权或未知副作用才建立额外决定。相同摘要的重试、恢复和返工记录 reused，不产生新待处理项。

### 5. Plan Evidence 在副作用前验证边界

Plan Evidence 核对 Tasks/acceptance、仓库拓扑、依赖、repository/write scope、terminal report ownership、Host capability、Strategy、Binding 和有效 Skill composition。低风险有效计划自动进入 Execute；只有 definition 的有界风险规则可请求额外人工暂停。

### 6. 返工精确失效

Binding/HEAD 变化重建 Binding 和 Plan Evidence；Strategy/composition 未变时复用 Design decision。策略或 composition 语义变化回到 Design 审查。Verify finding 返回 Build 时按影响范围修订 Plan/package，不重问相同配置。

### 7. 观测与桌面只展示有效决定

Trajectory/OTLP 分别记录 strategy proposed/approved/reused/invalidated、binding validated/drifted、decision created/reused/superseded 和 plan preflight finding。Desktop 只显示当前有效 Human Decision，并将自动 Binding 验证与人工等待分开。

## Migration and Rollback

预发布阶段一次性切换持久化 schema 和生产路径，删除旧审批执行分支。若验证失败，回退整个 change commit；不并行维护两套可写协议。旧 Run 仅能只读诊断并提示重新开始。

## Stop Conditions

- Design planning snapshot 无法稳定绑定完整 Strategy；
- 现有恢复协议要求把本机绝对路径放入可移植身份；
- Plan Evidence 无法在 Execute 前取得 write scope 或终端报告所有权；
- 新模型仍会因兼容 Host/HEAD 变化建立人工决定。
