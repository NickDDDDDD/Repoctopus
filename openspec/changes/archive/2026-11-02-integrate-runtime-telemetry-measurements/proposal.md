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
