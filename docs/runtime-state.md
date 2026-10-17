# 状态、轨迹与恢复

每个 Run 都保存在 `.repoctopus/runs/<run-id>/`：

| 文件                    | 含义                                   |
| ----------------------- | -------------------------------------- |
| `workflow.json`         | 启动时冻结的 Workflow Package 与摘要   |
| `project-snapshot.json` | 启动时冻结的多仓事实                   |
| `run.json`              | 当前 Run State                         |
| `trajectory.jsonl`      | 按顺序追加的领域事件                   |
| `checkpoint.json`       | 当前状态版本、轨迹偏移和关键摘要       |
| `transition.json`       | 尚未完成转换的 Journal；正常完成后删除 |
| `transition.lock`       | 跨进程转换锁；正常完成后删除           |
| `telemetry-cursor.json` | 已成功发送的最后一个轨迹序号           |

## 转换协议

1. 原子取得 `transition.lock`；仍存活的持有者使竞争写入等待，进程已经退出的陈旧锁可以回收。
2. 校验事件属于当前 Run、事件版本等于新状态版本，并对比当前 `stateVersion`。
3. 原子写入 `transition.json` 并刷盘。
4. 写入完整且以换行结束的 `trajectory.jsonl`。
5. 原子写入 `run.json`。
6. 原子写入 `checkpoint.json`。
7. 删除 Journal 并释放转换锁。

重启后只要 Journal 存在，Runtime 会检查已经完成的步骤并继续执行缺失步骤。相同事件不会重复追加。轨迹缺少最终换行、包含无效 JSON、序号断裂或重复事件 ID 时，Runtime 返回损坏诊断，不会静默截断证据。

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

交付状态依次经过 `development`、`awaiting_approval`、`approved`、`publishing` 和 `in_review`。动作失败进入 `partially_published`，恢复后从第一个未完成动作继续。任何批准事实漂移进入 `verification_required`；远端出现无法安全解释的变化进入 `repair_required`。所有 MR 都由人合入，Runtime 观察到全部合入证据后才进入 `merged`。
