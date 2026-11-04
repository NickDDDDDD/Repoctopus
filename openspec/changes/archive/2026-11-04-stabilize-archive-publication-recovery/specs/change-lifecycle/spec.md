# change-lifecycle Delta

## ADDED Requirements

### Requirement: terminal Run 的 continuation 必须由当前 checkpoint 绝对决定

当权威 Change Run checkpoint 已进入 completed terminal status 时，Repoctopus MUST 投影 `done/terminal` continuation、空 current Work/attempt 和空 next actions；历史 `continuation.selected`、Trajectory 顺序、目录状态、Git/MR 状态或展示端推断 MUST NOT 把该终态覆盖为 execute、wait、ask、reconcile 或 transition-pending。该投影 MUST 为只读，并由 Runtime status、CLI、Desktop 和遥测共同消费。

#### Scenario: completed checkpoint 存在旧 null-work selection

- **WHEN** 当前 checkpoint 为 completed 且 current Work 为 null，但 Trajectory 中存在旧的 `workId=null` `continuation.selected` 等待事件
- **THEN** 所有读取面返回 `done/terminal`、null work/attempt、当前 check epoch 和空 next actions，不重放旧等待事件

#### Scenario: completed checkpoint 存在旧活动 Work selection

- **WHEN** 当前 checkpoint 为 completed，但历史记录包含同一 Run 较早 epoch 或 revision 的 execute/reconcile selection
- **THEN** Runtime 忽略历史活动 Work continuation，并且读取不触发 Host、packet、平台或文件系统 I/O

#### Scenario: 非终态重放精确 continuation

- **WHEN** 当前 Run 尚未完成，最近的 `continuation.selected` 精确匹配当前 run、checkpoint revision/epoch、Work identity 和 attempt
- **THEN** Runtime 可以重放该选择；缺少或不匹配当前身份时回退到当前 checkpoint 的纯分类，不猜测历史事件仍有效
