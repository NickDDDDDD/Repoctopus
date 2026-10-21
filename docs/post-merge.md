# 运维和恢复 Post-merge 收尾

本指南帮助团队 Runner 维护者判断 Change 为什么尚未生成最终 Change MR，并从最后一个可确认边界安全恢复。最短排障路径是先运行 `post-merge reconcile`，再同时检查 Delivery 和 Run；不要提前手工创建最终 MR，也不要通过 rebase、force-push、删除分支或修改持久状态文件绕过失败。

Delivery v3 把三个阶段分开记录：Business MR 集合是否全部合入、规格关闭分支是否发布成功、最终 Change MR 是否创建。最终 MR 只在前两项完成后出现。

## 准备关联 ID

在 Workspace 中运行命令，并准备 change ID。只有已经创建 Post-merge Run 时才需要 run ID；检查平台投递或 Evidence 时再准备 Envelope ID 和 Attempt ID。

```powershell
$workspace = Resolve-Path .
$changeId = 'enable-self-hosted-development'
$runId = 'post-merge-<sha256>'
$envelopeId = '<envelope-id>'
$attemptId = '<attempt-id>'
```

这些值用于关联持久事实，不代表授权。不要把 webhook payload、Token、Header、命令输出或规格正文复制到遥测标签或 MR 评论中。

## 先判定当前状态

先执行一次补偿检查，然后读取 Delivery；存在 Run 时再读取 Run。

```powershell
node bin/repoctopus.js post-merge reconcile --workspace $workspace --json
node bin/repoctopus.js delivery status --workspace $workspace --change $changeId --json
node bin/repoctopus.js run status --workspace $workspace --run $runId --json
```

用下表判定下一步。表中的字段都来自命令 JSON 或 Runner 的稳定诊断码。

| 状态                  | 可观察信号                                                                                                                                                                    | 下一步                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 等待 Business MR 合入 | Reconcile 返回 `post-merge-business-merge-requests-open` 或 `post-merge-business-merge-requests-incomplete`；Delivery 的 `mergeEvidence` 尚未覆盖全部 `businessMergeRequests` | 等待或修复对应 Business MR。不要启动关闭，也不要创建最终 MR。最后一个 MR 合入后重新执行 Reconcile。                                 |
| 规划漂移              | 规划批准仍绑定旧 `changeBranch.remoteOid`，而远端 Change 分支已经变化；Delivery 准备报告缺少有效 planning approval                                                            | 在业务发布前重新生成规划批准并人工确认。不要复用旧批准，也不要直接改 Delivery 状态。                                                |
| 目标合并冲突          | Run 停在 `close-specification`，Runner 报告 `target-merge-conflict`；托管检出中存在 `MERGE_HEAD` 和未合并路径                                                                 | 人工审查并解决托管检出中的冲突，创建保留两个锁定 parent 的普通 merge commit，再执行 Reconcile。不要 rebase、squash 或推送临时检出。 |
| 关闭发布失败          | Run 停在 `publish`；Delivery 的 `closure.status` 和 `finalChangeMergeRequest.status` 为 `failed`，错误码为 `final-change-publication-failed`                                  | 保留 Journal 和远端分支，修复凭据、权限或暂时故障，然后执行 Reconcile。发布成功前不会创建最终 MR。                                  |
| 最终 MR 恢复          | Change 分支已经是预期收尾 OID，但本地没有发布 Receipt，或平台已存在同 head/base 的唯一开放 MR                                                                                 | 执行 Reconcile。系统查询并复用唯一 MR、核对 head OID 后补写 Receipt；不要手工创建第二个 MR。                                        |

如果 Reconcile 返回 `post-merge-business-merge-request-closed`、`post-merge-merge-facts-incomplete`，或最终 MR 存在多个匹配、已关闭但未合入、head/base 漂移，请停止自动恢复并人工修复权威事实。这些情况不能通过重复命令安全收敛。

## 恢复等待中的 Business MR

1. 运行 `delivery status`，确认每个 `businessMergeRequests[].mergeRequest` 都是已批准集合中的身份。
2. 在代码平台处理仍开放的 MR，或修复“关闭但未合入”的阻断状态。
3. 合入最后一个 Business MR 后重新运行 Reconcile。
4. 确认 Reconcile 从 `waiting` 进入 `post-merge-ready` 或 `post-merge-completed`。

Webhook 只负责唤醒。Reconcile 会重新查询平台权威状态，不依赖原 webhook payload，也不按 MR 作者、Git 作者或 Runner identity 过滤候选项。

## 恢复规划漂移

规划批准绑定四类 OpenSpec 规划产物、Provider、配置、Change 分支映射和精确远端 OID。先读取批准快照：

```powershell
node bin/repoctopus.js spec approval status --workspace $workspace --change $changeId --json
```

如果 Change 分支在批准后发生了普通 push，原批准必须失效。业务发布尚未开始时，使用当前公开分支重新准备批准：

```powershell
node bin/repoctopus.js spec approval prepare --workspace $workspace --change $changeId --branch spec/$changeId --target main --remote origin --json
```

由可信的人机入口重新批准，再重新准备 Delivery。若 Business MR 已经发布或合入，不要用新 OID 覆盖现有 Delivery；保留现状并进入显式 repair 流程，因为已批准集合和 Post-merge Run 身份也绑定旧快照。

## 恢复目标合并冲突

Post-merge 会在托管临时检出中，把锁定的目标分支 OID 以普通 merge 合入 Change 分支。冲突不会修改远端 Change 分支。

1. 运行 `run status`，确认 `currentStep` 是 `close-specification`。
2. 在配置项 `postMerge.temporaryRoot` 下找到 `.repoctopus-post-merge-checkout.json` 中 `runId` 等于当前 Run 的目录。
3. 在该目录的 `change-*` 仓库中运行 `git status` 和 `git diff --name-only --diff-filter=U`，审查每个冲突。
4. 解决冲突后使用标准 Git 流程暂存文件，并以 `git commit --no-edit` 完成当前 merge。不要改变两个 parent，不要 rebase、squash、force-push，也不要直接推送这个临时检出。
5. 重新运行 Reconcile。Runner 会核对 merge commit 的两个 parent、干净工作树、锁定远端 OID，再继续 Provider 关闭。

不要删除 Closure Journal。Journal 保存已经锁定的 Change OID 和目标 OID；删除它会丢失恢复依据，而不是重置 Change。

## 恢复关闭发布或最终 MR

先同时读取 Run 和 Delivery：

```powershell
node bin/repoctopus.js run status --workspace $workspace --run $runId --json
node bin/repoctopus.js delivery status --workspace $workspace --change $changeId --json
```

按以下顺序判断：

1. `currentStep` 仍是 `close-specification` 或 `audit-paths`：先修复 Provider 校验、关闭计划或路径审计问题。不要进入发布。
2. `currentStep` 是 `publish` 且 `closure.status` 为 `failed`：修复 Git 或平台访问问题，保留 Journal，然后运行 Reconcile。
3. 远端 Change 分支已包含预期收尾 commit，但 `finalChangeMergeRequest.status` 为 `creating` 或 `failed`：直接运行 Reconcile，让 create-or-recover 查询平台。
4. `closure.status` 为 `succeeded` 且 `finalChangeMergeRequest.status` 为 `open`：恢复已完成，等待人类评审和合入最终 MR。

```powershell
node bin/repoctopus.js post-merge reconcile --workspace $workspace --json
```

恢复顺序固定为 `merge_target → commit → push → merge_request.create_or_recover`。Git commit 响应丢失时复用同一 commit；push 响应丢失时核对远端精确 OID；MR 创建响应丢失时按仓库、source 和 target 查询唯一开放 MR。多个匹配、关闭 MR、分支映射漂移或 head OID 不一致都会 fail-closed。

## 只恢复 Run Store 事务

`run resume` 只对账 Run Store 的 Checkpoint、Trajectory 和未完成的本地持久事务。它不会重新查询 Business MR，也不会重新执行 Post-merge 的 Git、Provider 或平台副作用。

```powershell
node bin/repoctopus.js run resume --workspace $workspace --run $runId --json
```

只有 `run status`、`doctor` 或 Runner 日志表明 Run Store 转换在提交期间中断时才使用它。事务恢复完成后，仍然通过 Reconcile 驱动 Post-merge。

## 检查平台事件和 Evidence

如果 Delivery 已经登记但没有出现 Reconcile 候选或 Run，检查持久 Inbox：

```powershell
node bin/repoctopus.js event status --workspace $workspace --envelope $envelopeId --json
```

只有状态为 `dead_letter`，且权限、配置或暂时故障已经修复时，才显式重试：

```powershell
node bin/repoctopus.js event retry --workspace $workspace --envelope $envelopeId --json
```

当 Run 停在 `evidence` 时，读取 Attempt、节点 Receipt、Artifact 和 Gate：

```powershell
node bin/repoctopus.js evidence status --workspace $workspace --attempt $attemptId --json
node bin/repoctopus.js evidence resume --workspace $workspace --attempt $attemptId --json
```

`failed` Gate 表示验证真实失败，修复后需要新的验证代次。`superseded` 表示执行期间输入变化，确认仓库状态后再创建新 Attempt。Evidence 恢复完成后执行 Reconcile，不能靠 `run resume` 跳过 Evidence Gate。

## 使用 OTel 关联持久事实

在 OTLP Log 或 Span 中先按 `repoctopus.run.id` 查找 Run，再使用以下属性连接各系统：

| 事实                                       | 关联属性                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Business MR 合入事实                       | `repoctopus.post_merge.merge_facts.digest`                               |
| Change                                     | `repoctopus.post_merge.change.id`                                        |
| Evidence                                   | `repoctopus.evidence.attempt.id`、`repoctopus.evidence.bundle.id`        |
| Action Receipt                             | `repoctopus.action.receipt.id`                                           |
| 检出、规格关闭、路径审计或远端发布 Receipt | `repoctopus.post_merge.receipt.kind`、`repoctopus.post_merge.receipt.id` |

Receipt ID 和摘要只用于 Log/Span 关联。Metric 标签只包含工作流名、事件类型、结果、Evidence Adapter 和状态等低基数值，不包含 Run、Change、Attempt、Bundle、Delivery 或 Receipt ID。

## 后续阅读

- [交付治理与失败恢复](delivery.md)：理解 Delivery v3、批准边界和最终 MR 状态。
- [平台事件](platform-events.md)：检查 webhook 持久化、去重、Lease 和死信语义。
- [Evidence](evidence.md)：解释 Attempt、Receipt、Artifact、Bundle 和 Gate。
- [OpenTelemetry](telemetry.md)：查看属性允许列表、导出恢复和隐私边界。
