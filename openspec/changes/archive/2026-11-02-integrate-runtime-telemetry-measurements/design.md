---
comet_change: integrate-runtime-telemetry-measurements
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-02-integrate-runtime-telemetry-measurements
status: final
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

领域事件补齐以下稳定关联：

- Skill consumed 与同一 Work attempt 的 accepted/rejected/failed/repair 结果；
- Rule applicability、expected trigger 与 Evaluator receipt；
- Run 开始、唯一终态、workflow identity 和有效周期；
- 人工 changes-requested、Outcome rejection、Task reopen 和 Repair Work 的有界修正类别。

Exporter 输出计数与持续时间，但不在单个进程内维护跨 Run 比率。SigNoz 使用数据字典中的分子、分母和窗口公式计算完成率、错误率、修正率、复用率、规则命中/违规率、工作流失败/复用及效率提升率。重放保留稳定 event identity，查询以逻辑事件去重。

备选方案是在 Runtime 中保存月度聚合状态。它会建立第二份团队分析 Store，并把窗口、时区和组织口径带入领域层，因此不采用。

### 4. Skill 指标表达相关执行结果，不表达因果关系

只有 Host 提交匹配 packet/layer digest 的 consumed 回执后，Skill 才进入调用分母。完成、错误或修正结果必须绑定同一 Work attempt；一个 Work 消费多个 Skill 时，每个 Skill 都可获得相同结果关联，但文档明确这是相关性统计。

精确 Skill identity 进入 Event/Span 供下钻和复用查询；Metric 只使用 `action | augmentation` 角色、`builtin | team | custom` 类别和有界结果，避免自由名称产生高基数。

备选方案是把 Work 成功归功于所有 delivered Skill。它会把未消费 Skill 误报为使用并制造因果结论，因此不采用。

### 5. Rule 指标需要显式适用性和 Evaluator Receipt

增加版本化 Rule evaluation 事实，包含稳定 rule identity/digest、evaluator identity/version、`applicable`、`expected`、`triggered`、`passed | violated | unknown` 和有界 finding category。只有持久 Receipt 才能参与聚合；纯文本规则继续作为方法指导，不自动获得命中率。

首版只接入 Runtime 已拥有结构化 Validator/Evaluator 的规则。它不建立通用内容审查模型，也不尝试让 LLM 自评合规。

备选方案是根据 Skill 是否加载或 Work 是否成功推断规则命中。两者都不能证明规则适用和执行，因此不采用。

### 6. canonical OTLP encoder 共享标准部署配置

平台层提供共享 Resource 与传输配置解析器，按以下优先级合并：

1. Repoctopus 固定的 telemetry schema/product identity；
2. exporter 默认 `service.name` 和包版本；3.合法的 `OTEL_RESOURCE_ATTRIBUTES`；
3. `OTEL_SERVICE_NAME` 对 `service.name` 的标准覆盖；
4. 仅在标准环境属性缺失时使用 `REPOCTOPUS_ENVIRONMENT` 兼容回退。

端点、按信号端点、Headers、TLS 和 timeout 继续由标准 OTel 环境变量驱动；现有 `observationDestinationsFromEnvironment` 仍是 observation delivery 的入口，并扩展为按信号 header/timeout 的标准优先级。Resource 工厂只把非秘密部署元数据交给 OTLP encoder，不记录 Header 值，也不把端点 URL 放入普通属性。Workflow、Evidence、Lifecycle、Delivery adapters 都先生成 canonical envelope，再共用同一个 encoder 与 Delivery Cursor；Desktop token 仍只属于本地 receiver 认证边界。

备选方案是在 `repoctopus.yaml` 增加端点和 Token。它会把机器/环境部署细节混入团队 Git 配置并增加秘密泄露面，因此不采用。

### 7. 22 项指标矩阵是范围和查询合同

参考手册逐项记录候选指标的覆盖状态：

| 分类             | 指标                                                             | 处理                                                |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Runtime 可信范围 | Skill 完成、人工修正、Skill 错误、Skill 复用                     | 补齐关联事实并提供聚合公式                          |
| Runtime 可信范围 | 机器可验证规则命中、机器可验证违规                               | 增加 Rule evaluation receipt；无 Evaluator 时为未知 |
| Runtime 可信范围 | 工作流失败、流程复用                                             | 复用权威 Run 事实并冻结去重口径                     |
| Runtime 可信范围 | 效率提升                                                         | 导出权威周期；查询端与明确基线比较                  |
| 外部评测范围     | 上下文相关性、Hit@5、Recall、Precision、答案准确、幻觉、问题解决 | 记录所需 RAG/评测输入，不上报假数据                 |
| 外部产品范围     | 补全采纳、AI 出码、活跃用户                                      | 需要 IDE、代码归因或身份系统                        |
| 外部治理范围     | 规则更新频率、培训覆盖、认证通过                                 | 需要规则编辑审计或组织培训系统                      |

这里的范围外表示 Repoctopus Runtime 不负责产生事实，不禁止未来通过经过评审的外部 Provider 接入。

### 8. 字段名是版本化协议，不是部署配置

本 Change 冻结当前规范名称并只做向后兼容的增量扩展。SigNoz Dashboard 直接使用公开目录中的名称。任何删除、改名、类型或单位变化都需要新的 Specification change 和 schema 版本；当前实现不提供字段 alias 或 rename map。

备选方案是允许每个部署重命名字段。它会使本地 Desktop、远端 Dashboard、告警和历史数据产生不同契约，因此不采用。

## Risks / Trade-offs

- [一个 Work 消费多个 Skill 时结果被多次关联] → 文档把它定义为“带该 Skill 的 Work 结果”而非贡献归因；查询同时展示样本数，禁止把各 Skill 成功数相加当作 Work 总数。
- [Rule applicability 本身可能判断错误] → 每条记录保留 Evaluator identity/version 和 Receipt；没有可验证 Evaluator 时保持未知。
- [自由 Skill/Rule identity 导致时间序列爆炸] → 精确 identity 只进入 Event/Span，Metric 经有界目录降级为角色或 `custom`。
- [标准环境变量合并改变现有默认 Resource] → 用跨 exporter 表驱动测试冻结优先级；保留兼容环境回退并在文档中标出。
- [删除旧直连 exporter 使历史测试失去覆盖] → 先把其协议、Span/Metric 和故障断言移到 canonical pipeline E2E，再删除入口；生产 composition 与公开 CLI 不依赖这些类，因此不增加旧版兼容层。
- [同一 envelope 同时保留 JSON 与展开属性造成 payload 增长] → JSON 只承担 Desktop 可逆消费，展开字段严格来自目录允许列表；用体积上限、敏感字段和基数测试约束增长。
- [自动生成参考表降低可读性] → 只生成规范目录区块，接入说明、指标公式和示例查询仍人工编写并接受文档审查。
- [当前 Dashboard Change 的观测合同与实现分支不一致] → 以已归档主规格和当前 Change Delta 为权威；若发现相同事件/字段存在冲突定义，停止实现并先修正规格，不自行选择一套。
- [OTLP/SigNoz 实际部署不可访问] → 本 Change 用协议级 mock receiver 验证全部配置；真实公司环境验收作为非阻塞后续验证，不伪造连接结论。

## Migration Plan

1. 先冻结当前主线的 canonical envelope/outbox、Desktop receiver、远端目的地解析、Runtime stability facts 和现有 exporter 所有公开名称，建立 schema v1 目录与快照测试，证明没有重建平行管线、意外删除或改名。
2. 保留 `observationDestinationsFromEnvironment` 的传输职责，补齐按信号 header/timeout 与 Resource/service name 语义，让 canonical encoder 输出可查询 OTLP Resource、Span/Event 和 Metric，同时保留 Desktop 可逆 envelope。
3. 把旧直连 exporter 的有效测试迁移到 canonical pipeline E2E，确认生产 composition 与公共入口没有调用者后删除旧入口，不保留平行 mapping 或兼容层。
4. 以 additive 领域事实和属性补齐 Skill、Rule、Run 周期与返工关联；已持久化旧 envelope 仍能按 schema v1 重放，缺失字段保持 unknown。
5. 增加 22 项覆盖矩阵、完整参考手册和文档生成检查，再以 mock OTLP receiver 验证 Trace、Log、Metric 与文档名称一致。
6. 若需回退，停止产生新增 additive 事实并回退 canonical encoder 版本；不得恢复直连 exporter、静默复用已变更字段名或改变已持久化 envelope identity。

## Stop Conditions

- 主规格、当前 Dashboard Change、真实 exporter 或测试对同一公开名称、类型、单位或语义存在冲突。
- 某项拟纳入指标没有权威领域事实，只能依赖 Prompt、模型自述、最终状态或时间邻近推断。
- 标准 OTel SDK 对端点、Header 或 Resource 优先级的实际行为与设计假设不一致。
- 实现需要把 Credential、组织身份、自由文本或高基数精确 identity 放入 Metric label。
- 实现需要恢复已被主线删除的旧结构、绕过 canonical observation outbox，或为旧补丁增加兼容层。
