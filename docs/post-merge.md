# 观察和恢复 Post-merge 收尾

本指南帮助团队 Runner 运维者定位 Post-merge Run 停在哪个持久边界，并从该边界安全恢复。你可以只依赖平台事件、Delivery、Run、Evidence 和 Receipt 身份排障，不需要原开发者的本机工作区。

配置 `platformEvents` 和 `postMerge` 后，`runner start` 会把 Post-merge Coordinator、Action Provider 与 Application Plugin 加入专用 Runner composition。普通 project composition 仍保持短生命周期，不会启动 HTTP 或后台轮询。本指南用于正式 Runner 和恢复演练产生的同一套持久状态。

## 准备关联 ID

在协调 workspace 中运行命令。开始前准备 change ID 和 Post-merge Run ID；如果需要检查平台唤醒或 Evidence，再准备 Envelope ID 和 Attempt ID。

```powershell
$workspace = Resolve-Path .
$projectRoot = Resolve-Path ..
$changeId = 'enable-self-hosted-development'
$runId = 'post-merge-<sha256>'
$envelopeId = '<envelope-id>'
$attemptId = '<attempt-id>'
```

这些值是关联身份，不是授权。不要把 webhook payload、Token、Header、命令输出或规格正文复制到遥测标签或 MR 评论中。

## 1. 检查平台投递

如果收尾 Run 没有出现，先检查持久 Inbox，而不是重新发送未经核对的 webhook payload。

```powershell
node bin/repoctopus.js event status --workspace $workspace --envelope $envelopeId --json
```

当状态为 `dead_letter` 且你已经修复权限、配置或暂时故障时，显式请求一次重试：

```powershell
node bin/repoctopus.js event retry --workspace $workspace --envelope $envelopeId --json
```

`event retry` 不接受 `completed`、活动 Lease、`pending` 或已经处于 `retry_wait` 的投递。它保留原 Envelope 和 Receipt 历史，不创建第二条逻辑投递。

## 2. 检查 Delivery 合入事实

当平台投递已经完成但 Run 尚未启动时，检查 Delivery 是否已经观察到全部业务 MR 的权威 merge commit。

```powershell
node bin/repoctopus.js delivery status --workspace $workspace --change $changeId --json
```

只有 Delivery 状态为 `merged`，且原协调 MR 仍开放、源分支和目标分支未变化时，Runner 才能进入收尾发布。不要用 force-push、rebase、新建 MR 或修改目标分支绕过漂移诊断。

## 3. 检查 Post-merge Run

使用 Run 状态确定当前持久边界。固定步骤依次为 `checkout`、`evidence`、`close-specification`、`audit-paths` 和 `publish`。

```powershell
node bin/repoctopus.js run status --workspace $workspace --run $runId --json
```

如果进程在持久事务之间退出，先确认协调 workspace 和项目仓库没有未解释的改动，再恢复 Run：

```powershell
node bin/repoctopus.js run resume --workspace $workspace --project-root $projectRoot --run $runId --json
```

恢复只对账已经持久化的 Checkpoint、Action Receipt 和当前项目快照。它不会跳过 Evidence Gate，也不会把漂移的本地或远端提交改写成预期状态。

## 4. 检查 Evidence

当 Run 停在 `evidence` 时，读取 Attempt、节点 Receipt、Artifact 引用和 Gate Projection：

```powershell
node bin/repoctopus.js evidence status --workspace $workspace --attempt $attemptId --json
```

如果 Evidence 已落盘但 OTLP 导出或进程响应中断，使用同一 Attempt ID 恢复：

```powershell
node bin/repoctopus.js evidence resume --workspace $workspace --attempt $attemptId --json
```

`failed` Gate 表示验证真实失败；修复业务问题后需要新的验证代次。`superseded` 表示输入指纹在执行期间变化；先确认仓库状态，再启动新的 Attempt。

## 5. 根据收尾边界处理故障

每个阶段只接受与其持久 Receipt 一致的恢复路径。

| 当前边界              | 可安全恢复的事实                                            | 必须停止并人工处理的情况                            |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `checkout`            | Manifest 与精确 merge commit 一致                           | remote 身份、merge commit 或托管目录所有权变化      |
| `evidence`            | 同一 Attempt、Receipt、Bundle 和 Gate                       | 输入漂移、required check 失败、composition 不兼容   |
| `close-specification` | 同一关闭计划返回同一 Closure Receipt                        | Provider、计划摘要或规格权威变化                    |
| `audit-paths`         | diff 与路径及内容摘要完全一致                               | 业务源码、未知文件、符号链接或额外规格路径出现      |
| `publish`             | 既有提交是基线的唯一直接子提交，远端 OID 和原 MR 元数据一致 | MR 已关闭、分支映射改变、远端被改写或出现未授权操作 |

在 `publish` 恢复中，Git 响应丢失会复用同一 commit；push 响应丢失会核对远端精确 OID；MR update 响应丢失会重新读取原 MR 的 title/body。任何核对失败都会停止，不会自动 merge、force-push、rebase、删除分支或创建新 MR。

## 6. 使用 OTel 关联持久事实

在 OTLP Log 或 Span 中先按 `repoctopus.run.id` 查找 Run，再用以下属性连接各系统：

| 事实                                       | 关联属性                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| 合入事实                                   | `repoctopus.post_merge.merge_facts.digest`                               |
| change                                     | `repoctopus.post_merge.change.id`                                        |
| Evidence                                   | `repoctopus.evidence.attempt.id`、`repoctopus.evidence.bundle.id`        |
| Action Receipt                             | `repoctopus.action.receipt.id`                                           |
| 检出、规格关闭、路径审计或远端发布 Receipt | `repoctopus.post_merge.receipt.kind`、`repoctopus.post_merge.receipt.id` |

Receipt ID 和摘要只用于 Log/Span 关联。Metric 标签只包含工作流名、事件类型、结果、Evidence Adapter 和状态等低基数值，不包含 Run、change、Attempt、Bundle、Delivery 或 Receipt ID。

## 后续阅读

完成状态定位后，根据故障所在边界继续阅读对应说明：

- [交付治理与失败恢复](delivery.md)：理解 Delivery 快照、人工批准和原协调 MR 边界。
- [平台事件](platform-events.md)：检查 webhook 持久化、去重、Lease 和死信语义。
- [Evidence](evidence.md)：解释 Attempt、Receipt、Artifact、Bundle 和 Gate 的关系。
- [OpenTelemetry](telemetry.md)：查看属性允许列表、导出恢复和隐私边界。
