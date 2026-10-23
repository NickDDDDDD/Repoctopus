# 遥测数据与恢复契约

Repoctopus 先持久化领域事实，再生成不可变的观测 envelope。团队 OTLP 后端和本地桌面 Dashboard 消费同一份规范数据，但分别维护投递确认和健康状态。

本文是开发者参考。配置和故障演练步骤见[配置 OpenTelemetry 与桌面 Dashboard](telemetry.md)。

## 持久化布局

| 路径                                                       | 内容                                     |
| ---------------------------------------------------------- | ---------------------------------------- |
| `.repoctopus/telemetry/v1/envelopes/<envelope-id>.json`    | 不可变的规范 Observation Envelope        |
| `.repoctopus/telemetry/v1/destinations/remote-otlp.json`   | 团队 OTLP 目的地 Cursor、健康和 gap      |
| `.repoctopus/telemetry/v1/destinations/desktop-local.json` | 本地 Dashboard 目的地 Cursor、健康和 gap |

`envelopeId` 由版本化来源身份计算，`digest` 覆盖规范 envelope 内容。不同目的地只能执行协议编码、发送和确认，不能重新解释领域对象。

## 目的地状态

| 状态      | 投递行为               | 积压行为                                               |
| --------- | ---------------------- | ------------------------------------------------------ |
| `enabled` | 投递并在成功后独立确认 | 未确认的当前保留集构成积压                             |
| `paused`  | 不投递                 | 保留积压；恢复启用后继续重放                           |
| `removed` | 不投递                 | 记录当前未确认数据的移除 gap，随后停止该目的地积压增长 |

目的地从 `removed` 重新启用时，以当时仍保留的 envelope 建立新基线，不追溯移除期间的数据。任何状态转换都不能修改另一个目的地的 Cursor。

积压摘要由当前 envelope 保留集和目的地确认集合计算，不作为第二份状态持久化。Cursor schema v2 兼容读取 v1 的确认集合。

## 保留与 gap

默认保留预算同时应用以下上限：

| 上限          | 默认值 |
| ------------- | ------ |
| Envelope 数量 | 10,000 |
| 总字节数      | 64 MiB |
| 最长保留时间  | 7 天   |
| Gap 历史      | 32 条  |

Store 删除超限 envelope 前，先为所有尚未确认该数据的非 removed 目的地原子写入 `retention-limit` gap。若 gap 写入中断，envelope 保持在磁盘上，重启后可以重试；稳定 gap identity 防止重复累计。

Gap 历史有界，但累计丢弃数量和字节不会随旧 gap 压缩而重置。存在 gap 时，消费者必须把投影视为不完整，不能把当前快照解释为完整历史。

## 投递保证

Repoctopus 提供 at-least-once 投递：

- 先原子保存 envelope，再向各目的地发送；
- 只有目的地成功响应后才推进该目的地确认集合；
- 进程在发送成功后、确认提交前退出时，重启会再次发送同一 envelope；
- 目的地使用稳定事件身份去重或收敛重复投递。

Repoctopus 不提供跨多个 HTTP 目的地的分布式事务，因此不宣称 exactly-once。

## 信号映射

- Workflow Run 是根关联 ID。
- Evidence Attempt、节点 Receipt、Artifact 引用和 Gate Outcome 使用稳定 ID 相互关联。
- Receipt 复用通过 `sourceReceiptId` 保留来源身份。
- Attempt 和节点映射为 Span；Artifact、恢复、漂移和 Gate 映射为固定名称 Log/Event；耗时与结果映射为低基数 Metric。
- Workflow、Evidence 与 Delivery 事件都携带当前 composition digest，用于关联实际生效的 Provider、Contributor 和配置身份。
- App 生命周期记录插件激活、重载与操作排空结果；排空超时不包含 Journal 或错误正文。
- App 生命周期批次最多导出两次；仍失败时记录 `LIFECYCLE_TELEMETRY_EXPORT_FAILED` 和 `dropped_after_retry`，但不改变领域结果。

## 可信关联模型

Repoctopus 只从当前 envelope 对应的持久事件或同版本状态建立关联。消费者必须把缺失属性解释为“尚未上报”，不能根据文本、最新 Run 状态或自定义 trigger facts 补造值。

| 状态       | 属性                                                                                     | 持久事实来源                                                                   |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Workspace  | `repoctopus.workspace.id`                                                                | Run 固定的 Project Snapshot `projectId`                                        |
| change     | `repoctopus.change.id`                                                                   | Run 的固定 `changeId` 或 Delivery State `changeId`                             |
| Run        | `repoctopus.run.id`                                                                      | Run State `runId`                                                              |
| 父子执行   | `repoctopus.execution.id`、`repoctopus.execution.parent.id`、`repoctopus.execution.kind` | Run→Action、Run→Evidence Attempt、Attempt→Evidence Node 的持久关系             |
| 阶段       | `repoctopus.stage.name`                                                                  | `run.started` 的工作流入口、已持久化 Action `stepId` 或 Delivery Approval 状态 |
| 执行主体   | `repoctopus.execution.subject.kind`、`.id`、`.provider`                                  | Evidence Receipt 的 Adapter 或 Delivery Approval 的可信 Actor                  |
| 任务       | `repoctopus.task.id`、`.type`、`.ref`、`.status`                                         | 已持久化 Action、Evidence Receipt 或 Human Decision Request                    |
| 验证       | `repoctopus.verification.id`、`.status`、`.outcome`                                      | Evidence Attempt 与 Gate 事件                                                  |
| 阻塞       | `repoctopus.blocker.category`、`.request.id`                                             | `ask_user` Action、阻塞的 Evidence Gate 或 Human Decision Request              |
| 下一步动作 | `repoctopus.next_action.id`、`.type`、`.ref`、`.stage`                                   | `action.proposed` 或仍处于等待状态的 Human Decision Request                    |
| 观测时间   | `repoctopus.observed_at` 和 OTLP 时间字段                                                | 领域事件 `timestamp`；不使用接收时间或最新状态更新时间                         |

当前 Run State 没有持久化 Agent 身份。因此 Workflow Action 不导出推断的 Agent；只有 Evidence Adapter 和可信人工决策 Actor 能作为执行主体。任意 `trigger.facts.agentId`、`parentRunId` 或事件附带的自由文本 `nextAction` 都不会进入公共属性。

## Post-merge 关联

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

OTLP 属性只允许稳定 ID、Adapter、状态、可信等级、耗时，以及 Artifact 的类型、摘要、大小、MIME 和脱敏标记。以下内容不会进入属性：

- 命令输出、服务日志与健康响应正文；
- DOM、截图正文、视觉请求或响应；
- 本机绝对路径；
- token、密码、Cookie、Authorization 或其他敏感值。

原始内容只保存在受本机保留策略管理的 Artifact Store 中。遥测失败诊断不会被写回领域事实。

Post-merge 属性映射还会拒绝格式异常、疑似 Token、绝对路径、换行和超长值。Action summary、规格正文、MR body、commit message、仓库 URL、文件列表和 webhook payload 不进入关联属性。
