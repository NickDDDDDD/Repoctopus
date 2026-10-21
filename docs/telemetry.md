# OpenTelemetry

Repoctopus 通过标准 OTLP HTTP 导出适配自部署 SigNoz 等后端。领域层只产生稳定事实，不依赖具体观测产品。

## 配置

设置标准环境变量后启动 CLI：

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://signoz.example.internal:4318'
$env:REPOCTOPUS_ENVIRONMENT = 'development'
node bin/repoctopus.js evidence run --workspace . --profile verify --json
```

也可以分别使用 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` 和 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`。没有配置端点时使用空实现，不影响本地 Evidence。

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

### Post-merge 关联

Post-merge Workflow Log 和 Span 使用持久身份连接平台合入、Evidence、规格关闭和远端发布，不复制对应内容。

| 属性                                       | 含义                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `repoctopus.run.id`                        | Post-merge Run 根关联 ID                                                    |
| `repoctopus.post_merge.change.id`          | 通过安全格式检查的 change ID                                                |
| `repoctopus.post_merge.merge_facts.digest` | 排序后权威合入事实的摘要                                                    |
| `repoctopus.evidence.attempt.id`           | 当前 Evidence Attempt                                                       |
| `repoctopus.evidence.bundle.id`            | Gate 使用的 Evidence Bundle                                                 |
| `repoctopus.evidence.gate.status`          | `satisfied` 或 `blocked`                                                    |
| `repoctopus.action.receipt.id`             | Runtime Action Dispatcher Receipt                                           |
| `repoctopus.post_merge.receipt.kind`       | `checkout-manifest`、`specification-closure`、`path-audit` 或 `publication` |
| `repoctopus.post_merge.receipt.id`         | 对应领域 Receipt 或 Manifest 摘要                                           |

Log 和 Span 可以携带这些高基数关联 ID。Metric 只使用工作流名、事件类型、动作结果、Evidence Adapter、状态等有界维度；它们不使用 Run、change、Attempt、Bundle、Delivery、Envelope 或 Receipt ID，避免时间序列数量随执行次数增长。

## 隐私边界

OTel 属性只允许稳定 ID、Adapter、状态、可信等级、耗时，以及 Artifact 的类型、摘要、大小、MIME 和脱敏标记。以下内容不会进入属性：

- 命令输出、服务日志与健康响应正文；
- DOM、截图正文、视觉请求或响应；
- 本机绝对路径；
- token、密码、Cookie、Authorization 或其他敏感值。

原始内容只保存在受本机保留策略管理的 Artifact Store 中。遥测失败诊断也不会被写回领域事实。

Post-merge 属性映射还会拒绝格式异常、疑似 Token、绝对路径、换行和超长值。Action summary、规格正文、MR body、commit message、仓库 URL、文件列表和 webhook payload 不进入关联属性。
