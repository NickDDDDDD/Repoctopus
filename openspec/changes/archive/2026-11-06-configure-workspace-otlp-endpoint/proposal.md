# Proposal

## Why

团队已经能向远端 OTLP Collector 上报遥测，但每台开发机都要给 Runtime 进程设置环境变量。协调仓提供一个共享 URL 后，团队可以直接从该工作区启动 Repoctopus。

## What Changes

- 在协调仓的 `repoctopus.yaml` 支持可选的 `telemetry.endpoint`，一个 OTLP/HTTP 基础 URL 供 traces、logs 和 metrics 使用。
- 保留已有环境变量配置。按信号端点优先于公共环境变量端点，公共环境变量端点优先于工作区 YAML。
- 更新使用文档和示例。认证 Header、超时和 Resource 属性沿用现有环境变量，遥测字段继续使用既有协议。

## Capabilities

### New Capabilities

### Modified Capabilities

- `development-telemetry`：定义工作区默认 Collector 地址、覆盖优先级、URL 边界和未配置行为。

## Impact

影响工作区配置解析、Project Composition 的 OTLP 投递配置、部署文档及验收。团队只需在协调仓配置一次；兼容既有纯环境变量部署。
