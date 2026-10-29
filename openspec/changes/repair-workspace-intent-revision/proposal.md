# Proposal

## Why

Repoctopus 已规定 Open approval 必须固定 `current|branch|worktree` Execution Workspace intent，并规定 Build 发现 binding 与 Open 意图不一致时必须返回 Open 取得新批准。但当前实现存在两个缺口：

1. Open 人工决策只记录 isolation 名称，不使用真实 checkout facts 验证该选择；linked worktree 因而可以被错误批准为 `current`。
2. Build Configure 随后虽正确拒绝该 binding，却只抛出错误，没有受保护的 isolation 修订 transition。Change Run ID 又由 `workspaceId + changeId` 确定，启动同一 Change 只会恢复旧 Run，无法用“新 Run”绕过。

这已经在 Repoctopus 自举中形成真实阻塞：规格和 Design 均已批准，但 Build Configure 永远无法产生合法配置。需要实现已有规格要求的同 Run 修订路径，而不是编辑 Store、放宽 worktree 所有权或创建第二个 Run。

## What Changes

- 为 Execution Workspace binding failure 增加稳定错误分类与 `intent-revision | binding-retry | halt` 恢复类别，让编排层不维护错误 code 列表、不解析消息文本。
- Open approval 在写入 `ExecutionWorkspaceIntent` 和规格决定之前，使用 Run 冻结的 project snapshot 与 checkout facts 验证候选 intent；无效选择不改变 lifecycle 或 approval Store，可重新执行同一决策。
- Build Configure 仅在 binding 模块明确返回 `intent-revision` 时提交受保护的 `Build → Open(wait)` transition；可在原 intent 下修复的 binding 问题保持 Build retry，身份/拓扑漂移继续 halt。
- 新的可信 isolation 决策在同一 Run 中提交 `Open → Design`，设置新 intent 与 Runtime 选择的 `specification.plan` Work；Design 重新确认可能受执行环境影响的计划。
- lifecycle transition 替换或清除 current Work 时，在同一个 Run CAS 中退役不匹配的 execution checkpoint，避免旧 Build Configure Outcome 阻塞新的 Design Work。
- 统一外部 Runner 对 `Build Execute` 成功/失败 Outcome 的两阶段消费：先接受 Host submission，再由 Runtime validator 决定推进或按 finding 进入恢复路径；不得依赖仅供旧内嵌 Host 使用的 Outcome 投影。
- 当本 Change 修改受保护的 lifecycle/Runtime 语义时，为当前运行中的唯一直接前驱实现与 contributor version 声明精确 adoption contract，使自举 Run 可以在不编辑 Store、不放宽任意 digest 的前提下采纳新语义。
- CLI 展示当前 isolation、失败分类与三个候选模式；status 仍只读，拒绝修改 Store 或自动降级。
- 增加领域、Service、CLI、冷启动恢复、遥测和端到端测试，并用本次 linked-worktree/current 故障作为验收夹具。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: 无效 Execution Workspace intent 必须在同一 Run 中受保护地返回 Open 并重新进入 Design。
- `managed-work-execution`: intent 修订 transition 必须同步退役不再匹配 current Work 的 execution checkpoint。
- `development-telemetry`: 必须记录可修订 binding failure、isolation 决策和同 Run 恢复结果。

## Impact

- 主要影响 `services/execution-workspace`、`domains/change-lifecycle`、`domains/runtime`、`services/workflow-runs`、受保护 builtin composition/contributor 声明、CLI 人工决策交互、trajectory/OTLP 映射与相关测试。
- 不增加 lifecycle generation、第二个 Run、后台 daemon、Webhook、轮询、隐式 Store mutation 或新的 OpenSpec 工件。
- 不允许把 linked worktree 伪装成 `current`，也不把所有 Git/remote identity 错误都误判为可通过 isolation 修订解决。

## 非目标

- 在 Build Configuration 已批准或实现副作用已经发生后任意切换 isolation。
- 自动选择 worktree、替用户批准新的 intent，或复用旧 intent approval hash。
- 修改 execution mode、TDD mode、review mode、Build Plan 或 Verify/Archive 业务规则。
- 为任意旧版本保留并行行为；自举所需 adoption 只接受本次活动 Run 的唯一直接前驱实现/version，统一采用唯一的新 transition 语义。
