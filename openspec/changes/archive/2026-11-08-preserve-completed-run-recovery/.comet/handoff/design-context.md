# Comet Design Handoff

- Change: preserve-completed-run-recovery
- Phase: design
- Mode: compact
- Context hash: be99934c311dfbb308ed83f0e73d80653cfde086fbd9c436694ba5f422671917

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/preserve-completed-run-recovery/proposal.md

- Source: openspec/changes/preserve-completed-run-recovery/proposal.md
- Lines: 1-31
- SHA256: d173b22fa362b390b220302f04e4aa93c8b4e4db3fcf317657c560822b34a45e

```md
# Proposal

## Why

真实多仓验收已经完成规格关闭和全部 MR 发布，Run 返回 `completed + done/terminal`；新进程执行 `resume` 后，却把获准开发产生的分支、HEAD 变化与启动快照比较，写入全局 reconciliation 标志，使后续 `next` 返回 `reconcile/project-drift`。现有终态规则只在底层 continuation 分类中成立，尚未贯穿恢复入口和完整状态投影，需要优先补齐团队工作流的这一核心边界。

## What Changes

- 参考 Comet 已有的终态优先规则，让已完成 Change Run 的 `status`、`resume`、`next` 一致返回 `done/terminal`，不重新激活开发阶段的漂移恢复。
- 终态判断仍以可验证的持久 Run、Checkpoint 和转换 Journal 为依据；不跳过 Store 完整性检查，也不把缺失或损坏状态伪装成成功。
- 全局 reconciliation 标志和历史 continuation 不得覆盖已经接受的完成事实；不手工修改 Store、不回写启动快照、不建立第二份生命周期。
- 保留活动 Run 的多仓 Binding、最新 workspace checkpoint、精确 Evidence 失效和未授权 checkout 拦截。
- 用真实 RED/GREEN、生产 Service 和新进程多仓 CLI 验收覆盖两种恢复调用顺序，核对继续指令、原 Closure/PublicationReceipt、全部工作包、Evidence 和副作用次数。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `runtime-foundation`：明确已完成 Run 的恢复不进入活动项目 reconciliation，保留持久化完整性和中断恢复边界。
- `change-lifecycle`：补齐终态在完整状态投影、两个公开恢复入口及历史 reconciliation 标志上的优先级验收。

## Impact

- 主要涉及 WorkflowRuns Service、Runtime coordinator 的恢复和查询投影，以及对应领域、集成和 CLI 验收；不新增 CLI 参数、配置、状态 schema 或长期运行进程。
- 本次交付是终态恢复一致性的完整修复。Windows 长路径前置检查、包内 doctor 资源、桌面激活及 PR 正文传递分别留作后续问题，不混入本次实现。
- 使用 Comet 0.5.1 固定 commit `35c9860b77b42bafa0c2d80d8d695889f888a924` 的行为方案：`runtime-service.ts` 的终态停止与 command 终态限制、Classic 已归档 Change 的选择限制。已核对上游 master `a61a2e5b4766e1ad62377dec598e402560a259b6`，相关规则与固定版一致；不引入 Comet SDK 或替换 Cordis 架构。
- 上游采用以行为参考为主；沿用 MIT 来源记录，若实施涉及新增复制或实质改写，则同步更新机器可检查来源清单。测试报告和运行证据独立保存，规格与任务仍仅由 OpenSpec 管理。
```

## openspec/changes/preserve-completed-run-recovery/design.md

- Source: openspec/changes/preserve-completed-run-recovery/design.md
- Lines: 1-95
- SHA256: 97b9356875c1d6c5f4149a151e8c9315577914a1b90dc8e0205811397fcd64a3

[TRUNCATED]

```md
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

### 5. 跨入口的具体落实位置

| 边界                                             | 当前遗漏                                                       | 设计约束                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `domains/runtime/workflow-runs.ts` 的完整 status | 全局标志在纯 terminal projection 之外覆盖继续指令              | 先尊重可信 completed；保留原持久诊断，活动 Run 才由 reconciliation 标志阻断       |
| coordinator 的 `resume` / `next`                 | 通用恢复仍可能进行写前兼容处理、项目 reconciliation 或事件追加 | 已完成 Change 走现有 Store 读取/必要恢复后的终态路径，不对该 Run 增加开发恢复事件 |
| `services/workflow-runs.ts` 的 `resume` / `next` | 终态落入活动定义、Skill、workspace 和 Host checkpoint 恢复     | 在这些活动执行步骤之前使用同一终态判定；不修改各阶段自己的授权或失效分类          |
| `app/cli/main.ts` 的 resume envelope             | 根据原始 reconciliation 标志单独生成恢复指令                   | 使用权威终态和共享 next-actions 渲染，不能重新覆盖 Service 已确定的完成结果       |

终态读取核对 Run 与 Checkpoint 的身份、状态和版本来自同一可验证提交；缺少必要持久文件、损坏 JSON 或不一致且无法由原 Journal 恢复时返回诊断。不要用调用者提供的 completed 字段或只读一个原始 JSON 字段作为成功依据，也不扩展为另一套通用状态校验框架。

已有 ResumeView 若携带项目差异，保留能够证明的观察内容并明确其不要求活动 reconciliation，不伪造“当前快照与原快照相同”。历史 `state.reconciliationRequired` 可以作为原持久诊断保留；执行恢复、公开 next actions 和展示端的继续指令由 terminal authority 决定。

### 6. 验收矩阵与输入固定

| 场景                                                    | 必须同时核对的结果                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 正常 completed，多仓已提交且 source branch 不同于启动时 | 两种冷恢复顺序始终 done；不新增 reconciliation 标志，状态版本和执行计数不增加 |
```

Full source: openspec/changes/preserve-completed-run-recovery/design.md

## openspec/changes/preserve-completed-run-recovery/tasks.md

- Source: openspec/changes/preserve-completed-run-recovery/tasks.md
- Lines: 1-20
- SHA256: dd1a651ebddd1ec94dfb3bb096fc68afb3e554e96ef144ee4b91c71aebd15ee5

```md
# Tasks

## 1. 终态权威贯穿恢复入口

- [ ] 1.1 核对并记录 Comet 固定版和当前上游的终态规则，先增加完整 status 被历史 reconciliation 标志覆盖的失败回归，再修正共享投影；验收为同一 completed checkpoint 在 Runtime status、continuation 和 next actions 中一致返回完成，RED/GREEN 证据和上游来源可核对。 <!-- comet-task:b5c2b368-cbb9-4c8c-a0d7-bc9e4a94fb24 -->
- [ ] 1.2 为 Service 与通用 coordinator 的 completed 恢复增加真实失败回归并实施终态优先分派；验收为合法开发产生分支与 HEAD 变化后，`resume → next` 和 `next → resume` 不新增 reconciliation、活动观察、Host 派发、Work 或阶段转换，并保留所有完成身份和执行计数。 <!-- comet-task:a0c16dfa-ff64-4525-957a-ce30ed37979d -->
- [ ] 1.3 补齐完整性和活动恢复负向回归；验收为缺失/损坏的 Store 或 Checkpoint 明确失败、未结 Journal 仍按原机制恢复，且活动 Run 的未授权 checkout、未知外部结果和原 Build/Evidence 恢复测试保持 fail closed 或既有合法 continuation。 <!-- comet-task:02df3761-54be-436d-8039-74ba735841cc -->
- [ ] 1.4 更新恢复使用说明与采用来源说明，解释完成 Run、历史诊断和独立后续一致性审查的边界；验收为文档与当前公开命令、两份 delta spec 一致，不出现新增状态 schema、影子规划文件或宿主项目路径。 <!-- comet-task:4e285ec2-43ac-4141-9f17-638e331b3219 -->

## 2. 多仓冷恢复验收与完整验证

- [ ] 2.1 在生产 CLI 验收中加入真实多仓 Git 和 completed 发布事实的两个新进程恢复顺序；验收为每一步同时核对 status、continuation、execution、next actions、Closure、PublicationReceipt、Bundle、Package Completion、check epoch 及副作用次数，且重新引入原通用 reconciliation 路径会使回归失败。 <!-- comet-task:febd29aa-0a2a-42ec-8811-02bed759014b -->
- [ ] 2.2 用本 change 构建的独立安装包复验小型真实多仓任务，从正式接入、审批、实施和 Evidence 到 Close、发布及终态冷恢复；验收为整个过程仅使用公开 CLI，分支与提交及时 push、远端 MR 唯一且 head/base/OID 正确，旧失败 Store 和报告保持原哈希，新报告明确区分本次结果与历史证据。 <!-- comet-task:9fdc85bf-d195-4f80-b38e-716ddde41be0 -->
- [ ] 2.3 完成与本次改动匹配的 Runtime、生命周期、活动 Build/Evidence 恢复、CLI 和完整性回归，以及类型、格式、构建/生成物、架构/来源和严格规格检查；验收为实际命令及退出码被正式验证证据记录，未执行、失败或未知项不计为通过。 <!-- comet-task:6917c193-28ac-4b98-a9b0-2710ce46e4c9 -->
- [ ] 2.4 对最终差异完成独立审查并形成正式验证报告，逐条映射本 change 验收要求、上游采用规则和真实失败/修复结果；验收为无未解决的重要缺陷，报告同时列明终态新进程结果、保留的历史诊断与未纳入范围的问题。 <!-- comet-task:8221a7e6-a84b-48c0-894f-093c56a3371d -->

## Workflow follow-up

- 由 Comet Classic 在正式 Verify 通过后按用户授权归档，并完成所选 commit、push 和 PR 交付。
- 合入后核对产品基线与实验 MR 的实际状态；已完成 Run 的后续交付影响继续由独立一致性审查处理。
```

## openspec/changes/preserve-completed-run-recovery/.openspec.yaml

- Source: openspec/changes/preserve-completed-run-recovery/.openspec.yaml
- Lines: 1-2
- SHA256: 5fd2cc7d290b25cf909218418df74e542dd2eb03ebf67a63a38a9bee04d94037

```md
schema: spec-driven
created: 2026-11-08
```

## openspec/changes/preserve-completed-run-recovery/specs/change-lifecycle/spec.md

- Source: openspec/changes/preserve-completed-run-recovery/specs/change-lifecycle/spec.md
- Lines: 1-37
- SHA256: 80de47de1650c19de31f20d9001b8d52e5b3e9a805685ed871e423e5299b2499

```md
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
```

## openspec/changes/preserve-completed-run-recovery/specs/runtime-foundation/spec.md

- Source: openspec/changes/preserve-completed-run-recovery/specs/runtime-foundation/spec.md
- Lines: 1-52
- SHA256: ba8b232001126a85753ed3cbf7c9e211a5eb9a27efdad171d36ca4437343b512

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: Checkpoint 支持中断后幂等恢复

Runtime MUST 使用转换 Journal 和原子替换协调 Trajectory、Run State 与 Checkpoint，并在进程于任一写入边界中断后恢复为同一最终状态或明确的人工修复状态。非终态恢复时重新探测的 Project snapshot MUST 区分内容变化与 repository identity/ownership/topology 变化：内容变化必须报告并交给依赖该内容的 phase authority 精确重验，只有身份级变化才能设置全局 `reconciliationRequired`。已完成 Run MUST 优先保持持久终态，不因当前项目与启动快照的差异重新激活开发阶段 reconciliation；Store 完整性检查与中断事务恢复仍然生效。

#### Scenario: 状态写入中途进程退出

- **WHEN** 进程在 Trajectory、Run State 或 Checkpoint 的任一写入边界退出
- **THEN** 下一次 `run resume` 根据 Journal 完成或回滚同一转换，不重复产生业务结果

#### Scenario: 外部仓库事实已经变化

- **WHEN** 非终态恢复时仓库 HEAD、分支、路径或工作树摘要与适用 Checkpoint 不同
- **THEN** Runtime 报告逐仓差异与 `content|identity` 分类，只使依赖已变化内容的决定或 Evidence 精确失效；仅 identity 级差异设置全局 reconciliation

#### Scenario: 当前 Work 产生正常内容提交

- **WHEN** 已授权 Work 写入并提交规格或实现，使 repository HEAD/worktree 相对 Run 启动快照变化，但 repository identity、remote、branch、path 与 topology 保持一致
- **THEN** `run resume` 返回 `content` drift observation 且不设置全局 reconciliation，保留原持久 continuation，由当前 planning、binding、Evidence 或 closure authority 重新验证依赖

#### Scenario: 内容由外部参与者改变

- **WHEN** 同事或 CI 在相同 repository identity、remote、branch 与 topology 上产生新的 HEAD/worktree 内容
- **THEN** Runtime 同样分类为 `content`，不得用作者或进程身份猜测所有权；受影响 phase authority 必须在接受后继状态前检测摘要变化并精确失效相关决定或 Evidence

#### Scenario: 仓库身份事实已经变化

- **WHEN** 非终态恢复时 repository add/remove、project/root identity、remote identity、branch、path、ownership 或 topology 与适用 Checkpoint 不同，或差异无法安全分类
- **THEN** Runtime 返回 `identity` reconciliation、设置全局 `reconciliationRequired` 并阻止后继 Action，直到显式恢复原绑定或开始合法的新 Run

#### Scenario: content drift 与 Open reobserve 同时存在

- **WHEN** Open Work 已持久化 `validated + reobserve`，且其规格提交使 HEAD 相对启动快照变化
- **THEN** `run resume` 保留 `reobserve` 为合法下一步；后续 `run next` 重试 Open planning gate，不要求重放 Host、恢复旧 HEAD 或创建新 Run

#### Scenario: 已完成多仓 Run 在新进程恢复

- **WHEN** 已接受 PublicationReceipt 的 Run 为 completed，当前仓库包含本次获准开发产生的 branch、HEAD 变化，新进程以任意顺序调用 `run resume` 和 `run next`
- **THEN** 两个入口保持 `done/terminal`，不因与启动快照不同新增 reconciliation、Work 或阶段转换，并保留原 Closure、PublicationReceipt、Evidence、Package Completion 和检查执行次数

#### Scenario: 完成之后出现新的外部仓库变化

- **WHEN** Run 已 completed，随后仓库 checkout 或远端 MR 发生变化，再次请求该 Run 的恢复
- **THEN** 原 Run 仍为 completed 且 continuation 为 `done/terminal`；后续交付影响由独立一致性审查处理，不重新激活原开发生命周期，也不以该终态授权任何新的外部动作

#### Scenario: 持久化终态无法验证

- **WHEN** 恢复时 Store、Checkpoint 或转换 Journal 缺失、损坏或无法恢复为可验证的 completed 事实
- **THEN** Runtime 返回明确错误或恢复诊断并保留现场，不根据目录、MR 或调用者声明推断成功，不用终态优先规则绕过完整性检查
```
