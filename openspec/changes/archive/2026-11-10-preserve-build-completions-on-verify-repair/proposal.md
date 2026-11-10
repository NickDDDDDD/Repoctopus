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
