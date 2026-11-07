## MODIFIED Requirements

### Requirement: 恢复时刷新外部仓库事实

`run resume` MUST 重新探测与 Run 关联的仓库，并把当前事实与适用于当前阶段的持久化 checkpoint 比较。在已经接受 Build 执行绑定的恢复路径，`run resume` 与 `run next` MUST 使用同一工作区恢复判定，核对获准的执行身份和最新已接受的工作区进度。外部变化不得被旧缓存覆盖。

#### Scenario: 仓库在会话中断期间产生新提交

- **WHEN** 当前 HEAD 与适用 checkpoint 不同
- **THEN** Runtime 报告仓库和差异类型，并重新解析所有依赖旧 HEAD 的下一动作

#### Scenario: 从已接受的多仓 Build 进度继续

- **WHEN** Run 启动后准备了获准的源分支，Build 已接受执行绑定和 Plan，第一个工作包已完成并记录 Git checkpoint，随后从新进程调用恢复入口
- **THEN** 两个入口均保留同一 Run、Binding、Plan 和已完成工作包，识别同一个下一项待执行工作，且不会因已经接受的变化误报项目漂移

#### Scenario: 一处未授权的 checkout 变化阻断恢复

- **WHEN** Build 已有工作区 checkpoint，但其中一个业务仓切到未授权分支或 checkout 身份无法验证
- **THEN** 两个入口均保留原 Binding、Plan、工作包和证据，报告冲突并阻止继续执行，不能把未知分支接受为新基线

#### Scenario: 恢复原 checkout 后继续未完成工作

- **WHEN** 发生 checkout 冲突的仓已恢复到原绑定身份，当前仓库事实可由权威记录解释且没有其他未解决冲突
- **THEN** 两个入口均允许继续同一 Run 中的下一项待执行工作，并且不重放已完成工作包
