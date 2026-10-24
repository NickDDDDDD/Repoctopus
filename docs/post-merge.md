# Archive / Post-merge 运维与恢复

Post-merge 不是第二个 Run。Business MR 合入、精确 merge commit 核对、临时检出、Evidence、规格同步、路径审计、commit、push 和最终 Change MR 都属于原 Change Run 的 `archive` phase。Webhook 与 `post-merge reconcile` 只唤醒并重新查询平台事实；它们不能直接推进 Run、关闭规格或创建 MR。

## 首先读取权威投影

```powershell
$workspace = 'C:\work\team-platform'
$runId = 'change-team-platform-example-1'
node bin/repoctopus.js run status --workspace $workspace --run $runId --json
```

重点读取 `changeLifecycle.phase/status/currentWork/waitCondition/blocker/evidence/nextActions`。不要从当前目录、分支名、MR 作者或 webhook payload 猜测进度。`run status` 是只读命令，能够在 `migration_required` 和部分失败时使用。

| 当前 Work                | 意义                                       | 恢复入口               |
| ------------------------ | ------------------------------------------ | ---------------------- |
| `delivery.prepare`       | 冻结 Delivery Intent、验证报告和策略       | `run archive-prepare`  |
| `delivery.await-merge`   | Business MR 已发布，等待完整权威合入事实   | `run archive-refresh`  |
| `delivery.verify-merged` | 在精确 merge commit 上执行 Post-merge Gate | `run archive-verify`   |
| `specification.archive`  | 同步主规格、归档 change、审计并发布最终 MR | `run archive-complete` |

## Archive 命令

这些命令都通过生产 project composition、CommandRouter 和 WorkflowRuns 执行，没有测试旁路：

```powershell
node bin/repoctopus.js run archive-prepare --workspace $workspace --run $runId --attempt <attempt-id> --intent <intent.yaml> --json
node bin/repoctopus.js run archive-publish --workspace $workspace --run $runId --json
node bin/repoctopus.js run archive-refresh --workspace $workspace --run $runId --json
node bin/repoctopus.js run archive-verify --workspace $workspace --run $runId --profile post-merge --json
node bin/repoctopus.js run archive-complete --workspace $workspace --run $runId --json
```

调用方不能跳到后面的命令：每个命令都核对当前 phase、Work、Run stateVersion、Contributor/Skill/Specification compatibility 和前一 Receipt。重试使用相同 Run identity；Intent/Receipt 与 closure journal 会复用已确认副作用，不重复 commit、push 或建 MR。

## Webhook 与最终一致兜底

Runner 启动时会处理 durable Inbox；没有常驻 Runner 时，任何团队成员也可以运行：

```powershell
node bin/repoctopus.js post-merge reconcile --workspace $workspace --json
node bin/repoctopus.js event status --workspace $workspace --envelope <envelope-id> --json
node bin/repoctopus.js event retry --workspace $workspace --envelope <envelope-id> --json
```

Reconcile 可由任意机器运行，因为 change 不归某个提交者或 Runner 所有。它按稳定 MR identity 查找候选，再通过平台 API 查询权威状态；不会把“当前执行者”变成文档 MR 的作者，也不会依据 MR author 分配 ownership。开始新开发任务时的 preflight 可执行一次 Reconcile，提供最终一致兜底。

Webhook payload 只提供唤醒键。即使 payload 声称 merged，Change Run 也必须接受重新查询得到的完整 MR 集合和精确 merge commit 后才离开等待。乱序、重复或其他人的修复 MR 都通过同一集合对账。

## 常见阻断

| 现象                                      | 原因与处理                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `delivery.await-merge` + `platform-event` | 仍有 Business MR 打开。等待人工合入后运行 `archive-refresh` 或 Reconcile。                  |
| MR closed 但未 merged                     | 稳定阻断，人工决定修复、替换或重开交付；不得伪造 merge fact。                               |
| merge commit 不匹配                       | 停止。检查目标分支和平台返回，不得用 rebase/force-push 改写已批准来源。                     |
| Post-merge Evidence failed                | 修复实现并按完整 Business MR 集合增加补充交付，再重新验证；不能复用失败 Bundle。            |
| `target-merge-conflict`                   | 在受管 checkout 审查并解决，保留锁定 parent 的普通 merge commit；不要 squash/rebase。       |
| `Repoctopus-Closure-Audit` 失败           | 只允许 closure plan 声明的规格、审计和发布路径；移除意外改动后重试。                        |
| `final-change-publication-failed`         | 修复网络/权限后重试 `archive-complete`；`merge_request.create_or_recover` 会复用已创建 MR。 |
| `migration_required`                      | 先运行只读 lifecycle migration plan；旧 Delivery/Post-merge 写命令不会继续双写。            |

## 精确合入验证

`archive-verify` 为每个实现仓创建隔离临时检出，并检出平台返回的精确 merge commit。一个仓有多个 Business MR 时使用该仓最后合入、且包含前序结果的目标分支 commit。Evidence 指纹绑定仓库 identity、commit、工作树和 composition；任何漂移都会使 Gate 失败或 superseded。

```powershell
node bin/repoctopus.js evidence status --workspace $workspace --attempt <attempt-id> --json
node bin/repoctopus.js evidence resume --workspace $workspace --attempt <attempt-id> --json
```

Evidence 恢复完成后仍要让同一 Change Run 接受 Gate 结果。`run resume` 只恢复 RunStore Journal/Checkpoint 并核对项目快照，不会重新查询 MR，也不会跳过 Evidence。

## 规格关闭与最终 Change MR

`archive-complete` 的可恢复事务依次执行：

1. 把 Change 分支目标合入受管 checkout，锁定 parent 与结果 tree。
2. 通过唯一 Specification Provider 重新生成并核对 closure plan。
3. 运行 OpenSpec archive，同步主规格并归档四类 change 产物。
4. 审计实际修改路径，只暂存允许集合。
5. 创建普通 closure commit 并立即普通 push，核对远端 OID。
6. 以 create-or-recover 创建最终 Change MR；Runtime 不自动 merge。
7. 将 closure、audit、push 与 MR Receipt 作为 `archive-completed` fact 提交给原 Change Run，然后才标记 completed。

任一步骤响应丢失后，重试先读取 closure journal 和远端事实。已经发生的副作用只在 identity、摘要和目标完全相同的情况下复用；否则 fail closed。分支作者、Git 作者、当前 Runner 或文档 MR 提交者都不等于 change owner。

## Store 与临时目录

Workspace 是规格与工作流入口，OpenSpec Store 是其每机逻辑登记，实现仓保存业务代码。业务仓的 `openspec/config.yaml` pointer 可选；Archive 始终使用 Run 冻结的 Store identity。更换或注销本机 Store 时先停止 Runner/Desktop 并确认没有活动 Archive；使用 `openspec store unregister`，不要使用会删除目录的 `store remove`。

临时检出位于 `postMerge.temporaryRoot`。只删除已经由 Receipt 标记终结、且不含冲突或人工修复的检出；活动 closure journal、未合并路径或失败 Evidence 对应目录必须保留到恢复完成。

## OTLP 关联

按 `repoctopus.run.id` 和 `repoctopus.change.id` 查询同一 Change Run。每个 accepted transition 用同一 `repoctopus.event.id` 输出：

- `repoctopus.change.phase`
- `repoctopus.change.status`
- `repoctopus.change.work.*`
- `repoctopus.change.wait.*`

Archive 不再生成 `repoctopus.post_merge.*` 或独立 Post-merge Run identity。Evidence 与 Action 仍使用 `repoctopus.evidence.*` 和 `repoctopus.action.receipt.id` 关联。属性不包含规格正文、MR body、commit message、仓库 URL、绝对路径、命令输出或凭据。

## 后续阅读

- [交付治理与失败恢复](delivery.md)
- [状态、轨迹与恢复](runtime-state.md)
- [Specification Provider](specification.md)
- [平台事件](platform-events.md)
- [Evidence](evidence.md)
- [OpenTelemetry](telemetry.md)
