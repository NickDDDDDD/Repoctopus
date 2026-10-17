# OpenTelemetry 与 SigNoz

Repoctopus 使用官方 OpenTelemetry SDK 输出 OTLP/HTTP，可连接团队自部署的 SigNoz Community。遥测用于团队内部追踪、事后排查和评估 AI 辅助研发效果；领域事实仍以本地 Trajectory 与 Checkpoint 为准。

## 信号

- 每个领域事件生成一个短 Span，并复用 Run 的 Trace ID。
- 同一事件生成结构化 Log/Event，保留 Run、Workflow、阶段和事件关联标识。
- `repoctopus.workflow.events` Counter 统计输出事件数。
- 交付事件生成结构化 Log，并通过 `repoctopus.delivery.events` Counter 记录 checkpoint、批准、发布、失败恢复和合入状态变化。

## 隐私边界

普通属性采用允许列表，只发送低基数标识与结果。源码、Prompt、Summary、验证报告正文、MR 正文、绝对路径、Git remote、环境变量值、授权头、Cookie、Token 和截图正文不会进入普通属性。后续制品上传必须使用引用和独立访问控制，不能把原始内容塞入属性。

## 故障语义

OTLP 端点未配置时 Runtime 使用空 exporter。端点不可用时业务转换已经落盘，命令返回 `telemetry.export-failed` warning，不回滚工作流。成功发送后才推进 `telemetry-cursor.json`；下次状态变化会从旧 Cursor 补发，保持原事件 ID。

## 本地配置

直接向 OTLP/HTTP Receiver 发送：

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318"
$env:REPOCTOPUS_ENVIRONMENT = "development"
node bin/repoctopus.js run start --workspace . --project-root .. --json
```

也可以运行 `deploy/signoz/otel-collector.dev.yaml` 中的 Collector 示例，再把其中 `signoz-otel-collector:4317` 改成团队 SigNoz Collector 的实际内网地址。配置文件不包含凭据。
