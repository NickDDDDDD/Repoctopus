# Proposal

## Why

当前 lifecycle generation 把“同一 Change 的恢复”“不兼容升级”和“重新开始”混成多个并行 Run 身份，已经在自举中产生重复 G1、遗留 running Run、手工选择 generation 和 Dashboard 歧义。与此同时，现有五阶段把 Open 缩成只产生 proposal 的自动入口，把四类 OpenSpec 工件与唯一人工规划批准都放进 Design；Open 没有装填 `grilling`、没有人工停点，Build 又固定装填 `codebase-design`，Verify 失败虽然把 phase 改回 Build，却没有创建受管 Repair Work。这些缺口使阶段名称、Skill 和真实执行边界不一致。

Comet 0.5.0 已证明单一权威 Run、Open 与 Design 的独立人工边界、Run revision、Action attempt 与检查 epoch 足以表达并发、重试、阶段回退和证据失效。Repoctopus 应在删除额外代次模型的同一次破坏式升级中修正五阶段合同，避免先在旧 generation 协议上实现返工，或先发布一个仍会自动越过 Open、允许受管执行旁路的新单 Run。

## What Changes

- **BREAKING** 删除公共 CLI、Change identity、Run ID、trigger、checkpoint、projection、Receipt、Journal、Consistency、Telemetry 和文档中的 lifecycle `generation`。
- 一个 Workspace 中的一个活动 Change 只解析到一个稳定权威 `runId`；重复启动恢复同一个 Run，不再由调用方选择代次。
- Open 固定装填 `repoctopus-open-change + grilling`，先读取仓库与现有规格事实，再生成或修复 proposal、delta specs、design、tasks 四类 OpenSpec 工件；严格校验后进入绑定工件语义摘要的 Human Decision，不得自动进入 Design。装填 `grilling` 不等于强迫提问：没有未决决策时可以零问题完成，环境事实不得转问用户。
- Design 在已批准的 Open 基线上固定装填 `repoctopus-design-change + codebase-design`，深化并更新同一套 OpenSpec 工件，主要记录工程决策、边界和可执行 Task；它不得创建第五份 Design Doc、Build Plan、ADR 或 implementation notes，严格校验后必须经过第二次 Human Decision 才能进入 Build。
- Build 固定装填 `repoctopus-build-task + tdd`，不再默认装填 `codebase-design` 或独立 `design.public-test-seams` 规则；TDD 发现设计级阻塞时只报告结构化事实，由 Runtime 建立 Human Decision 并决定是否回到 Design。
- 在同一 Run 内采用 Comet 的职责分离：`revision/stateVersion` 保护并发提交，`sequence` 排序追加事件，Work `attempt` 表达重试，`checkEpoch` 划分阶段检查证据的有效期。
- 阶段转换原子递增 `checkEpoch`；命令或验证执行期间 epoch 改变时结果失效，非 reusable 的旧 epoch 证据不得跨阶段使用。
- definition、Skill、Method Profile 或 composition 不兼容时，现有 Run 进入 `migration_required` 或显式终结；普通恢复、Verify 失败、Design 修订和 Archive 重试仍在原 Run 中完成，不再创建新 generation。回退必须产生 Runtime 选择的 Work、Wait 或 reconcile continuation；只改变 phase、展示 repair 标签或观察到旁路文件变化都不能证明返工完成。
- Publication、Specification closure 和 Consistency 的稳定身份改为绑定 `runId + changeId + repository/base/head/OID`，同一 Run 的响应丢失通过原 Journal 恢复。
- 预发布 generation 数据只作为不可变历史文件保留，不提供双读、双写、自动升级或继续执行路径；新 Runtime 不扫描其为当前 Change。
- 更新本地 Dashboard/OTLP 语义，使同一 Change 只有一个当前 Run，并导出有界 `checkEpoch` 相关失效分类而不把 epoch 用作 Metric label。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: 将 Workspace/change/generation 权威模型改为 Workspace/change 单一 Run，修正 Open/Design 双审查边界，并定义同 Run revision、attempt、checkEpoch、返工、恢复和不兼容终结语义。
- `managed-work-execution`: 将恢复时的 Skill/执行包漂移从“新 generation”改为当前 Run 的明确迁移阻断，把 Work attempt 与阶段 epoch 分离，并为 Build 设计升级、Verify 修复和 Archive 重验建立真实受管 continuation。
- `skill-integration`: 固定 Open/Design/Build 的 Skill 组合，删除重复方法规则和 Skill 漂移触发新 generation 的行为，统一为同一 Run 的失效或 `migration_required`。
- `delivery-governance`: Publication Receipt、Journal 和外部动作稳定身份改为绑定权威 runId，不再绑定 lifecycle generation。
- `development-telemetry`: 删除 generation 属性，增加同一 Run 内 phase/check epoch、attempt 和证据失效的可关联审计语义。

## Impact

- 领域与服务：`domains/change-lifecycle`、`domains/runtime`、`domains/delivery`、`domains/consistency`、`domains/specification`、`services/workflow-runs`、迁移入口和 Work/Evidence 验证。
- 平台与产品入口：文件 Run/Publication/Consistency Store、CLI、Desktop 投影、OTLP mapping、内置插件组合。
- 契约与数据：Change Run identity、trigger/checkpoint/trajectory、Publication Receipt/Journal、Specification Publication Journal 发生预发布破坏性 schema 更新；旧 `.repoctopus` generation 文件保持只读，不自动改写。
- 第三方采用：继续固定 Comet `0.5.0` / `aeb1a6598034e28ce46b8422d4dbd8785e607bd7`，采用其单 Run、Open/Design 双停点、revision-bound 修订、受管 Build 回路、CAS revision、Action attempt、trajectory sequence 和 Classic `checkEpoch` 语义；不引入 Comet SDK 运行时依赖，不复制其 Superpowers Design Doc/Build Plan、单仓产品外壳或目录布局。MIT 许可证记录不变。
- 本次垂直切片交付可运行的单仓与多仓单 Run 生命周期、发布恢复、Telemetry 和完整迁移阻断测试。跨机器共享 Run Store、正式版历史数据迁移工具和新的 Dashboard 交互不在本次实施；需要时另建 Change。
