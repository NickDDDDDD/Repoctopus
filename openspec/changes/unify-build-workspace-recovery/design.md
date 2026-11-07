# Build 工作区恢复设计

## Context

v0.1.0 的 `mark-release-acceptance` 验收中，冷启动 `resume` 记录的差异包括两个业务仓分支、前端提交和 Workspace 规格工作树。紧接的 `next` 在同一 Run 中看到 1/2 个已完成工作包和同一 Binding、Plan，并确认当前 Work 仍有效。区别来自 `resume` 的项目快照比较仍以 Run 启动时刻为基线，而 Build 已经有更晚的执行绑定和进度记录。

Comet 0.5.1 固定源码 `35c9860b77b42bafa0c2d80d8d695889f888a924` 将已绑定分支校验与 Run checkpoint 恢复分开。Classic 的 `evaluateBranchBinding` 核对实际分支与已绑定分支，Engine 的恢复测试重新创建 Runtime 后从同一 Run 继续。Repoctopus 用已有逐仓 Binding 与进度 checkpoint 表达这两个职责。

此前 `recover-protected-branch-rebinding` 仅接受 Runtime 拒绝 Plan 后要求修正的精确分支集合，条件包含 `build.plan` 和 `awaiting-correction`。本次验收已经接受 Plan 且有完成工作包，不能进入该分支。另一个缺口是 `next` 的工作区检查依赖部分派发路径，有的路径可以直接返回 `change.work-current`。这两个位置必须消费同一次类型化恢复观察。

## Goals / Non-Goals

- 让两个公开 CLI 入口对同一持久状态和当前观察得出一致的 Build 恢复决定。
- 保持执行身份、计划与已接受结果的权威归属，隔离规格事实、执行进度和外部漂移。
- 本次覆盖 Build 恢复与既有恢复分支的回归。Archive 与 Verify 的证据一致性由后续 Change 处理。

## Decisions

1. **统一恢复判定。** Cordis 工作流服务负责加载当前 Run、观察 Git 事实和调用已有工作区绑定规则，两个入口共用判定。已接受的 Binding 决定可执行的 checkout，最近有效的 Build 工作区 checkpoint 决定已接受的进度。Project Snapshot 仍为项目发现、仓库身份和未进入有效 Build 绑定的路径提供证据。
2. **分别核对身份、进度与规格。** 逐仓核对受管路径、worktree、分支、仓库和远端身份。已接受的工作包进度以持久 checkpoint 为准。Workspace 规格和任务清单走既有规划与规格观察规则。按已有执行恢复协议处理尚未确定的 invocation，不把未确认的 HEAD 变化当成已接受结果。发现冲突时保留原执行与证据，停止派发；已有受保护分支的精确重绑定路径仍由原授权规则控制。
3. **复用状态更新和诊断。** 领域层负责从已观察事实得出判定，Runtime 通过现有受保护的 Run 更新路径记录恢复结果。冲突解除时，只依据可归属的状态与证据清理对应的恢复阻塞，保留无关冲突。Git 路径与 ancestry 探测仍由平台适配器负责。恢复测试检查现有公共诊断和 Run 事件，无需引入遥测协议。
4. **用公开 CLI 对照。** 在真实 `agent-lab` 多仓项目的独立验收 checkout 上完成两个小工作包中的首个。从新进程分别调用 `resume` 和 `next`，比较 Run、Binding、Plan、已完成工作包和下一项工作。切换一个业务仓到未授权分支，验证两入口均阻断并保留现场，切回后继续。保留自动回归及正式验收证据。

### 共用判定的调用边界

工作流服务在 Build 阶段返回可继续的 Work 或调用 Host 前运行共用观察。`resume` 在通用启动快照 reconciliation 写入全局阻塞之前调用，`next` 在返回 `change.work-current`、消费 Build candidate 或派发执行之前调用。两者都从当前配置和 Run 作用域重新观察仓库，不能仅让一个入口使用实时快照，另一个入口复用启动快照。

判定分两层。先验证仓库集合、身份、远端、路径、worktree、分支和批准的隔离方式，再核对当前工作及 checkpoint。Project Snapshot 的差异仍可诊断，但已被当前 Binding 或已接受工作区 checkpoint 解释的变化不产生未知漂移。Workspace 的已批准规格观察和任务状态仍走既有规划判定，未被接受的 Git 变化不能仅凭祖先关系或某个文件的语义相同被接纳。

| 当前事实                                                        | 共用恢复结果                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 当前绑定有效，实际提交与已接受 checkpoint 一致                  | 保留 Run、Strategy、Binding、Plan、package completions，继续原 Work                           |
| 当前 invocation 已领取或外部结果未知                            | 保留 claim、packet、invocation 和 submission，交给原执行恢复协议核对，避免重复执行            |
| 当前工作包有尚待接受的提交                                      | 交给原 Work 的 Outcome 验证及精确 write scope 校验，恢复判定不代替 acceptance 推进 checkpoint |
| 任一仓切到未授权分支、路径或 worktree 改变、远端或拓扑漂移      | 保留执行现场并阻断，返回逐仓原因，不自动建立新 Binding                                        |
| 当前 HEAD 超出已接受 checkpoint，且当前执行与已冻结证据无法解释 | 阻断并保留结果以供核对，不提升进度基线                                                        |
| 精确命中已有 protected Plan correction 授权                     | 走原有 Configure revalidation 路径，原授权集合与 checkpoint 失效规则仍适用                    |
| checkout 恢复原身份且无其他未决冲突                             | 根据当前 Run 重新判定，只解除可归属的工作区冲突并继续原工作                                   |

领域层返回事实与原因，服务层协调当前 Run 的受保护更新。恢复事件绑定 Run revision、当前 Work、Binding、checkpoint 和观察摘要，重复观察不得重复执行，旧观察不得清除新冲突。`reconciliationRequired` 的清理必须证明对应工作区原因已解除，无关冲突和未知外部结果仍由各自权威处理。已有当前格式的 Run 遇到启动快照误报时，用其持久执行证据重新判定，保留原事件。

公开 CLI 的 `nextActions` 与 continuation 必须取自实际恢复决定。原始启动快照 diff 可以作为诊断和历史事件保留，但不能再单独驱动一条与有效 Binding/checkpoint 相反的操作指令。

### 主规格冲突及授权依据

独立 Builder Check 发现，现有 `managed-work-execution` 的 `Binding-owned事实变化` 场景将分支、worktree、拓扑或路径变化统一交给 Configure，缺少授权边界。本次用户明确要求未授权分支被拦住，且已批准 Open 的保留原进度场景，因此按该授权补齐相同 Change 的 delta。完整保留 `Build Configure 产生可批准的不可变配置` requirement，在描述和相关场景中明确先判断变化是否受批准的执行意图与当前 Run 证据授权，已授权兼容变化可以走 Configure，未授权变化保留原 Binding、Plan 和工作包并阻断。这项 Spec Patch 对应本次已确认行为，未增加新的工作流目标。

### 验证策略

自动测试先复现原始顺序，Run 启动、准备分支、Configure、Plan、首包 acceptance、新进程恢复。两个入口分别使用公开 CLI，比较相同的权威执行身份与工作包数量，覆盖 `resume → next` 和 `next → resume` 的顺序及重复调用。负例覆盖未授权分支、未接受的 HEAD、仓库或远端身份变化、未知 invocation 和恢复原 checkout，检查阻断期间没有 Configure、重规划或新的执行副作用。

真实验收使用已有四个业务仓的独立实验 checkout 和一个 Workspace，安排两个小工作包。首包完成后保存可审查的 Run 和 Git 引用，再从新进程验证两个入口。未授权分支场景只在验收 checkout 切换，不改写历史 Store；切回后完成第二个工作包。正式报告记录候选 CLI 提交、每个进程的命令、Run/Binding/Plan/Work 标识、包完成状态、诊断和 Git 前后值。现有 telemetry 的 Run 与恢复事件用于交叉核对，测试正文和字段使用安全引用。

### Comet 参考

- 固定上游 `domains/comet-classic/classic-branch-binding.ts`，当前分支和持久绑定的单一判定入口。
- 固定上游 `test/domains/engine/runtime-until-blocked.test.ts`，重新创建 Runtime 后继续同一 Run，保留已有结果。
- 固定上游 `test/domains/comet-classic/classic-recovery-contract.test.ts`，从原协调 checkpoint 继续审查。
- 固定上游 `test/domains/comet-classic/classic-sdk-rebind.test.ts`，显式 rebind 保留原 Run，拒绝未知 Action 与被改写的分支投影。

## Risks / Trade-offs

- 单独忽略启动快照的 branch 差异会放宽未授权分支校验。采用逐仓当前绑定判定，保留无法解释的仓库身份变化与 checkout 漂移。
- 把新 Git HEAD 写回为恢复基线会掩盖工作包之外的改动。只有既有工作包接受路径可以确认新的执行进度。
- 并行或重复恢复可能看到过期的 Run。沿用受保护更新边界，并验证重复调用不会重放工作或创建额外的审批。

## Migration Plan

使用当前 Run、Binding 和 checkpoint 的既有数据格式，无需数据迁移。交付通过一次常规 PR，必要时可回退该修复提交。
