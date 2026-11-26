## MODIFIED Requirements

### Requirement: Build Check 必须验证最终 workspace checkpoint

Repoctopus MUST 将 Build Check 绑定到已接受的 Package Completion 和最终 BuildWorkspaceCheckpoint，并核对当前 checkout 身份、Build Check 的有效输入及交付内容。可以证明无关的快进 SHALL NOT 单独使 Check 失效。影响 Check 或受管实现的变化 MUST 走 Runtime 派发的复核路径，且 SHALL NOT 直接放行 Verify 或纳入交付。

#### Scenario: Check 期间出现可证明无关的快进

- **WHEN** 某个登记仓库在 Check 期间前进，且仓库身份、Check 的有效输入与获准交付的内容均保持一致
- **THEN** Runtime 可接受符合原 checkpoint 与检查契约的 Check Outcome

#### Scenario: Check 观察到额外 commit

- **WHEN** 任一登记仓库的变化影响 Check 输入、已通过的包或获准交付范围
- **THEN** Runtime MUST 拒绝由旧输入产生的 Check 结果，按实际影响派发复核，并保持无关包的完成事实

## ADDED Requirements

### Requirement: 多仓 Build 漂移仅失效受影响的有效进度

Repoctopus MUST 让 `run resume`、`run next`、Execute Outcome 和 Build Check 共用同一工作区漂移判定。Runtime MUST 基于受管输入和依赖关系选择恢复动作，并以当前绑定、checkpoint 和状态版本保护转换。影响范围未知、checkout 身份不符或执行副作用未结算时 MUST 阻断自动采纳或重放，并保留最后安全进度。

#### Scenario: 冷恢复保留无关完成事实

- **WHEN** 一个包已完成，下次进程启动时出现已证实的无关快进
- **THEN** 两个继续入口 MUST 保留同一 Run、Plan、审批和有效 Completion，并继续派发当前应执行的 Work

#### Scenario: 只需复核部分包或证据

- **WHEN** 受管输入变化且 Runtime 能确定受影响的包或证据
- **THEN** Runtime MUST 只失效受影响的事实及依赖它们的结果
- **AND** 只有实际规划输入发生变化才可依既有契约重进 Plan 或 Design

#### Scenario: 恢复时遇到身份变化或未结算执行

- **WHEN** checkout 切换到未授权分支、历史被改写、观察无法建立，或受影响 Work 仍有未结算副作用
- **THEN** Runtime MUST 保留已接受的进度和执行记录，返回可归因的阻塞，并 SHALL NOT 自动重试可能已发生的副作用

#### Scenario: 恢复时出现并发变化

- **WHEN** 状态版本、绑定或需验证的 Git 观察在恢复提交前发生变化
- **THEN** Runtime MUST 拒绝陈旧的恢复判定并重新观察，且 SHALL NOT 留下部分更新的 checkpoint、任务完成或 Work
