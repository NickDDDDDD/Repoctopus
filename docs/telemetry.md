# OpenTelemetry

Repoctopus 通过标准 OTLP HTTP 导出适配自部署 SigNoz 等后端。领域层只产生稳定事实，不依赖具体观测产品。

## 配置遥测目的地

你可以单独启用团队 OTLP 后端，也可以同时自动激活本地 Desktop。Repoctopus 使用标准 `OTEL_EXPORTER_OTLP_*` 变量配置远端；`REPOCTOPUS_DESKTOP_AUTOSTART=0` 只关闭后续开发 Run 的 Desktop 自动激活，不会关闭远端出口。

`telemetry config` 是只读诊断命令。它不会连接后端、启动 Desktop 或输出 endpoint 值。

### 只使用远端 OTLP

设置远端 endpoint，并关闭 Desktop 自动激活：

<!-- telemetry-smoke:remote-only -->

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://signoz.example.internal:4318'
$env:REPOCTOPUS_DESKTOP_AUTOSTART = '0'
$env:REPOCTOPUS_ENVIRONMENT = 'development'
node bin/repoctopus.js telemetry config --json
```

结果中的 `remote.enabled` 为 `true`，`desktop.autostart` 为 `disabled`。Runtime 仍向远端导出，Desktop 不会随新开发 Run 自动启动。

### 同时使用远端和 Desktop

将 Desktop 自动激活设为 `1`。下一次开发 Run 会启动或激活 Desktop，并唤醒本地积压重放：

<!-- telemetry-smoke:remote-and-desktop -->

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://signoz.example.internal:4318'
$env:REPOCTOPUS_DESKTOP_AUTOSTART = '1'
node bin/repoctopus.js telemetry config --json
```

结果中的远端和 Desktop 都处于启用状态。两个目的地独立确认 envelope；一个目的地失败不会推进另一个目的地的 cursor。

### 关闭 Desktop 自动激活

如果 Desktop 已在运行，请先从应用中完全退出。然后关闭后续开发 Run 的自动激活；远端 endpoint 保持不变：

<!-- telemetry-smoke:desktop-closed -->

```powershell
$env:REPOCTOPUS_DESKTOP_AUTOSTART = '0'
node bin/repoctopus.js telemetry config --json
```

结果中的 `desktop.autostart` 为 `disabled`，`remote.enabled` 仍为 `true`。本地 Desktop 停止不会重置远端 cursor。

### 恢复 Desktop

重新启用自动激活。下一次以 `run start --change ...` 启动的新开发 Run 会激活 Desktop，并从本地目的地未确认位置重放：

<!-- telemetry-smoke:desktop-recovered -->

```powershell
$env:REPOCTOPUS_DESKTOP_AUTOSTART = '1'
node bin/repoctopus.js telemetry config --json
```

结果中的 `desktop.replayOnNextDevelopmentRun` 为 `true`。传输语义是可重放的 at-least-once；稳定事件身份让投影收敛，但系统不宣称 exactly-once。

也可以分别设置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` 和 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`。未配置任何远端 endpoint 时，远端使用空实现，不影响领域结果或本地 Desktop。

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

本地 Desktop 与远端 SigNoZ 消费同一套 OTLP 事件和属性；Desktop Receiver 不扫描 `.repoctopus/` 或轮询 CLI，因此两个显示端不会因各自推断状态而分叉。Desktop 只负责当前 change 的低延迟视图，SigNoZ 负责团队历史、趋势和流程改进。

桌面端五种数据状态、Skill consumption 证据边界、四类健康信号和排障顺序参见 [Repoctopus Desktop Dashboard](desktop-dashboard.md)。
