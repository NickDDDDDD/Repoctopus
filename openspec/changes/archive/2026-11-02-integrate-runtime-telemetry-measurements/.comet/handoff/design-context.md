# Comet Design Handoff

- Change: integrate-runtime-telemetry-measurements
- Phase: design
- Mode: compact
- Context hash: b4be3b51cf5f1ca937041f56f7cd7183811dbe97ab0da26f6c141642723a537b

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/integrate-runtime-telemetry-measurements/proposal.md

- Source: openspec/changes/integrate-runtime-telemetry-measurements/proposal.md
- Lines: 1-34
- SHA256: 35e2ea8f8508563bedb31acb98f05925edd347e7bc949cd63ad5d80bdcb3218c

```md
# Proposal

## Why

Repoctopus 主线已经具备 canonical observation envelope、双目的地 outbox、Desktop OTLP receiver、远端标准 OTLP 目的地，以及工作流、Work、Skill、Tool、Validator、等待、恢复和 Runtime stability 等事实；但用户提供的 22 项 AI 度量指标尚未形成逐项可信来源矩阵，部分 Runtime 可观察指标也缺少完整关联、计算口径或公开数据字典。团队在接入自部署 SigNoz 前需要在现有权威管线上补齐这些缺口，避免 Dashboard 依赖猜测、不可验证数据、私有字段映射或第二套遥测链路。

## What Changes

- 为 22 项候选指标建立版本化覆盖矩阵，区分直接上报、由 SigNoz 聚合、可选机器评估和 Repoctopus 范围外数据源。
- 补齐 Runtime 能可信观察的 9 项指标：Skill 任务完成率、人工修正率、Skill 错误率、Skill 复用率、机器可验证规则命中率、机器可验证违规生成率、工作流失败率、流程复用次数，以及基于权威交付周期的效率提升率。
- 只把结构化 Rule applicability、Evaluator outcome、Work/Skill 关联、返工和周期事实计入指标；不从 Prompt、模型思考、自由文本规则或最终成功状态反推命中、消费或因果关系。
- 完整支持并验证标准 OTLP HTTP 地址、按信号地址、请求头、服务名和 Resource Attributes 等部署配置；SigNoz 作为兼容后端，不进入领域层依赖。
- 发布完整遥测参考手册，列出所有 Resource、Trace/Span、Log/Event、Metric 及 `repoctopus.*` 字段的类型、单位、允许值、来源、必填性、基数、隐私约束和聚合公式，并用契约测试阻止文档与实现漂移。
- 明确不实现字段改名、公司别名、Collector Transform、SigNoz 私有查询 API、Dashboard 面板和告警。
- 明确不采集上下文/RAG、知识问答、IDE 补全和代码归因、活跃用户、培训覆盖与认证等外部系统指标；缺失数据保持 `unknown`，不得以零值或推断值代替。
- 保留当前 canonical envelope/outbox、Desktop 与远端目的地解析和 Runtime stability 事实；旧遥测分支只提供需求与测试思路，不直接回放补丁，也不恢复已被主线取代的结构。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `development-telemetry`：增加候选指标覆盖边界、可信 Skill/Rule/工作流聚合、标准 OTLP 部署配置、公开遥测数据字典及契约防漂移要求。

## Impact

- 影响 `domains/telemetry`、Change/Work/Skill/Validator 领域事实、`platform/telemetry` 映射与 OpenTelemetry exporter、配置解析、OTLP 测试接收器和遥测契约测试。
- 更新 `docs/telemetry.md`，新增 `docs/telemetry-reference.md`，并关联自举/部署文档入口。
- 不修改 Desktop 与远端共享 canonical envelope/outbox 的架构，不新增第二套状态、投影或指标权威。
- 不采用 Comet 遥测源码；Comet 0.5.1 仅作为本 Change 的外部工作流执行器，产品实现继续遵守现有 OpenTelemetry 和 Cordis 边界，因此不新增第三方运行时依赖或许可证义务。
- 后续独立切片可基于本 Change 的稳定字段建设 SigNoz Dashboard、告警和跨项目分析，本 Change 不包含这些展示层产物。
```

## openspec/changes/integrate-runtime-telemetry-measurements/design.md

- Source: openspec/changes/integrate-runtime-telemetry-measurements/design.md
- Lines: 1-171
- SHA256: d5bdc2e961f5ebe6f35985a1667fccde9e15fe0a2b8ef62a3b9e9b50451dee34

[TRUNCATED]

```md
---
comet_change: integrate-runtime-telemetry-measurements
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 [proposal.md](proposal.md) 的动机。当前主线已经用 canonical observation envelope、双目的地 outbox 和 Desktop OTLP receiver 统一本地与远端投递，`observationDestinationsFromEnvironment` 负责标准总 endpoint、按信号 endpoint、header 与 Desktop token 的目的地解析，Runtime stability 也已有一组权威事实与指标。仍然分散的是 Runtime、Evidence、Lifecycle 和 Delivery 等 exporter 的 Resource 构建、公开名称目录和度量公式；例如多个 exporter 重复建立 Resource，而标准 service name、resource attributes 与 timeout 尚未形成跨 exporter 的单一可测试语义。

Dashboard Change 已要求本地与远端消费相同 OTLP 语义。本 Change 在其上游补齐规范数据契约和度量事实，不实现 Dashboard UI，也不建立另一套投影协议。

### 当前主线整合约束

本次以最新 `origin/main` 为唯一实现基线。旧分支 `codex/revise-dashboard-telemetry` 及其验证结果只作为可追溯参考，不是可直接合并的实现权威；旧补丁对当前 `docs/telemetry.md`、OpenTelemetry exporter、mapping、managed execution 和 workflow run 等核心文件已不能无冲突应用。任何移植都必须重新核对当前领域模型、Runtime 事件、桌面 Dashboard 已归档契约和现有测试。若旧实现与当前主线冲突，应按本 Design 和当前主规格重新实现，不为保留旧补丁而引入兼容层。

Build 必须遵守以下整合边界：

- canonical observation envelope、outbox、Desktop receiver 和远端目的地解析继续是唯一投递路径；
- 现有 Runtime stability facts/metrics 进入统一目录，不复制为同义事件或第二套聚合；
- `observationDestinationsFromEnvironment` 继续拥有 endpoint、按信号 endpoint、header 与 Desktop token 的传输配置；标准配置解析只补齐 Resource、service name、timeout 和按信号标准覆盖；
- 当前生产 composition 使用 canonical adapters；没有生产调用者的旧直连 OpenTelemetry exporter 不再作为第二套实现继续扩展，相关测试迁移到 canonical 管线后删除旧入口；
- 旧分支中的新增文件、测试和文档仅作为意图样本，先在当前主线写失败测试，再按当前接口重建；不恢复已删除文件，不建立兼容适配层；
- 本 Change 不重做 Desktop Dashboard，后续全新多仓实验验证是独立验收活动，不混入本 Change 的产品范围。

## Goals / Non-Goals

**Goals:**

- 用一个机器可校验目录描述公开信号、名称、属性、枚举、单位、基数和隐私边界。
- 让 Runtime 可观察的 9 项指标都能从权威事件直接取得或在 SigNoz 中复算。
- 统一所有 exporter 的标准 OTLP 配置和 Resource 合并语义。
- 让参考手册可直接指导 SigNoz 查询，并由验证阻止文档漂移。

**Non-Goals:**

- 不测量模型内部思考、Prompt 质量或 Skill 对结果的因果贡献。
- 不实现 RAG/知识问答评测、IDE 采纳和代码归因、人员活跃度、培训或认证采集。
- 不实现字段改名、组织别名、Collector Transform、SigNoz 私有 API、Dashboard 或告警。
- 不把 Comet Runtime 或遥测模型引入 Repoctopus 产品依赖。

## Approaches

### 采用：目录优先、事实增量、查询聚合

建立版本化 observation contract 作为公开 OTLP 名称、类型、单位、枚举、基数和隐私边界的机器权威；Runtime 与 Trajectory 只持久化可重放事实，canonical adapter 对每个已持久化事实只生成一份 envelope，OTLP encoder 对同一 envelope 进行确定性协议投影，比例、趋势和效率提升由 SigNoz 按数据字典在查询端复算。Desktop 与远端目的地使用同一编码结果，只允许 endpoint、认证和 Delivery Cursor 不同。

选择该方案是因为它沿用现有“领域事实先落盘、Telemetry Provider 后投影”的架构，让本地 Dashboard 与远端 Collector 继续消费同一协议，并能用稳定事件身份处理重放与恢复。代价是本 Change 需要同步整理目录、事实、映射、测试和文档，但这些工作共同消除了当前分散契约造成的漂移。

### 放弃：Exporter 内推断关联

该方案不增加权威事实，而由 exporter 根据事件时间和相邻顺序推断 Skill、Rule 与返工关系。虽然改动较少，但在重放、进程恢复、多 Skill Work 和跨阶段返工时无法可靠归因，也不能证明 Rule applicability，因此不符合已批准规格。

### 放弃：Runtime 维护团队级聚合 Store

该方案在 Runtime 中保存成功率、失败率、窗口和基线聚合，Dashboard 查询较简单，但会建立第二份分析事实源，把窗口、时区和组织口径耦合进领域层，并与 SigNoz 的分析职责重复，因此不采用。

## Decisions

### 1. 机器目录是公开遥测名称的单一来源

在 `domains/telemetry/observation-contract.ts` 建立版本化目录，描述每个公开 Event、Span、Metric 和 Attribute 的信号位置、标量类型、单位、枚举、必填性、基数与敏感级别。Runtime 领域仍只产生事实；目录不负责状态推进或 OTLP 传输。

映射与 exporter 通过目录常量或校验器使用公开名称，文档脚本从相同目录生成 `docs/telemetry-reference.md` 中的规范表格，并提供 `--check` 模式。人工维护的接入说明和指标解释保留在生成区块之外。

备选方案是继续手写 Markdown 并用测试抽查少量字段。该方案不能证明完整性，也会在多个 exporter 演进时持续漂移，因此不采用。

### 2. canonical envelope 与 OTLP projection 各自只有一个权威

canonical envelope 是持久、可重放、与目的地无关的观测事实；OTLP projection 是它唯一的协议表示。`encodeObservationOtlpJson` 不再只把完整 envelope 塞入一个 JSON 字符串属性，而是保留该可逆 envelope 属性供 Desktop receiver 使用，同时按机器目录输出标准 Resource、可查询的允许列表 attributes、Span/Event 和有界 Metric datapoint。Desktop 与远端对同一 envelope、同一 signal 得到字节语义等价的 payload。

部署 Resource、service name、endpoint、header 和 timeout 不进入 envelope identity；它们在协议编码和传输边界合并，因此换 Collector、凭据或目的地不会改变领域事实或重放身份。Resource 解析器与 encoder 使用同一公开目录，但不反向依赖 Desktop projection。

当前 `OpenTelemetryExporter`、`OpenTelemetryEvidenceExporter`、`OpenTelemetryLifecycleExporter` 和 `OpenTelemetryDeliveryExporter` 没有生产 composition 调用者，并会绕过 outbox 独立解释领域事实。本 Change 把仍有价值的协议断言迁移到 canonical 管线后删除这些直连入口；不为未发布的旧入口保留兼容层。

备选方案一是继续维护 canonical 与直连 SDK exporter 两套实现。它能减少删除代码的短期改动，但会产生两套 mapping、重试语义和字段目录，违反主规格。备选方案二是只在 SigNoz 查询 JSON envelope。它改动最小，却无法提供稳定的原生 Resource/Metric 查询与低基数约束，也会把产品语义推给每个 Dashboard，因此均不采用。

### 3. 原始事实优先，比例和趋势在查询端聚合
```

Full source: openspec/changes/integrate-runtime-telemetry-measurements/design.md

## openspec/changes/integrate-runtime-telemetry-measurements/tasks.md

- Source: openspec/changes/integrate-runtime-telemetry-measurements/tasks.md
- Lines: 1-63
- SHA256: e24541c5f6811b172980a2cf2bc6e9f86201c5ab8f5fc2fecff9b4de9f7fd8e1

```md
# Tasks

## 0. 冻结当前主线整合边界

- [ ] 0.1 盘点当前主线 canonical observation envelope/outbox、Desktop receiver、`observationDestinationsFromEnvironment`、Runtime stability facts 与各 exporter 的所有权，形成代码到规格的 gap map；运行现有 observation、Desktop 和 Runtime telemetry 测试，证明本 Change 只补缺口而不建立第二套管线。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:7d3dc414-526e-42c2-b3ac-1a95c2820f69 -->
- [ ] 0.2 将旧分支的候选测试逐项改写为当前主线接口上的失败测试，记录不能直接应用的核心冲突，并禁止恢复已删除文件或增加旧补丁兼容层；运行选定测试先证明真实缺口可复现。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:b4c73533-d0df-4aac-b11c-08619ad80cb3 -->
- [ ] 0.3 增加架构回归断言，保证新增度量仍经 canonical envelope/outbox 投递，Desktop 与远端保持同一公开协议，现有 Runtime stability 事实不被复制为同义事件；确认旧直连 OpenTelemetry exporter 没有生产调用者。（Requirements: development-telemetry#工作流健康和效率度量必须可复算, development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:465afb6a-5847-4c4a-a310-538d446c5459 -->

## 1. 冻结现有公开遥测契约

- [ ] 1.1 盘点 canonical observation delivery、Runtime stability、Runtime、Evidence、Lifecycle、Delivery exporter 当前公开的 Resource、Span、Event/Log、Metric 和 Attribute，建立 `domains/telemetry/observation-contract.ts` 的 schema v1 类型与目录；运行 `npx vitest run test/telemetry-observation-contract.test.ts` 验证现有名称均被收录且无重复定义。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:f666367f-612c-42d8-bfa9-8180821a0faf -->
- [ ] 1.2 将公开名称、类型、单位、枚举、必填性、来源、基数和隐私级别编码为可校验元数据，并让现有 mapping 测试从目录断言输出；运行 `npx vitest run test/telemetry-mapping.test.ts test/telemetry-observation-contract.test.ts` 验证未发生删除、改名或类型漂移。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:5b517b87-6ee6-4804-b96b-e3b70e03c9a1 -->
- [ ] 1.3 增加目录快照与公开协议变更检查脚本，并接入 `check:generated`；运行 `npm run check:generated` 验证代码与快照一致，故意改变公开名称时检查会失败。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:21022ad4-61a8-449c-83a0-2f2104ee904a -->
- [ ] 1.4 在 `docs/telemetry.md` 记录 schema v1、兼容性边界和“字段名不是部署配置”，运行 `npx prettier --check docs/telemetry.md` 验证文档格式。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:fd7e8e46-19e5-4080-92db-1e12f9221917 -->

## 2. 交付标准 OTLP 配置垂直切片

- [ ] 2.1 为标准 `OTEL_EXPORTER_OTLP_ENDPOINT`、按信号 endpoint、headers、timeout、`OTEL_SERVICE_NAME`、`OTEL_RESOURCE_ATTRIBUTES` 和兼容环境回退建立表驱动测试，运行 `npx vitest run test/opentelemetry-config.test.ts` 先证明当前缺口可复现。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:8fdcbc38-a1c2-4ea6-aa94-11947b8b4a15 -->
- [ ] 2.2 保留 `observationDestinationsFromEnvironment` 对总 endpoint、按信号 endpoint、header 和 Desktop token 的所有权，补齐标准按信号 header/timeout，并实现共享 OTel Resource/service 配置；运行 `npx vitest run test/opentelemetry-config.test.ts test/observation-telemetry.test.ts` 验证所有优先级组合及既有目的地行为不变。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:c5c8f07b-7855-430c-836e-bdd316460d9f -->
- [ ] 2.3 扩展 canonical OTLP encoder，使 Workflow、Evidence、Lifecycle 和 Delivery envelope 共用同一 Resource、允许列表 attributes、Span/Event 与有界 Metric 投影，同时保留 Desktop 可逆 envelope；迁移有效测试后删除无生产调用者的旧直连 OpenTelemetry exporter，运行 observation pipeline、dual-destination 和 managed execution OTLP 测试验证没有平行传输路径。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效, development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:9e0dc859-8fe5-48ce-8c06-26a9a6d88815 -->
- [ ] 2.4 增加协议级 mock OTLP receiver 测试，验证统一 endpoint、按信号覆盖、认证 header、无 endpoint 时禁用和后端不可用时业务继续；运行 `npx vitest run test/e2e/otlp-configuration.e2e.test.ts` 验证 Trace、Log、Metric 三类信号。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:7f6059f6-1019-4b82-9c1a-efa0e6d01a70 -->
- [ ] 2.5 在 `docs/telemetry.md` 写明面向兼容 Collector/SigNoz 的环境变量、优先级、密钥边界和可运行示例；运行文档中的 mock receiver 示例并执行 `npx prettier --check docs/telemetry.md`。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效） <!-- comet-task:4e57cfee-1b8a-45a6-85e2-cd1aa9d7133a -->

## 3. 补齐 Skill 执行效果事实

- [ ] 3.1 为 Skill consumed receipt 与同一 Run、Work attempt、Host invocation、digest 和 Outcome 的绑定增加领域失败测试，运行 `npx vitest run test/skill-run-binding.test.ts` 验证 resolved/delivered 不会被误计为 consumed。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:60fcdc58-943a-4f2c-8a0f-eee8828fa81c -->
- [ ] 3.2 增加 accepted、rejected、failed 与 repair 结果的 additive 关联事实及稳定事件身份，运行 `npx vitest run test/skill-run-binding.test.ts test/change-lifecycle-domain.test.ts` 验证重放和进程恢复不会重复计数。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:fc50df0b-37cf-44b4-9300-0787c5cca62e -->
- [ ] 3.3 将 changes-requested、Outcome rejection、Task reopen 和 Repair Work 映射为有界人工修正类别，运行 `npx vitest run test/telemetry-mapping.test.ts test/skill-run-binding.test.ts` 验证不导出审批正文、差异或自由文本原因。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:1bc32eb4-1d68-47ce-8250-0acdf2c86ba3 -->
- [ ] 3.4 导出 Skill 调用、完成、错误、人工修正和复用所需的计数事实，Metric 仅使用角色、类别和结果等低基数标签；运行 `npx vitest run test/telemetry-mapping.test.ts` 验证精确 Skill identity 只在允许的 Event/Span 中出现。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:f8d24722-d97d-4a6e-a2f5-0936b1058ec4 -->
- [ ] 3.5 在遥测参考生成源中记录四项 Skill 指标的分子、分母、窗口、未知语义和“相关性而非因果性”，运行 `node scripts/generate-telemetry-reference.mjs --check` 验证公式与机器目录一致。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#Skill效果度量必须绑定可验证执行事实） <!-- comet-task:aff094bb-0ff0-4a31-96a1-5feaa7d65c5a -->

## 4. 增加机器可验证 Rule 评估

- [ ] 4.1 定义稳定 Rule identity/digest、Evaluator identity/version、applicability、expected、triggered 和 result receipt 的领域契约，运行 `npx vitest run test/rule-evaluation.test.ts` 验证缺少结构化 Evaluator 时结果为 unknown。（Requirements: development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:3cae53bf-bc62-476d-bef0-9447ca5b6d6e -->
- [ ] 4.2 将现有结构化 Validator/Evaluator 结果接入 Rule receipt 持久化边界，运行 `npx vitest run test/rule-evaluation.test.ts test/change-lifecycle-domain.test.ts` 验证文本规则、Skill 加载和最终成功不会被当作规则命中证据。（Requirements: development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:d3a3dfa2-820a-42d6-81a9-f7bd85112c6d -->
- [ ] 4.3 导出 expected、triggered、passed、violated 和 unknown 的有界事件/计数，运行 `npx vitest run test/telemetry-mapping.test.ts test/rule-evaluation.test.ts` 验证精确 Rule identity 不进入 Metric label。（Requirements: development-telemetry#Rule度量只接受机器可验证评估, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:a8f5e431-f0dc-49e0-9d75-2f8eaabf13f9 -->
- [ ] 4.4 在遥测参考生成源中记录规则命中率与违规率的适用性、公式和未知处理，运行 `node scripts/generate-telemetry-reference.mjs --check` 验证无 Evaluator 的规则不会生成虚假零值。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#Rule度量只接受机器可验证评估） <!-- comet-task:1239ebee-187d-486a-a64e-ac50bdacae56 -->

## 5. 冻结工作流健康与效率口径

- [ ] 5.1 为权威 Run 开始、唯一终态、workflow identity/version、阶段边界和有效周期建立重放/恢复测试，运行 `npx vitest run test/runtime-telemetry.test.ts` 验证一次逻辑 Run 只贡献一次执行和终态。（Requirements: development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:b1a0437e-d019-4a2d-9093-373bf8eaca7e -->
- [ ] 5.2 补齐工作流执行、失败、复用和周期事件的稳定关联及低基数 Metric，运行 `npx vitest run test/runtime-telemetry.test.ts test/telemetry-mapping.test.ts` 验证临时导出失败和进程重启不会增加逻辑次数。（Requirements: development-telemetry#工作流健康和效率度量必须可复算, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:c9384cb4-0199-4c20-954e-61efe98686c1 -->
- [ ] 5.3 在遥测参考生成源中记录失败率、复用次数和效率提升率的查询公式，明确同 workflow/version、完成周期、基线窗口与缺失基线为 unknown；运行 `node scripts/generate-telemetry-reference.mjs --check` 验证公式字段均存在于目录。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态, development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:70a5e4ed-2e7c-4c63-837d-bb3c912c7fbe -->

## 6. 发布完整度量覆盖矩阵与数据字典

- [ ] 6.1 将 22 项候选指标逐项写入机器可校验覆盖矩阵，标明 `direct`、`derived`、`optional-evaluator` 或 `out-of-scope`、权威来源、公式和缺失语义；运行 `npx vitest run test/telemetry-metric-coverage.test.ts` 验证恰好覆盖输入清单且 9 项纳入、13 项范围外。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:b937519d-d4e0-4705-89d5-4182195f6ae2 -->
- [ ] 6.2 实现 `scripts/generate-telemetry-reference.mjs`，从机器目录生成 `docs/telemetry-reference.md` 的 Resource、Span、Event/Log、Metric、Attribute 和指标公式规范区块；运行 `node scripts/generate-telemetry-reference.mjs && node scripts/generate-telemetry-reference.mjs --check` 验证生成幂等。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:dd646e5b-6ae5-48e9-ab22-d9f4441151bd -->
- [ ] 6.3 在参考手册中解释 13 项范围外指标所需的 RAG/评测、IDE/代码归因、身份、规则编辑审计或培训系统，并明确未来只能通过评审后的 Provider 接入；运行 `npx prettier --check docs/telemetry-reference.md` 验证文档格式。（Requirements: development-telemetry#候选度量必须声明可信来源和覆盖状态） <!-- comet-task:c4d951ba-45a1-4934-a4fd-3cbb8ae279a7 -->
- [ ] 6.4 为 SigNoz 提供使用规范字段的查询示例、去重口径、低基数约束和敏感数据边界，不提供字段别名、改名或 Collector Transform；运行文档契约测试 `npx vitest run test/telemetry-documentation.test.ts` 验证示例字段全部存在于机器目录。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:0d646363-f31d-4f90-b24f-9f65c956e0d6 -->
- [ ] 6.5 将目录与参考手册漂移检查接入 `npm run verify`，运行 `npm run check:generated && npm run spec:validate` 验证公开协议、文档和规格同步。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:1eaad028-74ec-4758-a946-41483ef39100 -->
- [ ] 6.6 保持发布包边界只包含产品文档和运行产物，排除 Comet 的 `docs/superpowers/**` 等工作流计划；运行 `npm run test:package-e2e` 和 managed execution report 检查，验证包内包含遥测参考但不泄漏工作流临时产物。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:c8aad2f2-7b2d-41b2-a358-9f729599a5d7 -->

## 7. 跨切片集成验证

- [ ] 7.1 用 mock OTLP receiver 跑一个包含 Skill consumed、机器 Rule receipt、人工返工和最终成功的完整 Run，运行 `npx vitest run test/e2e/telemetry-measurement.e2e.test.ts` 验证三类信号可关联、去重且能复算 9 项指标。（Requirements: development-telemetry#Skill效果度量必须绑定可验证执行事实, development-telemetry#Rule度量只接受机器可验证评估, development-telemetry#工作流健康和效率度量必须可复算） <!-- comet-task:69183074-877e-4f40-9b05-44e2c81752f1 -->
- [ ] 7.2 运行隐私与基数回归 `npx vitest run test/telemetry-mapping.test.ts test/e2e/telemetry-measurement.e2e.test.ts`，验证 header、凭据、路径、自由文本和未登记 identity 不进入公开属性或 Metric labels。（Requirements: development-telemetry#标准OTLP部署配置必须完整生效, development-telemetry#Metric标签必须保持有界且身份可下钻） <!-- comet-task:a1f61bfd-9af6-4b78-8bda-3914ce5fbb2c -->
- [ ] 7.3 执行 `npm run verify`、`npm run test:package-e2e` 和 `npm run test:tracer-e2e`，确认类型检查、Lint、构建、全量测试、生成物、架构、来源、发布包和 OpenSpec 严格校验全部通过，并把命令和结果记录到正式验证 Evidence。（Requirements: development-telemetry#遥测公开契约必须完整可发现并防止漂移） <!-- comet-task:6561d5a6-1e5f-4ae4-97cd-e02f1fa218ab -->

## Workflow follow-up

- 在项目评审要求满足后归档该 Change。
- 归档后验证主规格已合并且公开遥测参考仍通过生成检查。
```

## openspec/changes/integrate-runtime-telemetry-measurements/specs/development-telemetry/spec.md

- Source: openspec/changes/integrate-runtime-telemetry-measurements/specs/development-telemetry/spec.md
- Lines: 1-116
- SHA256: a5c73458a90e19f56052f6445f39868df27cc2f47af2277586f45f6aaf6aeea0

[TRUNCATED]

```md
# development-telemetry Specification Delta

## ADDED Requirements

### Requirement: 候选度量必须声明可信来源和覆盖状态

Repoctopus MUST 为纳入评估的每项候选度量声明 `direct`、`derived`、`optional-evaluator` 或 `out-of-scope` 覆盖状态、所需权威事实、聚合公式和缺失语义；Runtime 不得把不可观察事实推断为零值或成功值。

#### Scenario: 度量依赖外部系统

- **WHEN** 一项度量依赖 RAG 黄金集、IDE 采纳、代码归因、人员名册、培训或认证系统
- **THEN** 覆盖矩阵将其标记为 `out-of-scope` 并说明所需数据源，Runtime 不产生冒充该度量的事件或 Metric

#### Scenario: 度量由已有事件聚合

- **WHEN** 一项度量可由同一规范事件中的计数、结果或持续时间计算
- **THEN** 覆盖矩阵将其标记为 `derived`，记录分子、分母、时间窗口和未知值处理，而不重复建立第二份事实

### Requirement: Skill 效果度量必须绑定可验证执行事实

Repoctopus MUST 只从同一 Run、Work attempt 和 Host invocation 中已持久化的 Skill consumed 回执、Work 结果、人工决定与正式返工事实计算 Skill 完成、错误、人工修正和复用数据；这些结果只表达相关性，不宣称 Skill 导致成功或失败。

#### Scenario: 使用 Skill 的 Work 成功完成

- **WHEN** Host 以匹配 digest 的回执确认消费 Skill，且同一 Work attempt 的 Outcome 和 Validator 均被接受
- **THEN** 审计事件可以把该次使用计入 Skill 任务完成分子和调用分母，并保留 Run/Work 关联供查询核对

#### Scenario: Work 成功但 Skill 未被确认消费

- **WHEN** Skill 仅处于 resolved 或 delivered，Host 没有提交匹配的 consumed 回执
- **THEN** 该 Work 不计入该 Skill 的完成、错误、人工修正或复用统计

#### Scenario: Skill 使用后发生人工修正

- **WHEN** 已确认消费 Skill 的 Work 随后出现绑定同一结果的 changes-requested、Outcome rejection、Task reopen 或 Repair Work
- **THEN** 遥测记录有界修正类别并允许计算人工修正率，不导出审批正文、代码差异或自由文本原因

### Requirement: Rule 度量只接受机器可验证评估

Repoctopus MUST 只为具有稳定 Rule identity、版本、适用性判定和 Evaluator receipt 的规则记录 expected、triggered、passed 或 violated 结果；Skill 正文、AGENTS 文本或模型自述不得单独证明规则命中或违规。

#### Scenario: 结构化规则在适用场景触发

- **WHEN** 版本化 Evaluator 判定规则适用并提交该规则已触发且通过的持久 Receipt
- **THEN** 遥测允许把该记录计入规则应触发次数、正确触发次数和通过次数

#### Scenario: 自由文本规则没有 Evaluator

- **WHEN** 当前上下文包含规则文本但不存在适用性判定和结构化验证结果
- **THEN** 规则命中率与违规生成率保持未知，不从最终 Work 成功、Skill 加载或 Agent 声明反推

### Requirement: 工作流健康和效率度量必须可复算

Repoctopus MUST 从权威 Run 的开始、终态、workflow identity、阶段边界和有效周期导出工作流执行、失败、复用和持续时间事实；效率提升率由查询端使用相同口径的当前周期与明确基线周期计算。

#### Scenario: 工作流执行失败

- **WHEN** Run 进入持久化失败终态
- **THEN** 同一 Run 贡献一次执行分母和一次失败分子，重放、进程重启或临时导出错误不增加逻辑执行次数

#### Scenario: 团队比较交付周期

- **WHEN** SigNoz 使用同一 workflow/version 和周期定义比较当前窗口与明确基线窗口
- **THEN** 查询可以从权威持续时间计算效率提升率，并把缺少基线或未完成 Run 表示为未知而不是零

### Requirement: 标准 OTLP 部署配置必须完整生效

Telemetry Adapter MUST 支持标准 OTLP 总端点、按信号端点、请求头、服务名和 Resource Attributes 配置，并以确定优先级合并 Repoctopus 默认资源身份；配置缺失或后端不可用不得改变领域结果。

#### Scenario: 团队配置统一 OTLP 端点

- **WHEN** 部署环境提供 `OTEL_EXPORTER_OTLP_ENDPOINT` 和认证请求头
- **THEN** Trace、Log 与 Metric 使用该配置发送到兼容 Collector，凭据不进入配置摘要、领域状态、诊断正文或普通遥测属性

#### Scenario: 部署覆盖 Resource Attributes

- **WHEN** 部署环境提供合法的 `OTEL_SERVICE_NAME` 或 `OTEL_RESOURCE_ATTRIBUTES`
- **THEN** 所有 Repoctopus exporter 使用同一合并规则输出资源属性，并保留规范产品和 schema 身份以支持跨信号关联

#### Scenario: 未配置远端端点
```

Full source: openspec/changes/integrate-runtime-telemetry-measurements/specs/development-telemetry/spec.md
