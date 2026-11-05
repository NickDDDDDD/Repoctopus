# Proposal

## Why

真实多仓验收仍出现同一实现问题被连续升级为 Build→Design、Archive→Verify、Archive→Design 的情况，说明 Runtime 尚未按变化所属权威选择最小恢复点，反而把计划、实现和证据问题折叠为粗粒度 Design 返工。该缺陷会制造重复人工批准、丢失可复用事实，并使自举与团队交付都难以稳定完成，因此必须先于继续扩展产品能力修复。

## What Changes

- **BREAKING**：移除 `design_assumption_invalid`、`planning_semantics_changed` 作为生命周期控制信号；Host 只提交有界事实和关联身份，Runtime 独立验证后选择唯一恢复动作。
- 引入互斥的 `revise-design`、`revise-plan`、`continue-build` 与 `invalidate-evidence` 恢复语义，并按“规格/设计 → 执行计划 → 实现执行 → 验证证据”的权威层级一次选择最高受影响层，禁止同一变化被连续惩罚。
- 让计划包边界、依赖、测试切面或命令形态问题留在 Build 内修订 Plan；当前输入未变的中断或失败继续当前 Build；只有批准的规格或设计语义改变才回到 Design。
- 使 Evidence 失效只重开真正依赖已变化输入的检查。任务完成 checkbox、实现提交 OID 和其他不改变规划语义或验证输入面的控制面变化，不再单独触发 Design 或全量 Verify 回退。
- 在产生副作用前补齐前置校验：Requirement 引用语法与存在性、TDD Work Package 的完整 RED/GREEN/回归闭包，以及新 capability 的规范 Purpose 均在 Open/Design 或 Plan Evidence 边界失败，而不是在 Execute、Verify 或 Archive 才暴露。
- 用真实多仓验收轨迹建立确定性重放回归，证明错误 RED、计划拆分、收尾 checkbox 与规格收尾不会制造无意义的阶段往返，同时保留历史 claim、packet、invocation、submission、Outcome 和 Evidence 审计事实。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：按权威层级选择唯一恢复动作，取消粗粒度 Build→Design 人工返工协议，并约束阶段回退和检查失效的顺序。
- `managed-work-execution`：定义 Runtime 分类事实、Build Plan 修订、当前 Work 续行、TDD 计划闭包及历史执行事实保留规则。
- `implementation-evidence`：把 Evidence 失效限定到声明的输入面，并区分实现、规划语义与非语义控制面变化。
- `specification-authority`：在早期验证 Requirement 引用、Capability Purpose 与规划语义身份，避免关闭阶段才发现可预判的规格错误。

## Impact

- 主要影响 `services/workflow-runs.ts`、`domains/change-lifecycle`、`domains/work-execution`、`domains/specification`、OpenSpec Provider、Runtime invalidation/telemetry 映射和对应测试。
- Work finding、lifecycle observation、trajectory 与遥测低基数字段会发生内部契约变更；项目尚未发布稳定版，不保留旧信号的并行兼容路径。
- OpenSpec Tasks 继续是规格与任务权威，Runtime Build Plan 继续是执行投影；本变更不会建立第二套 ticket、repair lifecycle、ADR 或 implementation notes。
- Comet 0.5.1（MIT）仅作为恢复语义、失效次序和回归场景的参考；Repoctopus 按自身多仓、OpenSpec、Work/Host 与 Cordis 架构重新实现，不引入 Comet Runtime 或 SDK 依赖。
- 本次垂直切片包含恢复分类器、前置校验、精确失效、遥测和轨迹回放。凭据错误、PR 文案/Skill 不匹配、Desktop Dashboard 及其他非阻塞问题留给后续独立 change。
