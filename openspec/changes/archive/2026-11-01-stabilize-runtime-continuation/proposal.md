# Proposal

## Why

Repoctopus 当前把规划语义、批准授权、Runtime 组合、Build 执行进度和发布来源的变化过度汇聚到同一 planning snapshot；结果是无关变化也可能触发重复人工批准、整段 Build Protocol 重建或不精确 continuation。核心 Runtime 在交给团队使用前，需要以 Comet 已验证的稳定身份、精确 checkpoint、显式 reconciliation 和增量失效原则收敛为可重复恢复的单一权威。

## What Changes

- 将规划决定、批准授权、Runtime composition、Build configuration/plan、执行 checkpoint 和 publication provenance 分成具有明确依赖关系的稳定身份，禁止跨层漂移互相冒充。
- 让 Runtime 按变化影响范围选择 `continue | reconcile | invalidate | migration_required`，并从唯一 Change Run checkpoint 返回精确 continuation；相同输入的重复调用不得重建 Work、Build Protocol 或 Human Decision。
- 将 Build 返工改为依赖感知的增量失效：保留仍匹配当前配置、计划、Work Package 和 Evidence 输入的事实，只重建受影响节点及其依赖后继。
- 将 composition 变化交给显式兼容性/adoption 判定；兼容变化恢复当前 Work，不兼容变化进入 `migration_required`，不得伪装为 planning approval 漂移。
- 规范化 Git remote/branch publication identity，使仅发布来源变化只刷新发布证明，不使规划语义批准失效；Archive 副作用开始后的未知结果继续走 reconciliation。
- 增加基于 Comet 0.5.1 与当前 HEAD 行为不变量改写的生产黑盒、崩溃恢复、并发重放和差分测试，覆盖重复审批、Task completion、相同配置、部分计划失效、composition 漂移与 publication identity 大小写差异。
- 为失效范围、保留事实、checkpoint 恢复、reconciliation 和重复调用抑制补齐低基数 Trajectory/OTLP 事实，支持后续审计 Runtime 稳定性。
- **BREAKING**：一次性替换尚未正式发布的 planning/runtime checkpoint 身份与粗粒度失效语义；旧开发 Run 保留只读审计价值，但不增加双读、generation、静默迁移或 Store 手改兼容路径。

本次垂直切片交付 Runtime 身份分层、增量失效、精确恢复及其生产验收；不新增 lifecycle phase、Dashboard、Skill、执行模式、daemon、Webhook 或 post-merge automation。后续切片才处理非核心产品能力和界面呈现。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：将 later-phase 规划恢复和 Build 返工从全量重建改为基于稳定身份与依赖范围的精确 continuation。
- `specification-authority`：收窄 planning semantic digest 与 approval authority 的职责，隔离 composition、执行进度和 publication provenance。
- `managed-work-execution`：明确重复调用、崩溃恢复和输入局部变化时的原 checkpoint 复用、增量退役与 reconciliation 契约。
- `plugin-composition`：为活动 Run 定义显式的 compatible adoption 与 incompatible migration 边界，禁止借规划批准处理组合变化。
- `development-telemetry`：记录失效范围、保留身份、恢复来源与重复调度抑制的可复算观测事实。

## Impact

- 影响 Change Run aggregate/checkpoint、planning approval、Specification Planning、Build Protocol reducer、composition compatibility、WorkflowRuns continuation 与对应 Store schema。
- 影响 Runtime CLI/公共 projection、Trajectory 与 OTLP mapping，但不改变 OpenSpec 四类工件权威或 Cordis 多仓组合边界。
- 参考 Comet 0.5.1 固定发布源码及当前 HEAD 的恢复契约与测试思想；不复制其产品命名、项目状态格式、Skill 体系或 Classic/Native 工件布局，因此不新增第三方运行时依赖。若实施中实质复制源码，必须在既有第三方来源清单中登记固定 commit、原路径、目标路径、摘要和许可证。
