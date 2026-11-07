# Comet Design Handoff

- Change: unify-build-workspace-recovery
- Phase: design
- Mode: compact
- Context hash: 57eda9e25ec5c9fdf8c9536e9bf15eec84103d8d1afc7f3202fd968223a6384d

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/unify-build-workspace-recovery/proposal.md

- Source: openspec/changes/unify-build-workspace-recovery/proposal.md
- Lines: 1-26
- SHA256: f04651a4f0372c41e8c5f49dd2418ce254f03d49b1de0275e52e13d38338aa2f

```md
# 统一 Build 工作区恢复判定

## Why

Repoctopus v0.1.0 的真实多仓验收在首个 Build 工作包完成后重启进程，`run resume` 将已接受的分支和提交变化误判为 `runtime.project-changed`，并留下需要协调的状态。同一 Run 的 `run next` 保留 Binding、Plan 和已完成工作包，继续派发第二个工作包，两个入口对同一执行现场给出了不同结论。

## What Changes

- 让 `run resume` 与 `run next` 使用相同的 Build 工作区恢复判定，依据当前获准的执行绑定和持久化检查点识别可继续的 Run。
- 保留已接受的 Binding、Plan、工作包、证据和下一项工作。逐仓校验实际 checkout，阻断未授权的分支切换和无法用现有权威记录解释的仓库漂移。
- 用公开 CLI 在真实多仓实验项目复验。两个入口分别在新进程中恢复同一 Run，保留第一个工作包并识别第二个工作包；将一个业务仓切到未授权分支后，两者都阻断执行，切回后仍可从原进度恢复。
- Archive 与 Verify 的证据一致性问题交给后续独立 Change，在本 Change 验证合入后处理。

## Capabilities

### New Capabilities

### Modified Capabilities

- `multi-repository-probe`：约束 Build 恢复时仓库事实的判定基线，以及两个公开入口对执行进度与漂移的一致解释。
- `managed-work-execution`：明确已授权兼容重绑定与未授权 checkout 漂移的边界，使 Configure revalidation 与恢复阻断遵循同一授权规则。

## Impact

- 涉及 Runtime 的公开恢复入口、Build 工作区绑定和进度校验，以及 CLI 多仓回归验收。
- 参考固定上游 Comet 0.5.1 的 Classic 分支绑定与 Engine checkpoint 恢复设计和测试。采用行为与测试方法，无第三方源码引入或许可证变更。

```

## openspec/changes/unify-build-workspace-recovery/design.md

- Source: openspec/changes/unify-build-workspace-recovery/design.md
- Lines: 1-69
- SHA256: 01d90b8b7d2e9482eb495875971a761bbd3a75ec84dccfc1a362f740b8e99fe5

```md
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

```

## openspec/changes/unify-build-workspace-recovery/tasks.md

- Source: openspec/changes/unify-build-workspace-recovery/tasks.md
- Lines: 1-17
- SHA256: 1595d47ae4dcee15bc876cf33f45ae1feb433cc5047f37b308bdf629cdec4a65

```md
# Tasks

## 1. 复现与回归测试

- [ ] 1.1 用公开 CLI 建立两仓、两工作包的回归场景。先启动 Run，再准备获准的源分支并完成首包，观察基线版 `run resume` 和 `run next` 给出不同恢复判定。 <!-- comet-task:6127efa1-c744-493c-b5d3-af228e61ed50 -->
- [ ] 1.2 补充未授权分支、切回原分支、未接受的 HEAD 变化和重复恢复用例，核对原 Work、Binding、Plan 和工作包证据。 <!-- comet-task:22a2b9d4-45eb-48e8-9a34-ef81e1137a63 -->

## 2. 统一判定

- [ ] 2.1 让两个 CLI 入口共用对最新有效 Binding、Build 工作区 checkpoint 和当前 Git 观察的判定。验证合法变化保留 Run、工作包进度和下一项工作。 <!-- comet-task:b3b7225f-5aad-4f22-b32e-697300bbd5ba -->
- [ ] 2.2 按既有恢复协议处理真实漂移和未确定的外部结果。验证无法解释的 checkout 变化阻断执行，且获准的受保护分支重绑定仍按原规则运行。 <!-- comet-task:cf620592-c727-4f43-b1be-92310c94c941 -->

## 3. 真实多仓验收

- [ ] 3.1 用候选 CLI 在独立 `agent-lab` 验收 checkout 创建新 Run。完成第一个工作包后，在不同新进程中执行两个恢复入口，核对同一 Run、Binding、Plan、1/2 个已完成工作包与同一下一项工作。 <!-- comet-task:fb73ee9b-c100-4202-bf9b-ee78b64602ed -->
- [ ] 3.2 将一个业务仓切到未授权分支，记录两个入口都阻断执行且保留现场。恢复原分支后继续第二个工作包，确认第一个工作包未重放。 <!-- comet-task:e762f35d-ed60-4ad0-b9a8-ae45973a8649 -->
- [ ] 3.3 执行仓库验证命令，提交 CLI 结果与正式验证证据，供本 Change 归档和合入检查。 <!-- comet-task:e3c8cecb-99ae-4352-951a-d928597f63b0 -->

```

## openspec/changes/unify-build-workspace-recovery/.openspec.yaml

- Source: openspec/changes/unify-build-workspace-recovery/.openspec.yaml
- Lines: 1-2
- SHA256: cb72bd9217510d5461ddb5384ca197195a83da2d8dfbd237178f7ed662291c68

```md
schema: spec-driven
created: 2026-11-07

```

## openspec/changes/unify-build-workspace-recovery/specs/managed-work-execution/spec.md

- Source: openspec/changes/unify-build-workspace-recovery/specs/managed-work-execution/spec.md
- Lines: 1-45
- SHA256: 581bd09f0f19e71838390e064b6ecb4f38b041eaa9cb3c8754ee8fdf89bf30ce

```md
## MODIFIED Requirements

### Requirement: Build Configure 产生可批准的不可变配置

Runtime MUST 从已通过 Design Human Decision 的版本化 `BuildStrategy` 读取 execution/TDD/review/isolation intent，并根据当前 Run、仓库拓扑、隔离事实与协调 Host identity 解析独立 `ExecutionBinding`。Binding MUST 固定 repository、branch、初始 head、worktree ownership、可移植 semantic digest 和只在本地保存的 path/local overlay，但 MUST NOT 把任一 Work invocation 的 capability list或 digest作为跨 Work 语义身份。Configure Host MUST 在 claim 前满足当前 `build.configure` Work 的 capabilities；未来 Plan、Execute和Check MUST 分别按自己的 Work capabilities执行claim preflight。已接受 Binding 的事实发生变化时，Runtime MUST 先按批准的执行意图与当前 Run 证据核对授权；只有已授权兼容变化才可进入 Configure revalidation，未授权 checkout 漂移 MUST 保留原执行进度并阻断。

#### Scenario: Configure 只验证当前 Work 和 Workspace Binding

- **WHEN** Host满足 `build.configure` 的读取、Strategy协调和Workspace观察能力，但没有为当前claim声明未来Execute所需的写入能力
- **THEN** Runtime可以验证并接受ExecutionBinding；该接受不授予未来Work权限，也不保证下一Work已有兼容Host

#### Scenario: 多仓任务选择 subagent 模式

- **WHEN** 任务可按仓库和依赖边界形成Work Package，用户在Design approval中接受subagent Strategy，Configure Host满足当前协调Work的能力
- **THEN** Runtime固定该Strategy并把模式绑定全部Build Action；Configure只验证当前Work和实际ExecutionBinding，不授予后继Work能力

#### Scenario: Host 不支持批准配置

- **WHEN** 当前Host不满足当前Build Work的capability contract
- **THEN** Runtime在持久化claim和副作用前等待兼容Host，不静默降级Strategy；只有请求改变策略语义时才需要新Human Decision

#### Scenario: 多仓 isolation binding 通过验证

- **WHEN** Runner为批准的current、branch或worktree intent提供受影响仓库的本地checkout facts
- **THEN** Runtime以稳定repository identity、branch、初始head、worktree identity和Workspace ownership验证Binding；绝对路径只保存在本地Run overlay

#### Scenario: 绑定变化但策略未变

- **WHEN** 批准的执行意图与当前 Run 证据能证明，同isolation intent下coordinator Host、checkout、初始HEAD或本机路径发生已授权的兼容变化
- **THEN** Runtime生成新Binding identity、使依赖旧Binding-owned输入的Plan/Evidence失效并自动重验，不创建Build Strategy approval

#### Scenario: 下一 Work 暂时没有兼容 Host

- **WHEN** ExecutionBinding有效且Runtime已派发`build.execute`，但当前Host声明的能力不覆盖该Work requirements
- **THEN** Runtime在持久化claim和invocation前返回结构化capability blocked continuation，保留当前Work和Binding，不返回Configure、不降级Strategy

#### Scenario: Binding-owned事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay发生变化，且批准的执行意图与当前 Run 证据证明变化属于已授权兼容重绑定
- **THEN** Runtime按现有精确失效规则派发Build Configure revalidation；当前Work capability声明不同本身不得触发该路径

#### Scenario: 未授权 checkout 漂移不得触发重新绑定

- **WHEN** 实际分支、路径、worktree、远端或仓库集合偏离已接受 Binding 的执行边界，且当前 Run 没有可核对的授权证据
- **THEN** `run resume` 与 `run next` 均保留原 Binding、Plan、已完成工作包和当前执行记录并阻断继续执行，不以 Configure 自动接受当前 checkout

```

## openspec/changes/unify-build-workspace-recovery/specs/multi-repository-probe/spec.md

- Source: openspec/changes/unify-build-workspace-recovery/specs/multi-repository-probe/spec.md
- Lines: 1-25
- SHA256: 5ddf9505b219ad17f199d92b2c56711cd38a8c30f581fdf082f98d62d62bc750

```md
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

```
