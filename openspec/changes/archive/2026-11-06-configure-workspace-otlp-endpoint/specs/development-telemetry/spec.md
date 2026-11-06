# Spec Delta

## MODIFIED Requirements

### Requirement: 标准 OTLP 部署配置必须完整生效

Telemetry Adapter MUST 支持在工作区 `repoctopus.yaml` 中声明可选的 `telemetry.endpoint` 作为远端 OTLP/HTTP 基础地址。按信号环境变量端点优先于公共环境变量端点，公共环境变量端点优先于工作区地址。Telemetry Adapter MUST 保留标准 OTLP 请求头、服务名和 Resource Attributes 配置，并以确定优先级合并 Repoctopus 默认资源身份。配置缺失或后端不可用不得改变领域结果。

#### Scenario: 工作区仅用 YAML 配置 Collector

- **WHEN** 协调仓在 `telemetry.endpoint` 填写一个合法的 HTTP 或 HTTPS Collector 基础 URL，并且没有 OTLP 环境变量端点
- **THEN** 从该工作区启动的 Runtime 使用这个地址发送 traces、logs 和 metrics，保留可选的 URL 路径前缀并追加相应的 `/v1/{signal}`

#### Scenario: 团队配置统一 OTLP 端点

- **WHEN** 部署环境提供 `OTEL_EXPORTER_OTLP_ENDPOINT` 和认证请求头
- **THEN** Trace、Log 与 Metric 使用该配置发送到兼容 Collector，凭据不进入配置摘要、领域状态、诊断正文或普通遥测属性

#### Scenario: 单类信号覆盖默认地址

- **WHEN** 工作区配置了基础 URL，且一个信号的完整端点由环境变量提供
- **THEN** 该信号使用它的环境变量端点，其余信号按公共环境变量端点或 YAML 地址投递

#### Scenario: 部署覆盖 Resource Attributes

- **WHEN** 部署环境提供合法的 `OTEL_SERVICE_NAME` 或 `OTEL_RESOURCE_ATTRIBUTES`
- **THEN** 所有 Repoctopus exporter 使用同一合并规则输出资源属性，并保留规范产品和 schema 身份以支持跨信号关联

#### Scenario: 未配置远端端点

- **WHEN** 工作区和进程都没有 OTLP 端点配置
- **THEN** 远端导出保持禁用，Run、Evidence 与 Delivery 继续工作且不产生连接重试

#### Scenario: 工作区 URL 无效或包含认证信息

- **WHEN** `telemetry.endpoint` 不是有效的绝对 HTTP(S) URL，或包含凭据、查询参数或片段
- **THEN** 工作区配置验证以字段路径拒绝该值，诊断不回显 URL 内容；认证请求头继续通过环境变量配置
