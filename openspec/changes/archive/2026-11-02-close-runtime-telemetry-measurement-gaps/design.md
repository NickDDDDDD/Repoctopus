---
comet_change: close-runtime-telemetry-measurement-gaps
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-02-close-runtime-telemetry-measurement-gaps
status: final
---

# Design

## Context

参见 [proposal.md](proposal.md) 的动机。当前遥测由 Runtime、Evidence、Lifecycle 和 Delivery 等多个 exporter 分别建立 Resource、Span、Log 和 Metric；事件映射已有允许列表和低基数约束，但公开目录仍分散在代码与测试中。现有环境入口能判断 OTLP 端点和部分 Resource 配置是否存在，却没有一条共享、可测试的资源合并路径；例如检测到 `OTEL_RESOURCE_ATTRIBUTES` 中的部署环境后，exporter 仍可能使用默认环境。

Dashboard Change 已要求本地与远端消费相同 OTLP 语义。本 Change 在其上游补齐规范数据契约和度量事实，不实现 Dashboard UI，也不建立另一套投影协议。

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

建立版本化 observation contract 作为公开 OTLP 名称、类型、单位、枚举、基数和隐私边界的机器权威；Runtime 与 Trajectory 只持久化可重放事实，Telemetry mapping 只进行纯投影，比例、趋势和效率提升由 SigNoz 按数据字典在查询端复算。所有 exporter 复用共享 OTel Resource 与环境配置工厂。

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

### 2. 原始事实优先，比例和趋势在查询端聚合

领域事件补齐以下稳定关联：

- Skill consumed 与同一 Work attempt 的 accepted/rejected/failed/repair 结果；
- Rule applicability、expected trigger 与 Evaluator receipt；
- Run 开始、唯一终态、workflow identity 和有效周期；
- 人工 changes-requested、Outcome rejection、Task reopen 和 Repair Work 的有界修正类别。

Exporter 输出计数与持续时间，但不在单个进程内维护跨 Run 比率。SigNoz 使用数据字典中的分子、分母和窗口公式计算完成率、错误率、修正率、复用率、规则命中/违规率、工作流失败/复用及效率提升率。重放保留稳定 event identity，查询以逻辑事件去重。

备选方案是在 Runtime 中保存月度聚合状态。它会建立第二份团队分析 Store，并把窗口、时区和组织口径带入领域层，因此不采用。

### 3. Skill 指标表达相关执行结果，不表达因果关系

只有 Host 提交匹配 packet/layer digest 的 consumed 回执后，Skill 才进入调用分母。完成、错误或修正结果必须绑定同一 Work attempt；一个 Work 消费多个 Skill 时，每个 Skill 都可获得相同结果关联，但文档明确这是相关性统计。

精确 Skill identity 进入 Event/Span 供下钻和复用查询；Metric 只使用 `action | augmentation` 角色、`builtin | team | custom` 类别和有界结果，避免自由名称产生高基数。

备选方案是把 Work 成功归功于所有 delivered Skill。它会把未消费 Skill 误报为使用并制造因果结论，因此不采用。

### 4. Rule 指标需要显式适用性和 Evaluator Receipt

增加版本化 Rule evaluation 事实，包含稳定 rule identity/digest、evaluator identity/version、`applicable`、`expected`、`triggered`、`passed | violated | unknown` 和有界 finding category。只有持久 Receipt 才能参与聚合；纯文本规则继续作为方法指导，不自动获得命中率。

首版只接入 Runtime 已拥有结构化 Validator/Evaluator 的规则。它不建立通用内容审查模型，也不尝试让 LLM 自评合规。

备选方案是根据 Skill 是否加载或 Work 是否成功推断规则命中。两者都不能证明规则适用和执行，因此不采用。

### 5. 所有 exporter 共享标准 OTel Resource 工厂

平台层提供共享 Resource 配置解析器，按以下优先级合并：

1. Repoctopus 固定的 telemetry schema/product identity；
2. exporter 默认 `service.name` 和包版本；
3.合法的 `OTEL_RESOURCE_ATTRIBUTES`；
4. `OTEL_SERVICE_NAME` 对 `service.name` 的标准覆盖；
5. 仅在标准环境属性缺失时使用 `REPOCTOPUS_ENVIRONMENT` 兼容回退。

端点、按信号端点、Headers、TLS、超时和 SDK 支持的传输配置继续由标准 OTel 环境变量驱动。共享工厂不记录 Header 值，也不把端点 URL 放入普通属性。Runtime、Evidence、Lifecycle、Delivery 与后续 Desktop 目的地使用同一解析和测试矩阵。

备选方案是在 `repoctopus.yaml` 增加端点和 Token。它会把机器/环境部署细节混入团队 Git 配置并增加秘密泄露面，因此不采用。

### 6. 22 项指标矩阵是范围和查询合同

参考手册逐项记录候选指标的覆盖状态：

| 分类 | 指标 | 处理 |
| --- | --- | --- |
| Runtime 可信范围 | Skill 完成、人工修正、Skill 错误、Skill 复用 | 补齐关联事实并提供聚合公式 |
| Runtime 可信范围 | 机器可验证规则命中、机器可验证违规 | 增加 Rule evaluation receipt；无 Evaluator 时为未知 |
| Runtime 可信范围 | 工作流失败、流程复用 | 复用权威 Run 事实并冻结去重口径 |
| Runtime 可信范围 | 效率提升 | 导出权威周期；查询端与明确基线比较 |
| 外部评测范围 | 上下文相关性、Hit@5、Recall、Precision、答案准确、幻觉、问题解决 | 记录所需 RAG/评测输入，不上报假数据 |
| 外部产品范围 | 补全采纳、AI 出码、活跃用户 | 需要 IDE、代码归因或身份系统 |
| 外部治理范围 | 规则更新频率、培训覆盖、认证通过 | 需要规则编辑审计或组织培训系统 |

这里的范围外表示 Repoctopus Runtime 不负责产生事实，不禁止未来通过经过评审的外部 Provider 接入。

### 7. 字段名是版本化协议，不是部署配置

本 Change 冻结当前规范名称并只做向后兼容的增量扩展。SigNoz Dashboard 直接使用公开目录中的名称。任何删除、改名、类型或单位变化都需要新的 Specification change 和 schema 版本；当前实现不提供字段 alias 或 rename map。

备选方案是允许每个部署重命名字段。它会使本地 Desktop、远端 Dashboard、告警和历史数据产生不同契约，因此不采用。

## Risks / Trade-offs

- [一个 Work 消费多个 Skill 时结果被多次关联] → 文档把它定义为“带该 Skill 的 Work 结果”而非贡献归因；查询同时展示样本数，禁止把各 Skill 成功数相加当作 Work 总数。
- [Rule applicability 本身可能判断错误] → 每条记录保留 Evaluator identity/version 和 Receipt；没有可验证 Evaluator 时保持未知。
- [自由 Skill/Rule identity 导致时间序列爆炸] → 精确 identity 只进入 Event/Span，Metric 经有界目录降级为角色或 `custom`。
- [标准环境变量合并改变现有默认 Resource] → 用跨 exporter 表驱动测试冻结优先级；保留兼容环境回退并在文档中标出。
- [自动生成参考表降低可读性] → 只生成规范目录区块，接入说明、指标公式和示例查询仍人工编写并接受文档审查。
- [当前 Dashboard Change 的观测合同与实现分支不一致] → 以已归档主规格和当前 Change Delta 为权威；若发现相同事件/字段存在冲突定义，停止实现并先修正规格，不自行选择一套。
- [OTLP/SigNoz 实际部署不可访问] → 本 Change 用协议级 mock receiver 验证全部配置；真实公司环境验收作为非阻塞后续验证，不伪造连接结论。

## Migration Plan

1. 从现有 exporter、映射和测试提取当前公开名称，建立 schema v1 目录与快照测试，先证明无意外删除或改名。
2. 统一 Resource/环境配置解析并在 Runtime、Evidence、Lifecycle 和 Delivery exporter 上运行同一测试矩阵。
3. 以 additive 事件和属性补齐 Skill、Rule、Run 周期与返工关联；旧消费者忽略未知字段仍可工作。
4. 增加 22 项覆盖矩阵、完整参考手册和文档生成检查，再以 mock OTLP receiver 验证 Trace、Log、Metric 与文档名称一致。
5. 若需回退，停止新增事件映射并恢复旧 exporter；已有 additive 字段可由消费者忽略。不得用回退静默复用已变更的字段名或单位。

## Stop Conditions

- 主规格、当前 Dashboard Change、真实 exporter 或测试对同一公开名称、类型、单位或语义存在冲突。
- 某项拟纳入指标没有权威领域事实，只能依赖 Prompt、模型自述、最终状态或时间邻近推断。
- 标准 OTel SDK 对端点、Header 或 Resource 优先级的实际行为与设计假设不一致。
- 实现需要把 Credential、组织身份、自由文本或高基数精确 identity 放入 Metric label。
