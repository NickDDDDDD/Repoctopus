# Build 工作区恢复设计

## Context

v0.1.0 的 `mark-release-acceptance` 验收中，冷启动 `resume` 记录的差异包括两个业务仓分支、前端提交和 Workspace 规格工作树。紧接的 `next` 在同一 Run 中看到 1/2 个已完成工作包和同一 Binding、Plan，并确认当前 Work 仍有效。区别来自 `resume` 的项目快照比较仍以 Run 启动时刻为基线，而 Build 已经有更晚的执行绑定和进度记录。

Comet 0.5.1 固定源码 `35c9860b77b42bafa0c2d80d8d695889f888a924` 将已绑定分支校验与 Run checkpoint 恢复分开。Classic 的 `evaluateBranchBinding` 核对实际分支与已绑定分支，Engine 的恢复测试重新创建 Runtime 后从同一 Run 继续。Repoctopus 用已有逐仓 Binding 与进度 checkpoint 表达这两个职责。

## Goals / Non-Goals

- 让两个公开 CLI 入口对同一持久状态和当前观察得出一致的 Build 恢复决定。
- 保持执行身份、计划与已接受结果的权威归属，隔离规格事实、执行进度和外部漂移。
- 本次覆盖 Build 恢复与既有恢复分支的回归。Archive 与 Verify 的证据一致性由后续 Change 处理。

## Decisions

1. **统一恢复判定。** Cordis 工作流服务负责加载当前 Run、观察 Git 事实和调用已有工作区绑定规则，两个入口共用判定。已接受的 Binding 决定可执行的 checkout，最近有效的 Build 工作区 checkpoint 决定已接受的进度。Project Snapshot 仍为项目发现、仓库身份和未进入有效 Build 绑定的路径提供证据。
2. **分别核对身份、进度与规格。** 逐仓核对受管路径、worktree、分支、仓库和远端身份。已接受的工作包进度以持久 checkpoint 为准。Workspace 规格和任务清单走既有规划与规格观察规则。按已有执行恢复协议处理尚未确定的 invocation，不把未确认的 HEAD 变化当成已接受结果。发现冲突时保留原执行与证据，停止派发；已有受保护分支的精确重绑定路径仍由原授权规则控制。
3. **复用状态更新和诊断。** 领域层负责从已观察事实得出判定，Runtime 通过现有受保护的 Run 更新路径记录恢复结果。冲突解除时，只依据可归属的状态与证据清理对应的恢复阻塞，保留无关冲突。Git 路径与 ancestry 探测仍由平台适配器负责。恢复测试检查现有公共诊断和 Run 事件，无需引入遥测协议。
4. **用公开 CLI 对照。** 在真实 `agent-lab` 多仓项目的独立验收 checkout 上完成两个小工作包中的首个。从新进程分别调用 `resume` 和 `next`，比较 Run、Binding、Plan、已完成工作包和下一项工作。切换一个业务仓到未授权分支，验证两入口均阻断并保留现场，切回后继续。保留自动回归及正式验收证据。

## Risks / Trade-offs

- 单独忽略启动快照的 branch 差异会放宽未授权分支校验。采用逐仓当前绑定判定，保留无法解释的仓库身份变化与 checkout 漂移。
- 把新 Git HEAD 写回为恢复基线会掩盖工作包之外的改动。只有既有工作包接受路径可以确认新的执行进度。
- 并行或重复恢复可能看到过期的 Run。沿用受保护更新边界，并验证重复调用不会重放工作或创建额外的审批。

## Migration Plan

使用当前 Run、Binding 和 checkpoint 的既有数据格式，无需数据迁移。交付通过一次常规 PR，必要时可回退该修复提交。
