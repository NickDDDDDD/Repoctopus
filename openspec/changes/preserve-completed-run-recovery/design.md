# Design

## Context

问题和范围见 proposal.md。现有 `change-lifecycle` 已要求 terminal continuation 绝对来自当前 checkpoint；纯分类和历史 continuation 重放已有覆盖，但外层 Service 恢复和 coordinator 完整状态投影没有遵循同一优先级。

实际调用链为：completed 跳过只处理 running 的 Evidence workspace recovery，落入通用 `resume`；通用恢复对比启动 Project snapshot 与当前仓库，记录全局 reconciliation；完整 status 又在 terminal projection 之外优先采用该标志。此次不是 Evidence 内容身份再次失效，也不是已完成工作包被重放。

本 change 用外部 Comet Classic full workflow 控制开发，使用从 main 创建的独立 worktree；产品仍采用 Cordis composition、Service、RunStore 和 Specification Provider 的原有架构。

## Goals / Non-Goals

**Goals:**

- 将现有 completed 终态规则落实到恢复入口、coordinator 和完整状态投影。
- 正常终态恢复不重新激活项目漂移检查；保留同一终态的持久完成身份、执行计数与诊断可追溯性。
- 活动 Run 的授权、能力、规划、Evidence 和未知外部结果恢复不受削弱。
- 以真实失败、Service 集成和多仓新进程 CLI 验收证明修复，而不只测试底层纯函数。

**Non-Goals:**

- 不新增终态、生命周期、schema、CLI 参数、后台进程或迁移协议，不把 Comet 的所有 failed/cancelled 处理方式照搬到本次 completed 修复。
- 不重写旧 Run 的启动快照、历史 reconciliation 标志、原 Closure 或 PublicationReceipt；不手改实验 Store。
- 不修改 Windows 长路径、桌面、打包或 PR 正文能力，不合并本次验收的实验 MR。

## Decisions

### 1. 采用上游的终态优先顺序

固定参考 Comet 0.5.1 `35c9860b77b42bafa0c2d80d8d695889f888a924`：

- `domains/engine/runtime-service.ts`：`runUntilBlocked` 在调度、领取和执行前检查 completed；普通 command 对 completed 的处理另有显式授权边界。
- `domains/comet-classic/classic-current-change.ts`：先拒绝重新选择已归档/完成 Change，再检查活动分支绑定。
- `domains/engine/runtime-service.ts` 的确定性提交：没有状态变化时返回原结果。

已同步观察上游 master `a61a2e5b4766e1ad62377dec598e402560a259b6`，上述两个源文件与固定版无差异。只采用行为规则；不引入上游 SDK、状态文件或固定实现依赖。

### 2. 终态查询以完整持久事实为入口

先由现有 RunStore 读取和必要的 Journal 恢复获得可信 Run/Checkpoint。对已验证的 completed Change，恢复入口直接使用共享终态分类与完整查询投影，不进入 Build/Evidence 观察、通用项目 reconciliation 或 Host redelivery。普通状态查询继续只读；有未结转换时仅允许现有 Store 恢复机制完成原事务。

Engine/domain 只根据传入事实分类；Cordis Service 协调读取和入口分派；RunStore 保有完整性、锁和中断提交职责；CLI 传递和渲染相同 Service 结果，不再写入口特有的终态规则。沿用既有公共 API，避免只在 CLI 或单个 `resume` 分支加绕过。

备选方案包括更新启动快照、为终态创建额外 recovery Work、仅放宽 branch drift 或只修展示字段。它们分别会改变原身份、制造无意义执行、漏掉其他漂移或保留错误状态写入，因此不采用。

### 3. 历史标志保留但不能支配终态

`status` 的 terminal continuation 优先于历史全局 reconciliation 和旧 continuation selection。已有受影响 Run 可以保留原持久诊断，查询不得伪造 Store 数据或新建完成记录；活动恢复指令、next actions 和面向执行者的 recovery 以可信 completed 为准。正常 completed Run 不能在后续 `resume` 中新增全局 reconciliation。

终态只说明该 Run 已完成，不授予新动作，也不承诺远端 MR 永远不变。后续影响审查继续使用既有独立 reconciliation 用例，不把已完成 Run 重开。Store 缺失、损坏、无法恢复或权威资料冲突仍然停止并保留诊断。

### 4. 把回归测试提升到实际入口

- RED：先复现完整 status 被全局标志覆盖、正常 completed 经恢复产生 reconciliation 的现象，再实施并记录 GREEN。
- Domain/Runtime：原 checkpoint 绝对优先，旧标志不能覆盖；Store 完整性失败不能被 terminal shortcut 隐藏。
- Service：从真实完成事实调用 `next`、`resume`，核对不会执行活动 workspace/planning/Evidence/Host 逻辑，并覆盖两种顺序。
- CLI：真实多仓 Git checkout、合法 source branch 与后续提交、正式工作包、Evidence、Close 和 PublicationReceipt。每条恢复命令使用新进程，逐项核对 `status`、`continuation`、`execution`、next actions 和全部完成身份。
- 副作用：比较 Work/Host/Skill、检查命令、Close 和发布操作的事件/计数，不能只断言最终 status；远端测试动作限定于独立实验基线。
- 负向：活动 Run 的未授权 checkout、未知外部执行及 Store 损坏仍 fail closed。旧真实失败现场仅通过公共查询复核，保持原始证据不变。

轨迹和现有 OpenTelemetry 对应事件作为验收佐证：完成后恢复不得再产生新的活动 Work、Skill 执行或阶段返工。此次不新增遥测字段或一套计数权威。

## Risks / Trade-offs

- [入口提前返回掩盖损坏] → 终态分派建立在现有持久状态读取/恢复与完整性检查之后；增加损坏和未结 Journal 的负向覆盖。
- [只修 continuation，其他字段仍要求执行] → 同时核对完整 Service、CLI、execution 与 next actions，不只测试纯投影。
- [旧错误标志被清除导致审计丢失] → 保留原事实，不手改 Store；只纠正它对终态执行指令的影响。
- [影响活动多仓恢复] → 仅对可信 completed 分派，重复运行既有活动恢复和授权拦截回归。
- [测试重复过去的盲点] → 保留两种冷恢复顺序与事件/调用次数断言，并使用真实多仓场景复验。
- [自举再次卡住开发] → 开发由外部 Comet Classic 控制；被修复的产品 Runtime 只用于实验验收。
