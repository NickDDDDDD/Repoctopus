# Spec Delta

## MODIFIED Requirements

### Requirement: terminal Run 的 continuation 必须由当前 checkpoint 绝对决定

当权威 Change Run checkpoint 已进入 completed terminal status 时，Repoctopus MUST 在完整状态查询、`run resume` 与 `run next` 中一致投影 `done/terminal` continuation、空 current Work/attempt 和空 next actions；历史 `continuation.selected`、全局 reconciliation 标志、Trajectory 顺序、目录状态、Git/MR 状态或展示端推断 MUST NOT 把该终态覆盖为 execute、wait、ask、reconcile 或 transition-pending。该投影 MUST 为只读，并由 Runtime status、CLI、Desktop 和遥测共同消费；恢复 MUST 保留既有完成事实，不重新执行已完成工作或外部副作用。

#### Scenario: completed checkpoint 存在旧 null-work selection

- **WHEN** 当前 checkpoint 为 completed 且 current Work 为 null，但 Trajectory 中存在旧的 `workId=null` `continuation.selected` 等待事件
- **THEN** 所有读取面返回 `done/terminal`、null work/attempt、当前 check epoch 和空 next actions，不重放旧等待事件

#### Scenario: completed checkpoint 存在旧活动 Work selection

- **WHEN** 当前 checkpoint 为 completed，但历史记录包含同一 Run 较早 epoch 或 revision 的 execute/reconcile selection
- **THEN** Runtime 忽略历史活动 Work continuation；除读取和验证必要持久事实外，不为确定后继而触发 Host、packet、平台或活动项目文件观察

#### Scenario: 非终态重放精确 continuation

- **WHEN** 当前 Run 尚未完成，最近的 `continuation.selected` 精确匹配当前 run、checkpoint revision/epoch、Work identity 和 attempt
- **THEN** Runtime 可以重放该选择；缺少或不匹配当前身份时回退到当前 checkpoint 的纯分类，不猜测历史事件仍有效

#### Scenario: 完成事实与历史 reconciliation 标志同时存在

- **WHEN** 已验证的 completed checkpoint 与同一 Run 中已有的全局 reconciliation 标志同时存在
- **THEN** 完整状态、继续指令和 next actions 仍显示 `done/terminal` 与无待执行工作；原诊断事实可以保留，但不能成为活动恢复要求，读取也不得篡改 Store 来清除历史标志或重新写入完成事实

#### Scenario: 两种新进程恢复顺序保持终态

- **WHEN** 实际完成规格关闭和全部发布后，分别从新进程执行 `resume → next` 与 `next → resume`
- **THEN** 每一步的权威 status、公共 continuation、execution recovery 和 next actions 一致表示完成；Closure、PublicationReceipt、已接受 Bundle、工作包完成身份、check epoch 和 Work/Host/Skill/验证/发布执行次数保持不变

#### Scenario: 活动 Run 的未授权 checkout 仍被拦截

- **WHEN** Run 尚未完成，某个已绑定业务仓的 branch、path、remote 或 ownership 发生未授权变化
- **THEN** `resume` 与 `next` 继续按当前活动阶段的恢复规则阻断执行并保留最后有效 checkpoint，不把终态优先规则应用于活动 Run
