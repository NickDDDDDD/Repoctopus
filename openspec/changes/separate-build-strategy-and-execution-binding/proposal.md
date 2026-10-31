# Proposal

## Why

当前 `BuildConfiguration` 的 semantic digest 同时包含 execution/TDD/review/isolation 选择与 Host、capability、checkout/binding 等机器事实。机器切换、HEAD 推进或兼容 checkout 修复因此可能生成新的 Build Configuration approval，重复询问用户已批准的语义。

本 Change 把稳定的人/团队选择建模为 `BuildStrategy`，把本机可重建事实建模为 `ExecutionBinding`。Design approval 绑定 Strategy；Build Configure 自动解析和验证 Binding，只有真实语义改变才建立新 Human Decision。

## What Changes

- 用 `BuildStrategy + ExecutionBinding` 替代预发布 `BuildConfiguration`。
- 将完整 Strategy 和有效 Skill composition identity 纳入 Design proposal/approval。
- Build Configure 只解析、验证和冻结 ExecutionBinding，不建立常规人工批准。
- 按 `decisionKind + semanticDigest` 复用/失效 Human Decision。
- 加强 Plan Evidence，在 Execute 前核对 Tasks、验收、仓库/write scope、报告归属、Host capability、Strategy、Binding 和 composition。
- 增加恢复/返工矩阵、OTLP 和桌面当前决定投影。

## Capabilities

### Modified Capabilities

- `change-lifecycle`: 以稳定策略驱动 Design approval 和 Human Decision 复用。
- `managed-work-execution`: 分离 Strategy/Binding 并加强 Plan Evidence。
- `development-telemetry`: 记录策略、绑定、决定复用和 preflight finding。
- `desktop-observability-dashboard`: 只展示当前有效语义决定。

## Dependencies

该 Change 在数据结构上引用有效 Skill composition identity；实施时应基于 `add-auditable-team-skill-composition` 的最终合同。它不依赖 required check 或 Method Receipt 才能完成基本切换。

## 非目标

- 不增加 Hotfix/Tweak profile、Direct execution、Executing Plans 或运行中模式切换。
- 第一版只支持 `autonomous|subagent-driven-development`、`tdd|direct`、`review=standard` 与 `current|branch|worktree`。
- 不保留未发布 `BuildConfiguration` Run 的执行兼容层；旧状态仅提供只读诊断。
