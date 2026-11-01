# Configure OpenTelemetry

本指南帮助你把 Repoctopus 的 Trace、Log 和 Metric 通过标准 OTLP HTTP 上报到 SigNoz 或兼容的 OpenTelemetry Collector。字段名、类型、单位和指标公式见生成的 [Telemetry schema v1 reference](./telemetry-reference.md)。

Repoctopus 不提供字段别名或字段改名配置。你应当在 SigNoz Dashboard 中直接使用 schema v1 字段，这样本地 Desktop Receiver 与远端 SigNoz 会消费同一套事实。

## 配置

### 使用一个 Collector endpoint

在启动 Repoctopus 的同一进程环境中设置标准变量：

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://signoz.example.internal:4318'
$env:OTEL_SERVICE_NAME = 'repoctopus-company-platform'
$env:OTEL_RESOURCE_ATTRIBUTES = 'service.namespace=developer-platform,deployment.environment.name=development'
node bin/repoctopus.js evidence run --workspace . --profile verify --json
```

统一 endpoint 会分别追加 `/v1/traces`、`/v1/logs` 和 `/v1/metrics`。如果你的 Collector 暴露不同路径，请分别设置：

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`

按信号 endpoint 优先于统一 endpoint。只设置一个按信号 endpoint 时，Repoctopus 只启用该信号；它不会猜测其他 endpoint。

### 配置认证和超时

如果 Collector 需要认证，请通过 `OTEL_EXPORTER_OTLP_HEADERS` 传递 URL 编码的键值对。按信号的 `OTEL_EXPORTER_OTLP_<SIGNAL>_HEADERS` 优先于共享 headers。

```powershell
$env:OTEL_EXPORTER_OTLP_HEADERS = 'authorization=Bearer%20opaque-token,x-tenant=developer-platform'
$env:OTEL_EXPORTER_OTLP_TIMEOUT = '10000'
```

你也可以使用 `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`、`OTEL_EXPORTER_OTLP_LOGS_TIMEOUT` 或 `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT` 覆盖单个信号。超时单位是毫秒。

不要把 endpoint、header 或 token 放进 `OTEL_RESOURCE_ATTRIBUTES`。Resource 属性会随每个信号发送，并用于查询；认证信息只属于 exporter 配置。

### 配置优先级

Repoctopus 按以下顺序解析配置，靠前者优先：

1. 调用方显式传入的 exporter 超时。
2. 按信号 endpoint、headers 和 timeout。
3. 共享 endpoint、headers 和 timeout。
4. SDK 默认超时。

`OTEL_SERVICE_NAME` 覆盖 Repoctopus 的默认服务名。标准 `deployment.environment.name` Resource 属性优先于兼容变量 `REPOCTOPUS_ENVIRONMENT`。固定的 `repoctopus.product.name=repoctopus` 和 `repoctopus.telemetry.schema=1` 不能被部署配置覆盖。

没有配置任何 endpoint 时，Repoctopus 使用空 exporter。Collector 不可用时，业务事实仍先持久化，遥测失败不改变 Work、Evidence 或 Delivery 的结果。

## Schema v1 兼容性

Schema v1 把公开的 Resource、Span、Event/Log、Metric 和 Attribute 名称视为协议。补充可选字段是兼容变更；删除、改名、改变类型/单位，或把高基数 identity 加进 Metric label，必须升级 schema 并经过评审。

生成器从 `domains/telemetry/observation-contract.ts` 生成完整参考。`npm run check:generated` 会在代码目录与参考手册漂移时失败。字段名不是部署参数；本次不支持组织别名、Collector Transform 或 SigNoz 私有 API。

## 先落盘，再导出

Attempt、Receipt、Artifact、Bundle 和 Gate 先持久化。之后 Runtime 把允许列表事件写入 `.repoctopus/evidence/telemetry/`，导出成功才推进 cursor。后端失败时：

- Evidence Run 的结果保持有效；
- cursor 不前进；
- `evidence resume --attempt <id>` 或后续 Runtime 恢复可以重放；
- 稳定 event ID 和 cursor 防止同一客户端重复导出已经确认的事件。

## 关联模型

- Workflow Run 是根关联 ID。
- Evidence Attempt、节点 Receipt、Artifact 引用和 Gate Outcome 使用稳定 ID 相互关联。
- Receipt 复用通过 `sourceReceiptId` 保留来源身份。
- Attempt 和节点映射为 Span；Artifact、恢复、漂移和 Gate 映射为固定名称 Log/Event；耗时与结果映射为低基数 Metric。
- Workflow、Evidence 与 Delivery 事件都携带当前 composition digest，便于把团队审计结果关联到实际生效的 Provider、Contributor 和配置身份。
- App 生命周期记录插件激活、重载与操作排空结果；排空超时只上报服务名、剩余数量和恢复分类，不上报 Journal 或错误正文。
- App 生命周期批次最多导出两次；仍失败时记录 `LIFECYCLE_TELEMETRY_EXPORT_FAILED` 和 `dropped_after_retry`，不保留 OTLP 错误正文，也不改变领域结果。

### Change lifecycle 关联

每次 accepted `change.lifecycle.transitioned` 由一个纯映射器产生 `phase`、`status`、`work` 和 `wait` 四类 OTLP Log。它们共享 `repoctopus.event.id`，因此 Desktop Receiver 与远端 SigNoz 消费完全相同的上报事实，不扫描 Workspace、Git 或 MR 反推阶段。

| 属性                                            | 含义                                 |
| ----------------------------------------------- | ------------------------------------ |
| `repoctopus.run.id`                             | 原 Change Run 根关联 ID              |
| `repoctopus.change.id`                          | 通过安全格式检查的 change ID         |
| `repoctopus.change.phase.before` / `.phase`     | accepted transition 前后的 phase     |
| `repoctopus.change.status.before` / `.status`   | transition 前后的 Run status         |
| `repoctopus.change.work.active/id/kind`         | 当前 Work；inactive 事件显式清除旧值 |
| `repoctopus.change.task.id`                     | 当前 Task 的稳定 ID（若有）          |
| `repoctopus.change.validator.id/version/digest` | 当前 Validator 的版本身份            |
| `repoctopus.change.wait.active/id/kind`         | 当前等待；inactive 事件显式清除旧值  |
| `repoctopus.change.wait.reason_category`        | 有界等待类别，不是自由文本 reason    |
| `repoctopus.evidence.*`                         | Evidence Attempt、Bundle、Gate 关联  |
| `repoctopus.action.receipt.id`                  | Runtime Action Dispatcher Receipt    |

Archive 仍使用同一 Run 和相同字段；不创建独立 Post-merge Run，也不输出 `repoctopus.post_merge.*` 平行语义。Publication Receipt 被同一 Run 接受时上报完成；后续 consistency reconcile 只上报有界的检查结果、变化类别和审查状态，不回写历史 phase。

Log 和 Span 可以携带这些高基数关联 ID。Metric 只使用工作流名、事件类型、动作结果、Evidence Adapter、状态等有界维度；它们不使用 Run、change、Attempt、Bundle、Delivery、Envelope 或 Receipt ID，避免时间序列数量随执行次数增长。

## 隐私边界

OTel 属性只允许稳定 ID、Adapter、状态、可信等级、耗时，以及 Artifact 的类型、摘要、大小、MIME 和脱敏标记。以下内容不会进入属性：

- 命令输出、服务日志与健康响应正文；
- DOM、截图正文、视觉请求或响应；
- 本机绝对路径；
- token、密码、Cookie、Authorization 或其他敏感值。

原始内容只保存在受本机保留策略管理的 Artifact Store 中。遥测失败诊断也不会被写回领域事实。

Change lifecycle 映射只读取 accepted transition fact 中的枚举、稳定 ID 和摘要；自由文本 wait reason 只映射为有界 category。格式异常、疑似 Token、绝对路径、换行和超长值都会被拒绝。Action summary、规格正文、MR body、commit message、仓库 URL、文件列表和平台响应正文不进入关联属性。

本地 Desktop 与远端 SigNoz 消费同一套 OTLP 事件和属性；Desktop Receiver 不扫描 `.repoctopus/` 或轮询 CLI，因此两个显示端不会因各自推断状态而分叉。Desktop 只负责当前 change 的低延迟视图，SigNoz 负责团队历史、趋势和流程改进。
