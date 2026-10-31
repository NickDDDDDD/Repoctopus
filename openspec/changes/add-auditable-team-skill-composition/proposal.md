# Proposal

## Why

Repoctopus 当前把阶段 Action 与内置 augmentation 固定在源码中。团队若要把已有工程方法接入某个 Work，只能修改 lifecycle definition 或依赖开发机个人 Skill；前者要求产品代码变更，后者不能形成团队一致、可恢复和可审计的运行语义。

本 Change 交付最小完整纵切：团队在 Git 跟踪的共享配置中声明 guidance 或替换 definition 明确开放的 augmentation slot，Runtime 编译唯一有效组合、冻结到 Run/Work、向 Host 交付真实内容，并把 resolved、delivered、consumed 事实投影到同一套 OTLP 与桌面 Dashboard。

## What Changes

- 在 `repoctopus.yaml` 中增加版本化 `lifecycle.skillBindings`，第一版只允许 `guidance` 和显式 `augmentation-replacement`。
- 引入纯 `SkillCompositionCompiler`，验证 target、slot、role、order、Provider 唯一性、调用与能力契约，输出不可变 `EffectiveSkillComposition`。
- 保持 Repoctopus-owned Action Skill 永远不可替换；本机配置和个人 Skill 目录不得改变团队组合。
- 将有效组合摘要冻结到 composition、Run snapshot、Work input 和恢复兼容检查；漂移时 fail closed。
- Work Context 按冻结顺序交付内置与团队 augmentation，并保留来源和角色。
- 扩展本地 Trajectory、OTLP 和桌面投影，区分 resolved、delivered 与 consumed，不把这些事实描述为方法执行证明。

## Capabilities

### Modified Capabilities

- `project-configuration`: 声明团队 lifecycle Skill binding 及个人覆盖边界。
- `skill-integration`: 编译、冻结并交付唯一有效 Skill composition。
- `development-telemetry`: 记录团队 binding 和 Skill 解析、交付、消费事实。
- `desktop-observability-dashboard`: 展示当前 Work 的内置与团队 Skill 状态。

## Impact

- 修改共享配置 Schema、Loader、示例和配置摘要。
- 修改 lifecycle definition 的 augmentation slot 描述、Skill 解析、Work materialization、Context packet 和恢复检查。
- 修改 Trajectory/OTLP schema 与桌面 projection；不增加本地查询旁路。
- 这是预发布 Schema 变更，不保留尚未发布的旧试验字段；已有正式项目配置在未声明 `skillBindings` 时保持当前行为。

## 后续切片

- `add-managed-team-required-checks`: 把团队 required check 作为受管 Work 接入安全 checkpoint。
- `verify-open-intake-method`: 以 Method Receipt 验证 Open 的代码事实核对与 frontier。
- `verify-tdd-method`: 以真实 RED/GREEN/regression Evidence 验证 TDD 方法。
- `separate-build-strategy-and-execution-binding`: 分离稳定策略与机器绑定，消除重复 Build 批准。

## 非目标

- 本 Change 不提供 required check、Child Workflow、任意 Action replacement 或调用方动态装填。
- 本 Change 不引入 Method Receipt，也不声称能证明 Agent 遵循了某种方法。
- 本 Change 不重构 BuildConfiguration、Human Decision 或 Plan Evidence。
- 本 Change 不把 Matt Skills 上游对齐审计混入产品功能；上游更新继续走独立日常审计与普通 Change。

## 第三方与许可证

本 Change 只通过现有 Skill Provider contract 解析已登记 Skill，不复制新的第三方实现。固定 Skill 内容、许可证和来源继续由既有 provenance 与上游对齐机制管理。
