# OpenTelemetry

Repoctopus 通过标准 OTLP/HTTP 导出适配自部署 SigNoz 等后端。领域层先把每个已持久化事实映射为一份规范 `ObservationEnvelope`；远端后端和本地 Desktop 只做协议编码、传输与独立确认，不再各自解释领域对象。

## 配置

设置标准环境变量后启动 CLI：

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://signoz.example.internal:4318'
$env:REPOCTOPUS_ENVIRONMENT = 'development'
node bin/repoctopus.js evidence run --workspace . --profile verify --json
```

也可以分别使用 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`、`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` 和 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`。两种方式都发送 Trace、Log、Metric；三个信号携带相同 envelope identity 与允许列表语义。

开发中的 Desktop Host 通过 discovery 设置本机会话端点和短期凭据；手工冒烟可显式设置：

```powershell
$env:REPOCTOPUS_DESKTOP_OTLP_ENDPOINT = 'http://127.0.0.1:4319'
$env:REPOCTOPUS_DESKTOP_OTLP_TOKEN = '<session-token>'
```

只配置远端时只有 `remote` 目的地；同时配置上面两个变量时增加 `desktop` 目的地；设置 `REPOCTOPUS_DESKTOP_OTLP_MODE=paused` 会暂停并保留有界积压，设置为 `removed` 或清空 Desktop 端点会移除本地目的地。没有配置任何端点时事实仍然可以落入本地 envelope store，工作流结果不受影响。

## 先落盘，再导出

Trajectory、Attempt、Receipt、Artifact、Bundle、Gate 和轻量 Archive 事实先持久化。之后 Runtime 把允许列表 envelope 原子写入 `.repoctopus/telemetry/observation-envelopes.json`，每个目的地分别推进 cursor。后端失败时：

- Evidence Run 的结果保持有效；
- 只有失败目的地的 cursor 不前进，其他目的地继续发送；
- 后续 Runtime 恢复可以按目的地重放；
- 稳定 envelope ID 令重复投递在投影端收敛，但系统不宣称跨目的地 exactly-once。

目的地具有 `enabled`、`paused`、`removed` 三种保留状态。暂停会保留有界积压；移除会停止该目的地积压增长，且不会重置远端 cursor。超过容量时系统保留明确 gap（丢失数量与首个保留序号）和积压健康信息，而不是伪造连续历史。恢复 Desktop 后先追平其独立 cursor，再进入实时接收。

## 关联模型

- Workflow Run 是根关联 ID。
- Evidence Attempt、节点 Receipt、Artifact 引用和 Gate Outcome 使用稳定 ID 相互关联。
- Receipt 复用通过 `sourceReceiptId` 保留来源身份。
- Attempt 和节点映射为 Span；Artifact、恢复、漂移和 Gate 映射为固定名称 Log/Event；耗时与结果映射为低基数 Metric。
- Workflow、Evidence 与 Delivery 事件都携带当前 composition digest，便于把团队审计结果关联到实际生效的 Provider、Contributor 和配置身份。
- App 生命周期记录插件激活、重载与操作排空结果；排空超时只上报服务名、剩余数量和恢复分类，不上报 Journal 或错误正文。
- App 生命周期批次最多导出两次；仍失败时记录 `LIFECYCLE_TELEMETRY_EXPORT_FAILED` 和 `dropped_after_retry`，不保留 OTLP 错误正文，也不改变领域结果。

### Change lifecycle 关联

每个 accepted Trajectory 事实只产生一个规范 envelope，再编码为标准 OTLP Trace、Log 和 Metric。Desktop Receiver 与远端 SigNoz 因而消费相同身份与语义，不扫描 Workspace、Git 或 MR 反推阶段。

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

Build 的每个已提交边界使用同一条 Trajectory 和 OTLP 管道。`work.*` 事件携带有界的 `buildAction`、execution mode、TDD mode、review mode 和 isolation；`change.lifecycle.transitioned` 携带 Configure approval、Plan revision、Plan Evidence、Check 和 invalidation 的稳定身份；`skill.resolved|delivered|consumed`、`validator.completed` 与 `delegation.completed` 保留父 Work、invocation 和 package 关联。Host 自述不会合成成功事件，事件只在本地 Run 提交后导出。

Trace 和 Log 可以使用 run、Work、configuration、plan、package、invocation、Skill digest 与 delegation execution identity 进行单次运行重建。Metric 只使用以下有界枚举：

- phase、event type、Work kind 和结果；
- `configure|plan|plan-evidence|execute|check` Build Action；
- `autonomous|subagent-driven-development` execution mode；
- `tdd|direct` TDD mode；
- `current|branch|worktree` isolation。

Metric 不使用 run、Task、package、repository、plan、digest、自由 Skill 名称或 Agent identity 作为 label。未知值统一降级为 `unknown`、`custom` 或 `none`，因此恶意或新插件输入不会产生无界时间序列。

Archive 仍使用同一 Run 和相同字段；不创建独立 Post-merge Run，不输出 Webhook、等待远端合入或 `repoctopus.post_merge.*` 平行语义。Publication Receipt 被同一 Run 接受时上报完成；后续 consistency reconcile 只上报有界的检查结果、变化类别和审查状态，不回写历史 phase。

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
