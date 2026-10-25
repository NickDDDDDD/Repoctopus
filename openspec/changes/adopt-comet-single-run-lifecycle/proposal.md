# Proposal

## Why

当前 lifecycle generation 把“同一 Change 的恢复”“不兼容升级”和“重新开始”混成多个并行 Run 身份，已经在自举中产生重复 G1、遗留 running Run、手工选择 generation 和 Dashboard 歧义。Comet 0.5.0 已证明单一权威 Run、Run revision、Action attempt 与检查 epoch 足以表达并发、重试、阶段回退和证据失效；Repoctopus 应删除额外代次模型，收敛状态空间后再继续扩展工作流。

## What Changes

- **BREAKING** 删除公共 CLI、Change identity、Run ID、trigger、checkpoint、projection、Receipt、Journal、Consistency、Telemetry 和文档中的 lifecycle `generation`。
- 一个 Workspace 中的一个活动 Change 只解析到一个稳定权威 `runId`；重复启动恢复同一个 Run，不再由调用方选择代次。
- 在同一 Run 内采用 Comet 的职责分离：`revision/stateVersion` 保护并发提交，`sequence` 排序追加事件，Work `attempt` 表达重试，`checkEpoch` 划分阶段检查证据的有效期。
- 阶段转换原子递增 `checkEpoch`；命令或验证执行期间 epoch 改变时结果失效，非 reusable 的旧 epoch 证据不得跨阶段使用。
- definition、Skill、Method Profile 或 composition 不兼容时，现有 Run 进入 `migration_required` 或显式终结；普通恢复、Verify 失败、Design 修订和 Archive 重试仍在原 Run 中完成，不再创建新 generation。
- Publication、Specification closure 和 Consistency 的稳定身份改为绑定 `runId + changeId + repository/base/head/OID`，同一 Run 的响应丢失通过原 Journal 恢复。
- 预发布 generation 数据只作为不可变历史文件保留，不提供双读、双写、自动升级或继续执行路径；新 Runtime 不扫描其为当前 Change。
- 更新本地 Dashboard/OTLP 语义，使同一 Change 只有一个当前 Run，并导出有界 `checkEpoch` 相关失效分类而不把 epoch 用作 Metric label。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: 将 Workspace/change/generation 权威模型改为 Workspace/change 单一 Run，并定义同 Run revision、attempt、checkEpoch、恢复和不兼容终结语义。
- `managed-work-execution`: 将恢复时的 Skill/执行包漂移从“新 generation”改为当前 Run 的明确迁移阻断，并把 Work attempt 与阶段 epoch 分离。
- `skill-integration`: 删除 Skill 和 Method Profile 漂移触发新 generation 的行为，统一为同一 Run 的失效或 `migration_required`。
- `delivery-governance`: Publication Receipt、Journal 和外部动作稳定身份改为绑定权威 runId，不再绑定 lifecycle generation。
- `development-telemetry`: 删除 generation 属性，增加同一 Run 内 phase/check epoch、attempt 和证据失效的可关联审计语义。

## Impact

- 领域与服务：`domains/change-lifecycle`、`domains/runtime`、`domains/delivery`、`domains/consistency`、`domains/specification`、`services/workflow-runs`、迁移入口和 Work/Evidence 验证。
- 平台与产品入口：文件 Run/Publication/Consistency Store、CLI、Desktop 投影、OTLP mapping、内置插件组合。
- 契约与数据：Change Run identity、trigger/checkpoint/trajectory、Publication Receipt/Journal、Specification Publication Journal 发生预发布破坏性 schema 更新；旧 `.repoctopus` generation 文件保持只读，不自动改写。
- 第三方采用：继续固定 Comet `0.5.0` / `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`，采用其单 Run、CAS revision、Action attempt、trajectory sequence 和 Classic `checkEpoch` 语义；不引入 Comet SDK 运行时依赖，不复制其单仓产品外壳。MIT 许可证记录不变。
- 本次垂直切片交付可运行的单仓与多仓单 Run 生命周期、发布恢复、Telemetry 和完整迁移阻断测试。跨机器共享 Run Store、正式版历史数据迁移工具和新的 Dashboard 交互不在本次实施；需要时另建 Change。
