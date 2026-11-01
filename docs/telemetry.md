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

正常的 Change Run 会自动启动或激活 Desktop，Runtime 再从受保护的 discovery 取得本机会话端点和短期凭据。只有在隔离的 Receiver 冒烟测试中才显式设置：

```powershell
$env:REPOCTOPUS_DESKTOP_OTLP_ENDPOINT = 'http://127.0.0.1:4319'
$env:REPOCTOPUS_DESKTOP_OTLP_TOKEN = '<session-token>'
```

只配置远端时只有 `remote` 目的地；同时配置上面两个变量时增加 `desktop` 目的地；设置 `REPOCTOPUS_DESKTOP_OTLP_MODE=paused` 会暂停并保留有界积压，设置为 `removed` 或清空 Desktop 端点会移除本地目的地。没有配置任何端点时事实仍然可以落入本地 envelope store，工作流结果不受影响。

源码和安装态激活方法见[启动或恢复 Desktop Dashboard](desktop-activation.md)。桌面不可用只影响本地观测，不改变 Change Run 或远端目的地。

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

| 属性                                                | 含义                                   |
| --------------------------------------------------- | -------------------------------------- |
| `repoctopus.run.id`                                 | 原 Change Run 根关联 ID                |
| `repoctopus.change.id`                              | 通过安全格式检查的 change ID           |
| `repoctopus.change.phase.before` / `.phase`         | accepted transition 前后的 phase       |
| `repoctopus.change.status.before` / `.status`       | transition 前后的 Run status           |
| `repoctopus.change.work.active/id/kind`             | 当前 Work；inactive 事件显式清除旧值   |
| `repoctopus.change.task.id`                         | 当前 Task 的稳定 ID（若有）            |
| `repoctopus.change.validator.id/version/digest`     | 当前 Validator 的版本身份              |
| `repoctopus.change.wait.active/id/kind`             | 当前等待；inactive 事件显式清除旧值    |
| `repoctopus.change.wait.reason_category`            | 有界等待类别，不是自由文本 reason      |
| `repoctopus.evidence.*`                             | Evidence Attempt、Bundle、Gate 关联    |
| `repoctopus.action.receipt.id`                      | Runtime Action Dispatcher Receipt      |
| `repoctopus.runtime.invalidation.classification`    | `semantic` 或 `approval-authority`     |
| `repoctopus.runtime.invalidation.disposition`       | 当前为有界 `invalidate`                |
| `repoctopus.runtime.invalidation.scope`             | `exact`；未知范围使用保守路径          |
| `repoctopus.runtime.invalidation.continuation`      | Runtime 选择的有界后继，如 `design`    |
| `repoctopus.runtime.invalidation.retained_count`    | Trace/Log 中保留的 typed identity 数量 |
| `repoctopus.runtime.invalidation.invalidated_count` | Trace/Log 中失效的 typed identity 数量 |

Build 的每个已提交边界使用同一条 Trajectory 和 OTLP 管道。`work.*` 事件携带有界的 `buildAction`、execution mode、TDD mode、review mode 和 isolation；`change.lifecycle.transitioned` 携带 Configure approval、Plan revision、Plan Evidence、Check 和 invalidation 的稳定身份；`skill-composition.compiled|rejected|drifted`、`skill-binding.resolved` 与 `skill.resolved|delivered|consumed|consumption-rejected` 保留组合、binding/slot、冻结顺序、replacement identity、角色、父 Work 与 invocation 关联。角色区分 Action、内置 augmentation、team guidance 和 team replacement。Host 自述不会合成成功事件，`consumed` 只表示回执摘要属于当前 packet，不代表方法被正确执行；缺失、未知或旧 layer 只生成有界失败类别并阻止 Outcome。事件只在本地 Run 提交后导出。

核心可靠性还使用四个有界事件：`work.packet-stored` 只记录 `created | reused`，`work.packet-recovered` 只记录 `recovered | missing | corrupt | legacy`；`specification.artifacts-observed` 只记录 Proposal、Specs、Design、Tasks 的 `ready | skipped | missing`；`specification.validation-observed` 只记录 valid、最高严重级、三级计数和 contract-conflict。Trace/Log 可以携带 run/work/attempt/epoch 与摘要关联，Metric 只使用上述固定枚举，不使用 changeId、digest、路径、诊断 code/message 或 packet 正文作为 label。遥测提交失败不改变 claim、恢复或 Gate 结果。

Trace 和 Log 可以使用 run、Work、configuration、plan、package、invocation、Skill digest 与 delegation execution identity 进行单次运行重建。Metric 只使用以下有界枚举：

- phase、event type、Work kind 和结果；
- `configure|plan|plan-evidence|execute|check` Build Action；
- `autonomous|subagent-driven-development` execution mode；
- `tdd|direct` TDD mode；
- `current|branch|worktree` isolation。

Metric 不使用 run、Task、package、repository、plan、composition/binding digest、自由 Skill 名称、binding ID、slot ID 或 Agent identity 作为 label。这些高基数值仅进入受允许列表保护的 Trace/Event 关联。未知值统一降级为 `unknown`、`custom` 或 `none`，因此恶意或新插件输入不会产生无界时间序列。

### Runtime 稳定性指标

团队可以从持久 Trajectory fact 复算以下指标；Dashboard 和 SigNoz 不各自解释本地文件：

| 指标                           | 计算                                                                   | 用途                           |
| ------------------------------ | ---------------------------------------------------------------------- | ------------------------------ |
| 重复批准率                     | 相同 planning semantic identity 的额外 approval request / 全部 request | 发现批准身份过宽或幂等失败     |
| Protocol 重建率                | Design 返工后从空 Configure 重建 / 全部返工                            | 发现失效放大                   |
| 精确失效率                     | `scope=exact` / 全部 invalidation                                      | 判断依赖矩阵覆盖质量           |
| Completion 保留率              | 保留 completion / 返工前 completion                                    | 判断局部返工效率               |
| Checkpoint 恢复率              | `recovered` / 全部恢复尝试                                             | 判断中断恢复健康度             |
| Duplicate dispatch suppression | 被抑制的重复派发 / 重复 pull                                           | 发现 Runner 重试噪声和幂等质量 |

Metric label 只使用 authority、classification、scope、result 和 continuation 等固定枚举。具体 identity、digest、Work ID 和 reason 只进入 Trace/Event 允许列表，不能作为 SigNoz Metric 维度。

OTLP 使用两个稳定 instrument：`repoctopus.runtime.stability.events` 对每个版本化稳定性 fact 计数，`repoctopus.runtime.stability.items` 记录 retained/invalidated identity 与 completion 数量。后者把数量作为 measurement value；`measure` 只取 `retained-identities | invalidated-identities | completion-before | completion-retained`，不会把任意数值变成 label。SigNoz 中按 `kind`、`authority`、`result`、`classification`、`scope` 或 `continuation` 聚合即可复算上表比率。

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
