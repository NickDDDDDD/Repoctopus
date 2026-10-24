# 状态、轨迹与恢复

## Change Run 是唯一生命周期权威

一个 Workspace、change 和 generation 最多有一个未终结 Change Run。它按 `Open → Design → Build → Verify → Archive` 推进，`phase`、`status`、当前 Work、Task progress、wait、blocker、Evidence 和 next actions 都来自同一条 accepted trajectory。Specification、Delivery、Webhook、CLI、Desktop 与 OTLP 只能提交事实或读取 `ChangeRunProjection`，不能维护另一套阶段状态。

```powershell
node bin/repoctopus.js run status --workspace . --run <run-id> --json
```

文本和 JSON 输出使用同一投影。`freshness.stateVersion` 与 `freshness.trajectoryOffset` 表示投影对应的持久版本；看到等待或阻断时应处理投影给出的 next action，不能通过编辑 `.repoctopus/`、分支名或 MR 状态跳过转换。

每个 Run 都保存在 `.repoctopus/runs/<run-id>/`：

| 文件                    | 含义                                                     |
| ----------------------- | -------------------------------------------------------- |
| `workflow.json`         | 启动时冻结的 Workflow Package 与摘要                     |
| `project-snapshot.json` | 启动时冻结的多仓事实                                     |
| `run.json`              | 当前 Run State                                           |
| `trajectory.jsonl`      | 按顺序追加的领域事件                                     |
| `checkpoint.json`       | 当前状态版本、轨迹偏移、关键摘要和已接受 Evidence Bundle |
| `transition.json`       | 尚未完成转换的 Journal；正常完成后删除                   |
| `transition.lock`       | 跨进程转换锁；正常完成后删除                             |
| `telemetry-cursor.json` | 已成功发送的最后一个轨迹序号                             |

## 转换协议

1. 原子取得 `transition.lock`；仍存活的持有者使竞争写入等待，进程已经退出的陈旧锁可以回收。
2. 重新读取锁内 Run 和 Workflow，校验事件属于当前 Run、事件版本等于新状态版本，并对比当前 `stateVersion`。受 Evidence 保护的动作同时核对 Attempt 绑定和当前多仓输入指纹。
3. 原子写入 `transition.json` 并刷盘。
4. 写入完整且以换行结束的 `trajectory.jsonl`。
5. 原子写入 `run.json`。
6. 原子写入 `checkpoint.json`，包括本次状态已经接受的 Evidence Bundle ID。
7. 删除 Journal 并释放转换锁。

重启后只要 Journal 存在，Runtime 会检查已经完成的步骤并继续执行缺失步骤。相同事件不会重复追加。轨迹缺少最终换行、包含无效 JSON、序号断裂或重复事件 ID 时，Runtime 返回损坏诊断，不会静默截断证据。

## Composition 兼容

Run、Checkpoint 和 Trajectory 保存完整 composition 身份。写转换前，WorkflowRuns 比较当前组合：摘要相同则继续；只涉及明确兼容的无状态 Contributor 或配置摘要变化时记录 `composition.changed`；受保护 Provider、状态 Schema 或权威能力变化时返回 `migration_required`。后一种状态仍允许 `status` 和 `doctor` 读取，不允许 `next`、`record` 或 `resume` 写入。

普通插件重载由 Cordis Loader 先卸载旧 Fiber，再激活新 Fiber。Run 不依赖旧 Fiber 的内存对象，恢复依据始终是 Store、Journal 与 Checkpoint。

Change Run 还冻结 Lifecycle Definition、Work Contributor、Validator、Extension、Skill 与 Specification Provider 身份。只改变顺序或声明为向后兼容的 Contributor 升级可更新快照；核心 transition、Validator 或写入范围漂移会进入 `migration_required`。使用 `change-lifecycle migration-plan` 先做只读判断，再执行受控迁移；规划阶段不会写 Store 或调用平台。

## 恢复时的多仓核对

`run resume` 会重新执行只读 Project Probe，将远端身份、路径、分支、HEAD 和工作树摘要与启动快照比较。没有变化时 Run 可继续；出现任何变化时 Run State 永久标记 `reconciliationRequired`，Engine 直接拒绝产生新动作。

第一阶段没有提供“忽略变化继续”的命令。使用者需要恢复原仓库状态或开启新 Run，防止旧决策在新代码事实之上继续执行。

## 诊断

`doctor` 只读检查 Run、Checkpoint、Trajectory、来源清单和遥测 Cursor 的一致性。发现未完成 Journal 时只报告并提示使用 `run resume`，不会完成转换、删除损坏轨迹或猜测正确状态。

## 交付状态

每个 change 的交付状态位于 `.repoctopus/deliveries/<change-id>/`：

| 文件              | 含义                                     |
| ----------------- | ---------------------------------------- |
| `state.json`      | 当前交付快照、批准、逐动作结果和合入证据 |
| `history.jsonl`   | 追加式交付事件                           |
| `transition.json` | 尚未完成的交付状态转换 Journal           |
| `transition.lock` | 跨进程交付锁；进程退出后的陈旧锁可回收   |

旧 Delivery 状态仍可只读诊断和迁移，但新写入已经并入同一 Change Run 的 Archive phase。发布 Business MR、等待合入、核对精确 merge commit、关闭规格和创建最终 Change MR 都是持久 Work；只有最后一步 Receipt 被同一 Run 接受后才进入 `completed`。所有 MR 都由人合入，Runtime 不执行 merge。
