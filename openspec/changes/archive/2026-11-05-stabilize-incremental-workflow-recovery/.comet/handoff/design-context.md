# Comet Design Handoff

- Change: stabilize-incremental-workflow-recovery
- Phase: design
- Mode: compact
- Context hash: a0e0a5f467e4ee2665da76b029f20bb538a7c018350e4f64f5e4f5a865424c0e

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-incremental-workflow-recovery/proposal.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/proposal.md
- Lines: 1-35
- SHA256: 696b24ae91ad7992c208133adb1714b3c59cda3f1e1eda2914adcc9316bcb76f

```md
# Proposal

## Why

真实多仓验收仍出现同一实现问题被连续升级为 Build→Design、Archive→Verify、Archive→Design 的情况，说明 Runtime 尚未按变化所属权威选择最小恢复点，反而把计划、实现和证据问题折叠为粗粒度 Design 返工。该缺陷会制造重复人工批准、丢失可复用事实，并使自举与团队交付都难以稳定完成，因此必须先于继续扩展产品能力修复。

## What Changes

- **BREAKING**：移除 `design_assumption_invalid`、`planning_semantics_changed` 作为生命周期控制信号；Host 只提交有界事实和关联身份，Runtime 独立验证后选择唯一恢复动作。
- 引入互斥的 `revise-design`、`revise-plan`、`continue-build` 与 `invalidate-evidence` 恢复语义，并按“规格/设计 → 执行计划 → 实现执行 → 验证证据”的权威层级一次选择最高受影响层，禁止同一变化被连续惩罚。
- 让计划包边界、依赖、测试切面或命令形态问题留在 Build 内修订 Plan；当前输入未变的中断或失败继续当前 Build；只有批准的规格或设计语义改变才回到 Design。
- 使 Evidence 失效只重开真正依赖已变化输入的检查。任务完成 checkbox、实现提交 OID 和其他不改变规划语义或验证输入面的控制面变化，不再单独触发 Design 或全量 Verify 回退。
- 在产生副作用前补齐前置校验：Requirement 引用语法与存在性、TDD Work Package 的完整 RED/GREEN/回归闭包，以及新 capability 的规范 Purpose 均在 Open/Design 或 Plan Evidence 边界失败，而不是在 Execute、Verify 或 Archive 才暴露。
- 用真实多仓验收轨迹建立确定性重放回归，证明错误 RED、计划拆分、收尾 checkbox 与规格收尾不会制造无意义的阶段往返，同时保留历史 claim、packet、invocation、submission、Outcome 和 Evidence 审计事实。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：按权威层级选择唯一恢复动作，取消粗粒度 Build→Design 人工返工协议，并约束阶段回退和检查失效的顺序。
- `managed-work-execution`：定义 Runtime 分类事实、Build Plan 修订、当前 Work 续行、TDD 计划闭包及历史执行事实保留规则。
- `implementation-evidence`：把 Evidence 失效限定到声明的输入面，并区分实现、规划语义与非语义控制面变化。
- `specification-authority`：在早期验证 Requirement 引用、Capability Purpose 与规划语义身份，避免关闭阶段才发现可预判的规格错误。

## Impact

- 主要影响 `services/workflow-runs.ts`、`domains/change-lifecycle`、`domains/work-execution`、`domains/specification`、OpenSpec Provider、Runtime invalidation/telemetry 映射和对应测试。
- Work finding、lifecycle observation、trajectory 与遥测低基数字段会发生内部契约变更；项目尚未发布稳定版，不保留旧信号的并行兼容路径。
- OpenSpec Tasks 继续是规格与任务权威，Runtime Build Plan 继续是执行投影；本变更不会建立第二套 ticket、repair lifecycle、ADR 或 implementation notes。
- Comet 0.5.1（MIT）仅作为恢复语义、失效次序和回归场景的参考；Repoctopus 按自身多仓、OpenSpec、Work/Host 与 Cordis 架构重新实现，不引入 Comet Runtime 或 SDK 依赖。
- 本次垂直切片包含恢复分类器、前置校验、精确失效、遥测和轨迹回放。凭据错误、PR 文案/Skill 不匹配、Desktop Dashboard 及其他非阻塞问题留给后续独立 change。

```

## openspec/changes/stabilize-incremental-workflow-recovery/design.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/design.md
- Lines: 1-146
- SHA256: c6b926a9d7a3ba0d5a0b288fd8ab5ead85f830267d8e0d9d4ee32de78eddd83f

[TRUNCATED]

```md
---
comet_change: stabilize-incremental-workflow-recovery
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 [proposal.md](./proposal.md) 的 Why。当前领域层已经分别拥有 Change Lifecycle、Build Protocol、Work Execution、Specification Authority、Evidence 与 Runtime identity graph，但 Service 编排仍把 `design_assumption_invalid` 和 `planning_semantics_changed` 两种 Host finding直接折叠为 `build-design-revision-required`，并通过额外Human Decision回到Design。与此同时，Build Check已有局部Plan invalidation，Specification Provider已有规划语义摘要，Evidence已有输入指纹；这些能力尚未由一个统一恢复决策连接起来。

真实多仓轨迹证明问题不是缺少更多phase，而是恢复权威被分散：计划切面错误被当成Design错误、任务checkbox提交被当成实现输入漂移、Archive依次经过Verify和Design处理同一根因。固定Comet 0.5.1的`revise-design`、`revise-plan`、`continue-build`与Evidence invalidation提供成熟语义参考，但Repoctopus仍需保留自己的多仓Project Snapshot、OpenSpec Provider、Work/Host、Cordis composition与OTLP契约。

## Goals / Non-Goals

**Goals:**

- 建立唯一、纯领域的恢复决策管线，由有序权威Inspector与薄Coordinator使Runtime而非Host选择恢复动作。
- 让恢复只回到最小且正确的权威checkpoint，并保持CAS幂等、历史可审计和依赖精确失效。
- 在Open/Design与Plan Evidence边界发现可静态判定的Requirement映射、Purpose和TDD包闭包错误。
- 让规划语义、实现内容、执行控制面与publication provenance使用不同身份，避免无关提交使批准和Evidence失效。
- 通过单元、服务、CLI和真实多仓轨迹重放证明恢复路径与遥测均正确。

**Non-Goals:**

- 不引入Comet SDK、存储格式或运行时依赖，也不复制Comet的Classic文档布局。
- 不增加新lifecycle phase、repair worker、第五类OpenSpec工件、ADR或第二套ticket权威。
- 不保留旧finding/transition的双写兼容层；项目尚未发布稳定版，旧活动Run只允许显式失败或重新开始。
- 不处理凭据、PR文案/Skill映射、Dashboard与其他不属于恢复根因的问题。

## Decisions

### 1. 采用 Comet 式有序 Inspector 与显式恢复命令

由多个纯领域、权威专属Inspector分别核对Requirements/Design Evidence、Plan Evidence、当前Work执行与Evidence依赖，再由一个薄`RecoveryCoordinator`按固定顺序选择第一个不再有效的权威。Inspector不依赖Store、Git、OpenSpec CLI或Host；Service负责把已观察事实转换为输入。输出为不可变`RecoveryDecision`：

- `revise-design`：批准的Requirement、Design、Task语义或approval authority已变化。
- `revise-plan`：批准语义不变，但Package边界、依赖、write scope内的测试切面、命令或Plan可行性需要改变。
- `continue-build`：当前Work与输入仍有效，可按retry policy纠正或续行。
- `invalidate-evidence`：上层事实有效，仅声明的Evidence输入发生变化。
- `retry-infrastructure`、`reconcile-external`、`halt`：分别处理暂时不可用、外部结果未知和不可恢复冲突。

Coordinator固定按“规划语义 → Plan → 当前Work → Evidence”执行Inspector；Requirements drift存在时不再运行Plan drift恢复，和Comet的readiness顺序一致。一次observation只产生一个最高层decision，其`decisionId`由run、expected revision/epoch、observation identity、authority diff与invalidation set规范化计算。Service在RunStore转换锁内重新读取输入并通过显式命令应用decision，重复调用返回既有checkpoint或revision conflict。

选择该方案而不是单一巨型分类器，是因为各权威拥有不同Evidence合同，单体输入会不断膨胀；选择它而不是在`workflow-runs.ts`继续添加条件分支，是因为恢复顺序、幂等身份和失效集合必须可独立穷举测试。Service只负责编排事实采集和原子提交。

### 2. 方案比较

- **候选A：有序权威Inspector + 显式Runtime命令（采用）**。最接近Comet 0.5.1的`inspectClassicSdkRevisionReadiness`与revision command模式，同时可复用Repoctopus现有identity graph、多仓Snapshot和Work/Host合同。代价是需要为每层维护独立Evidence输入，但边界清晰。
- **候选B：一个通用RecoveryClassifier**。表面统一，却会把Specification、Plan、Work、Evidence的不同合同塞进一个不断扩张的输入模型，容易成为新的集中式条件分支，因此不采用。
- **候选C：保留各阶段Service条件分支，只替换信号名称**。改动小，但仍会重复判定authority drift，无法保证Requirements优先于Plan或同一根因只处理一次，因此不采用。
- **候选D：直接引入Comet SDK**。能复用实现，但会把Comet的单项目Classic状态、Skill与文档模型带进Repoctopus，破坏多仓OpenSpec Store、Cordis composition和外部Host架构，因此只借鉴语义与测试，不引入依赖。

### 3. Host finding 改为事实合同，移除动作式finding

删除`design_assumption_invalid`与`planning_semantics_changed`。新的有界finding只描述事实层：实现失败、批准权威冲突声明、Plan约束、Evidence不匹配、Evidence基础设施不可用和外部结果未知；同时携带当前Work允许的Requirement、Task、Package与Evidence引用。

Work Execution Validator先校验schema、引用存在性与当前Work关联，再生成稳定finding identity。Host不能提交phase、recovery action或invalidation set。`authority-conflict`也只是待验证声明：Runtime必须重新观察Specification Provider identity后才能选择`revise-design`。

选择事实合同而不是让Host直接返回四种动作，是为了保持Runtime-authoritative，并防止团队自定义Host或Agent绕过权威比较。

### 4. Lifecycle只物化分类结果，不再建立Build→Design提案Wait

移除`build.design-revision-required/approved/rejected`协议和`build-design-revision-required`observation。Lifecycle接受领域decision并物化唯一转换：

- `revise-design`原子创建`specification.plan` Work、递增epoch、挂起Build Protocol并按identity graph失效下游事实；后续仍由正常Design审批决定新规划。
- `revise-plan`保持Build，创建下一revision的`build.plan` Work并保留未受影响completion。
- `continue-build`保持phase、Work与Plan，在同一执行链创建合法attempt或重投未确认attempt。
- `invalidate-evidence`退役受影响check/evidence并返回Build Check、Verify或Archive前置重验的最近合法节点。

Design返工不再先询问“是否回Design”：如果权威语义已经改变，旧approval客观上已无效；如果没有改变，则不应回Design。真正扩大范围、权限或风险的决定仍由已有Open/Design/Plan授权协议处理。

### 5. Identity graph按权威分层并由decision一次计算失效闭包

扩展现有Runtime identity graph，至少区分：

1. `planning-semantic`与`design-approval-authority`；
2. `build-strategy`、`execution-binding`与`build-plan`；
3. `work-input`、`package-completion`与`workspace-checkpoint`；

```

Full source: openspec/changes/stabilize-incremental-workflow-recovery/design.md

## openspec/changes/stabilize-incremental-workflow-recovery/tasks.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/tasks.md
- Lines: 1-168
- SHA256: b2f153fe6f50b735c49d7eaca7ae2abfca2852b85b626dd67d7ec70b2b6e9d23

[TRUNCATED]

```md
# Tasks

## 1. 恢复语义基线

- [x] 1.1 固定Comet 0.5.1的revision、plan与evidence invalidation行为参考及MIT采用边界，并用来源审计测试确认Repoctopus没有引入Comet Runtime依赖 <!-- comet-task:a4fd5783-13b7-434f-b0f9-0d71249ec402 -->
      **Acceptance:** 来源登记精确绑定固定commit和参考文件；依赖图与生产包不包含Comet SDK或Runtime
      **Requirements:** 恢复分类只选择最高受影响权威

- [x] 1.2 为四种核心恢复处置建立失败优先的领域合同测试，并验证相同observation得到稳定decision identity <!-- comet-task:855f7952-223f-4eb0-8295-4618114fe550 -->
      **Blocked by:** 1.1
      **Acceptance:** 测试分别覆盖revise-design、revise-plan、continue-build和invalidate-evidence；重复输入得到相同decision identity
      **Requirements:** 失败分类必须决定真实返工路径, 恢复重放必须收敛到同一 checkpoint

## 2. Runtime 恢复 Inspector

- [x] 2.1 定义规范化Recovery Observation、Authority Diff、Recovery Decision与失效集合，并用schema测试拒绝Host选择phase或恢复动作 <!-- comet-task:e7054d0d-52d7-4dd5-a646-ed0efaa177fe -->
      **Blocked by:** 1.2
      **Acceptance:** 领域类型只能表达有界事实和Runtime decision；含targetPhase或recovery action的Host payload被拒绝
      **Requirements:** Host 只能报告发现而不能选择阶段, Finding 必须先验证再形成恢复处置

- [x] 2.2 实现权威专属Inspector与薄Recovery Coordinator，并用表驱动测试验证planning、plan、work、evidence的固定优先级 <!-- comet-task:ffe993f0-b318-40c2-b970-97dca399e9b7 -->
      **Blocked by:** 2.1
      **Acceptance:** 同时发生多层漂移时只返回最高层处置；仅Plan变化保持Build；仅Evidence变化不失效Plan
      **Requirements:** 恢复分类只选择最高受影响权威, 失败分类必须决定真实返工路径

- [x] 2.3 扩展Runtime identity graph计算保留与失效闭包，并用性质测试验证失效只向下游传播且结果顺序稳定 <!-- comet-task:749e689c-ea08-4d4b-b171-ce48277a7e38 -->
      **Blocked by:** 2.2
      **Acceptance:** 任意identity输入顺序得到相同闭包；publication provenance和Task checkbox不会单独失效planning semantic
      **Requirements:** 恢复分类只选择最高受影响权威, Evidence 失效必须按声明输入面传播

- [x] 2.4 为decision应用增加expected revision、checkEpoch和observation identity CAS保护，并用并发测试验证重复提交只建立一个checkpoint <!-- comet-task:8101fce2-f5f2-445a-a904-475fdd912bf1 -->
      **Blocked by:** 2.3
      **Acceptance:** 两个并发Runner中只有一个提交新checkpoint；另一个返回相同checkpoint或明确revision conflict
      **Requirements:** 恢复重放必须收敛到同一 checkpoint

## 3. Host Finding 与 Continue Build

- [x] 3.1 以事实分类替换design_assumption_invalid和planning_semantics_changed，并用合同测试验证Requirement、Task、Package和Evidence引用边界 <!-- comet-task:0af000c7-725e-4af6-a42b-64d006f51c59 -->
      **Blocked by:** 2.2
      **Acceptance:** 旧finding不再被schema接受或映射生命周期；未知与越界引用使当前submission可纠正地失败
      **Requirements:** Host 只能报告发现而不能选择阶段, Finding 必须先验证再形成恢复处置

- [x] 3.2 实现finding规范化与稳定identity，并用测试验证自由文本摘要不参与低基数分类或恢复动作选择 <!-- comet-task:8284985e-4ff2-47e1-bc0f-d54ec1f13df5 -->
      **Blocked by:** 3.1
      **Acceptance:** 相同结构化事实产生相同identity；只有摘要变化不会改变authority diff或直接选择Design
      **Requirements:** Finding 必须先验证再形成恢复处置

- [x] 3.3 实现continue-build的attempt恢复与结果未知分流，并用重启测试证明claim、packet、invocation、submission和rejection历史被保留 <!-- comet-task:320bf9ce-6559-41d2-9de5-3c77bcfdb786 -->
      **Blocked by:** 2.4, 3.2
      **Acceptance:** 可安全重试的Work继续同一执行链；未知外部副作用进入reconciliation且旧candidate不会被重放
      **Requirements:** Continue Build 保留当前执行身份, 恢复重放必须收敛到同一 checkpoint

## 4. Lifecycle 与 WorkflowRuns 接线

- [x] 4.1 删除build.design-revision-required/approved/rejected及其Wait、observation和旧遥测枚举，并用可达性测试确认没有遗留生产路径 <!-- comet-task:116ced0e-8601-437c-b7c4-6df4f00403ba -->
      **Blocked by:** 3.1
      **Acceptance:** 生产源码与状态定义不再包含旧transition或旧finding；所有核心恢复入口仍可从run next到达
      **Requirements:** 失败分类必须决定真实返工路径, Host 只能报告发现而不能选择阶段

- [x] 4.2 让Lifecycle原子物化revise-design与revise-plan，并用领域测试验证前者建立Design Work、后者保持Build和未受影响completion <!-- comet-task:e6a5e937-ba0f-4a43-a5b4-ea6fc65d7eac -->
      **Blocked by:** 2.4, 4.1
      **Acceptance:** revise-design一次提交phase、Work、epoch与失效闭包；revise-plan只递增Plan revision并保留合法completion
      **Requirements:** 失败分类必须决定真实返工路径, 恢复分类只选择最高受影响权威

- [x] 4.3 让Lifecycle原子物化continue-build与invalidate-evidence，并用领域测试验证最小checkpoint恢复 <!-- comet-task:e35dd6de-5101-4dd6-968e-94c84621368c -->
      **Blocked by:** 3.3, 4.1
      **Acceptance:** continue-build保留Work与Plan；invalidate-evidence只退役依赖变化输入的检查事实并返回最近合法节点
      **Requirements:** Continue Build 保留当前执行身份, Evidence 失效必须按声明输入面传播

- [x] 4.4 将WorkflowRuns中的分散条件分支替换为统一事实收集、有序Inspector和CAS应用管线，并用Service测试验证Host不能绕过Runtime决策 <!-- comet-task:e594e6ac-37d7-4f37-9fed-92b1e9e3440f -->
      **Blocked by:** 4.2, 4.3
      **Acceptance:** Build Plan、Execute、Check、Verify和关闭前置观察使用同一Recovery Coordinator；Service不再直接按finding名称选择phase
      **Requirements:** Finding 必须先验证再形成恢复处置, 恢复重放必须收敛到同一 checkpoint

## 5. Build Plan 前置可行性

- [x] 5.1 扩展Plan Validator验证每个Package的Outcome与Validator闭包，并用失败测试覆盖遗漏Evidence与跨包伪完成 <!-- comet-task:fa22cb21-6026-47cf-b9a7-43e7a8068bef -->
      **Blocked by:** 2.2
      **Acceptance:** 无法在自身边界完成的Package在Execute前被拒绝为Plan finding；合法跨仓Package仍可通过
      **Requirements:** Plan Evidence 必须证明每个 Package 可独立完成

```

Full source: openspec/changes/stabilize-incremental-workflow-recovery/tasks.md

## openspec/changes/stabilize-incremental-workflow-recovery/.openspec.yaml

- Source: openspec/changes/stabilize-incremental-workflow-recovery/.openspec.yaml
- Lines: 1-2
- SHA256: 3e16994612e657a7bbaefe38b70ef46f3e8e9f382f092dcaceb60ebabe7a5da0

```md
schema: spec-driven
created: 2026-11-05

```

## openspec/changes/stabilize-incremental-workflow-recovery/specs/change-lifecycle/spec.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/specs/change-lifecycle/spec.md
- Lines: 1-67
- SHA256: 9ca2fc6d9d517fd9fc87b7f0d6b78c3ee73175647e729193accf6d8b8810b9a6

```md
# change-lifecycle Delta

## MODIFIED Requirements

### Requirement: 失败分类必须决定真实返工路径

Runtime MUST 根据当前权威身份、持久化失败事实、输入依赖和副作用边界计算一个恢复处置；Host、Agent 与调用方不得提交目标 phase 或恢复动作。处置只允许 `revise-design`、`revise-plan`、`continue-build`、`invalidate-evidence`、`retry-infrastructure`、`reconcile-external` 或 `halt`，并在同一 Run 保留历史事实、精确失效下游依赖并递增合法 transition 的 `checkEpoch`。

#### Scenario: Verify 发现实现行为失败

- **WHEN** Verify review 或 Gate 证明实现不满足当前批准规格，但规格、设计和 Task 语义仍有效
- **THEN** Runtime 选择 `revise-plan` 返回 Build，由修订计划产生普通 Execute Work，不返回 Design或创建特殊 Repair lifecycle

#### Scenario: Verify 依赖暂时不可用

- **WHEN** 失败来自 Evidence Provider、命令环境或其他基础设施，且没有事实证明实现、计划或批准设计错误
- **THEN** Runtime 选择 `retry-infrastructure` 并保持 Verify blocked/retry，不重开 Build Task、不使 Design approval 失效

#### Scenario: Archive 前发现验证输入陈旧

- **WHEN** Archive 尚未开始规格关闭或外部 publication 副作用，且当前 Verify identity 仅因已声明 Evidence 输入变化而失效
- **THEN** Runtime 选择 `invalidate-evidence` 返回 Verify 并只重采受影响 Evidence；若副作用已经开始则选择 `reconcile-external` 并保持 Archive

#### Scenario: 批准规划语义已经改变

- **WHEN** Runtime 观察到当前 Proposal、Delta Specs、Design、Tasks 或 Change metadata 的规范化语义身份不再等于可信批准身份
- **THEN** Runtime 选择 `revise-design`，原子建立新的 Design Work并精确失效依赖旧规划的事实

#### Scenario: 当前 Build Work 输入仍有效

- **WHEN** Build Work 失败、中断或被校验拒绝，但其规划、计划、Binding、Work input 与副作用边界仍可安全续行
- **THEN** Runtime 选择 `continue-build` 并恢复同一 Work 的合法下一 attempt，不重建 Design、Build Strategy或 Build Plan

## ADDED Requirements

### Requirement: 恢复分类只选择最高受影响权威

Runtime MUST 按“规格与设计语义、Build Plan、实现执行、Evidence”的固定优先级比较当前身份与已接受 checkpoint，并为一次观察选择唯一恢复处置。高层身份变化 MUST 使其依赖的低层事实精确失效；同一变化不得先触发低层重验，再以相同根因触发更高层回退。

#### Scenario: 规划与 Evidence 同时变化

- **WHEN** 一次观察同时发现 planning semantic digest 与 Verification Input 不匹配
- **THEN** Runtime 只选择 `revise-design`，并把 Evidence 失效作为该处置的下游结果，不先返回 Verify再返回 Design

#### Scenario: Plan 变化但批准语义相同

- **WHEN** Work Package 边界、依赖、测试切面或检查命令需要调整，但 OpenSpec 规划语义和 Design approval仍有效
- **THEN** Runtime 选择 `revise-plan` 并保持 Build phase，不建立新的 Design Human Decision

#### Scenario: 只有 Evidence 输入变化

- **WHEN** 规划、Plan 和实现 checkpoint均有效，只有一个检查声明的输入面发生变化
- **THEN** Runtime 选择 `invalidate-evidence` 并只退役依赖该输入面的 Receipt、Bundle、Gate或 Check Evidence

### Requirement: 恢复重放必须收敛到同一 checkpoint

每个恢复处置 MUST 绑定原 observation、权威身份、受影响依赖集合、from revision 与 `checkEpoch`。重复 pull、进程重启或相同 observation 重放 MUST 返回既有恢复 checkpoint或 revision conflict，不得重复创建 Work、Wait、Plan revision、失效记录或人工批准。

#### Scenario: 同一 Plan finding 被重复提交

- **WHEN** 两个 Runner 对相同 Run revision、Plan identity和 finding identity提交恢复观察
- **THEN** 只有一个 `revise-plan` checkpoint被接受，另一个返回既有 checkpoint或明确冲突

#### Scenario: Archive 恢复后进程退出

- **WHEN** Runtime 已为输入漂移建立 `invalidate-evidence` checkpoint，但响应返回前进程退出
- **THEN** 下一次 pull 从该 checkpoint继续，不重新建立 Archive、Verify或 Design 回退链

```

## openspec/changes/stabilize-incremental-workflow-recovery/specs/implementation-evidence/spec.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/specs/implementation-evidence/spec.md
- Lines: 1-86
- SHA256: 6abc28c0ad9e53b01af3663a9c04a3253488132fa9f89b1572ae7850542d6b31

[TRUNCATED]

```md
# implementation-evidence Delta

## MODIFIED Requirements

### Requirement: Evidence 输入必须区分产品与执行控制面

Repoctopus MUST 使用版本化 Repository Input Policy 与仓库角色把输入区分为实现产品内容、规范化规划语义、内容寻址的执行控制面和未知输入。Evidence fingerprint 与 Verification Input MUST 记录各分区identity及当前检查实际声明的依赖；不得把协调仓原始HEAD、Task checkbox或publication provenance冒充规划语义，也不得静默忽略检查真实消费的输入。

#### Scenario: 外部 Host 在仓库中安装执行文件

- **WHEN** 未被 Git 跟踪的 Hook、Agent 指令、Skill 或锁文件匹配当前 composition 提供的受限 Host input rule
- **THEN** Runtime 不把它计为实现产品 dirty file，但以规范路径、类型、内容摘要、owner 和 policy identity 写入 control-plane manifest，并使消费该控制面的 Evidence 绑定该 manifest digest

#### Scenario: 未知未跟踪文件出现

- **WHEN** 一个未跟踪文件不匹配任何受信 Host rule或已登记规划工件规则
- **THEN** 该文件继续按实际内容进入对应仓库的产品dirty fingerprint，不因目录名、点前缀或用户ignore配置被排除

#### Scenario: 控制面文件在采集后变化

- **WHEN** Host Hook、Skill、指令、锁文件集合、内容、类型或输入策略在消费它们的Evidence采集开始后变化
- **THEN** 对应Attempt标记为`superseded`或Gate拒绝旧Bundle；未声明依赖这些输入的其他Evidence保持有效

#### Scenario: Specification 仓只勾选已完成 Task

- **WHEN** Specification Provider确认Task稳定ID、正文、依赖、Acceptance和Requirement mappings未变，只有合法Work导致checkbox状态和协调仓commit变化
- **THEN** planning semantic identity保持不变，未声明读取checkbox或commit的实现与验证Evidence不得失效

### Requirement: 控制面输入分类必须 fail-closed

Repository Input Policy MUST 只把未跟踪、未打包、位于仓库根内且满足版本化精确规则的外部本地执行输入分类为控制面输入。Git tracked 产品路径 MUST 保持产品输入；注册的Specification Authority仓库或路径中的官方规划工件即使被Git跟踪，也 MUST 作为planning semantic输入处理，不得仅因tracked状态被重分类为产品输入或控制面输入。只有external-exclusive路径进入产品面、规则重叠、类型不符、路径逃逸、竞态或无法稳定读取才 MUST 阻断指纹采集。

#### Scenario: 双用途 Host 路径被团队版本化

- **WHEN** 团队把允许版本化的 `AGENTS.md`、Skill 或其他双用途路径提交到 HEAD、index 或 tracked modification
- **THEN** Runtime 把它作为产品 tree 或 dirty 输入取指纹，不再按本地 control-plane rule 排除

#### Scenario: 外部独占路径被提交到产品 tree

- **WHEN** policy 声明为 external-exclusive 的旧 Host 安装路径出现在 HEAD、index 或 tracked modification
- **THEN** Runtime 报告产品与控制面所有权冲突并拒绝 Evidence

#### Scenario: 控制面符号链接逃逸仓库

- **WHEN** 登记路径解析到仓库根外、在读取期间改变对象身份或使用不允许的文件类型
- **THEN** 指纹采集 fail-closed，且诊断不读取或泄露仓库外内容

#### Scenario: 输入枚举顺序不同

- **WHEN** 两次采集观察到相同产品内容、控制面内容和策略，仅 Git 或文件系统返回顺序不同
- **THEN** 规范排序后的 product、control-plane 和最终 Evidence digest 完全相同

## ADDED Requirements

### Requirement: Evidence 失效必须按声明输入面传播

每个Receipt、Bundle、Gate、Plan Evidence、Build Check Evidence和Verification Input MUST保存其规范化依赖集合。Runtime选择`invalidate-evidence`时 MUST沿身份依赖图只退役直接或传递依赖已变化输入的事实，并记录保留项、失效项和原因；phase、commit、checkbox或文件时间变化本身不得成为全量失效依据。

#### Scenario: 一个测试命令的源码输入变化

- **WHEN** 只有命令A声明的实现文件发生变化，命令B的argv、cwd、环境、工具和输入集合均未变化
- **THEN** Runtime只使A的Receipt及其下游Bundle/Gate失效，并可保留B的有效Receipt

#### Scenario: 检查显式依赖 Git identity

- **WHEN** 检查产物包含commit SHA并在策略中声明Git identity为输入
- **THEN** 对应commit变化使该检查Evidence失效，即使文件语义内容等价

#### Scenario: 非语义收尾提交

- **WHEN** 协调仓提交只更新Task checkbox、验证报告引用或publication provenance，且没有改变planning semantic identity或任何检查声明的输入
- **THEN** Runtime保留Design approval、Build Plan、实现completion与Verify Evidence，不返回Design或Verify

### Requirement: Evidence 无效与 Evidence 不可用必须分离

Runtime MUST 区分“既有Evidence因输入变化不再适用”与“Evidence Provider或环境暂时不可用”。前者选择`invalidate-evidence`并重新采集受影响节点；后者保持当前检查blocked/retry，不得通过Plan或Design返工掩盖基础设施问题。

#### Scenario: Receipt 输入已经漂移

- **WHEN** Receipt绑定的源码、规划语义、配置、工具或控制面identity与当前依赖集合不一致

```

Full source: openspec/changes/stabilize-incremental-workflow-recovery/specs/implementation-evidence/spec.md

## openspec/changes/stabilize-incremental-workflow-recovery/specs/managed-work-execution/spec.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/specs/managed-work-execution/spec.md
- Lines: 1-95
- SHA256: 8f448090e76eb7a2e0afccb677afbe85012164707daf70bf2b3c7916a58a0710

[TRUNCATED]

```md
# managed-work-execution Delta

## MODIFIED Requirements

### Requirement: Host 只能报告发现而不能选择阶段

Repoctopus MUST 让 Host Outcome 只表达当前 Work 的结果、产物、工具事实、受影响 Requirement/Task/Package identities与 definition允许的有界事实分类；Outcome schema MUST NOT接受`targetPhase`、恢复动作、任意 continuation或伪造Human Decision。Runtime MUST独立读取当前权威与checkpoint、验证finding关联和事实后选择下一Action；Host finding名称本身不得等价于Design、Build、Verify或Archive转换。

#### Scenario: Host 报告设计假设无效

- **WHEN** Build Host提交绑定当前Work、Requirement和Task的设计冲突事实
- **THEN** Runtime重新观察当前规格与批准身份；只有其证明批准设计语义无效时才选择`revise-design`，否则按Plan、实现或Evidence层处理

#### Scenario: Host 指定目标 phase

- **WHEN** Host Outcome或调用方字段尝试指定phase、`revise-design`、`revise-plan`、`continue-build`、`invalidate-evidence`或done
- **THEN** Runtime拒绝该Outcome并记录协议错误，不据此修改lifecycle或失效任何checkpoint

#### Scenario: 普通 Build 失败重复发生

- **WHEN** 同一逻辑 Build Work连续返回可重试 implementation failure且当前输入仍有效
- **THEN** Runtime仅按有界retry policy选择`continue-build`并创建后续attempt；达到上限时进入稳定blocked/Human Decision，不无限重派、不重建Plan或创建另一Run

## ADDED Requirements

### Requirement: Finding 必须先验证再形成恢复处置

Runtime MUST 验证每个 Host finding 的 schema、分类、Requirement/Task/Package关联、当前Work输入和可观察证据，并把通过验证的事实规范化为稳定 finding identity。未知引用、互相矛盾的分类或无法证明影响层级的 finding MUST fail closed，不能自动升级为 Design返工。

#### Scenario: Plan finding 引用当前 Work Package

- **WHEN** finding证明当前包的依赖、顺序、测试切面或命令形态不可执行，且引用的Task与Requirement均属于已批准范围
- **THEN** Runtime把它分类到Plan层并选择`revise-plan`，保留Design approval与不受影响的package completion

#### Scenario: Finding 引用未知 Requirement

- **WHEN** Host提交的Requirement、Task或Package identity不属于当前批准规划或当前Build Plan
- **THEN** Runtime拒绝submission并保持当前Work可纠正，不创建Design Human Decision或Plan revision

#### Scenario: 无法确定事实影响层级

- **WHEN** finding只有自由文本且没有足够的身份或证据证明受影响权威
- **THEN** Runtime保持blocked并请求可核对事实或Human Decision，不默认回到Design

### Requirement: Continue Build 保留当前执行身份

`continue-build` MUST 沿用当前Work、Plan revision、packet、claim、Host invocation与已提交结果的审计链，只创建definition允许的下一attempt或重新派发同一未确认attempt。已经确定执行过且结果未知的副作用 MUST 先reconcile；旧candidate不得作为新attempt结果重放。

#### Scenario: Host 在提交结果前退出

- **WHEN** Runtime能证明副作用未执行或当前Work是无副作用计算，且Plan与Work input仍有效
- **THEN** Runtime选择`continue-build`并按同一Work identity恢复，不创建新的Plan或Design Work

#### Scenario: Submission 被 Validator 拒绝

- **WHEN** Host submission已持久化但因输出schema或候选内容不合法被拒绝
- **THEN** Runtime保留claim、packet、invocation、submission与rejection，继续当前Work的纠正attempt，不把拒绝冒充Planning语义变化

#### Scenario: 外部结果未知

- **WHEN** Work可能已经执行不可重放的外部副作用但没有确定Receipt
- **THEN** Runtime选择reconcile而不是`continue-build`，直到结果被观察为executed或not-executed

### Requirement: Plan Evidence 必须证明每个 Package 可独立完成

Plan Validator MUST 在Execute前证明每个required Work Package都能在自身边界内产出其Validator要求的完整Outcome与Evidence。TDD策略下，每个可完成Package MUST拥有同一行为切片的失败基线、实现结果、转绿结果与相关回归证据，除非definition显式把多个步骤建模为一个不可分割Package；不得把RED和GREEN拆到彼此可以独立完成的不同Package。

#### Scenario: RED 与实现被拆成两个可完成 Package

- **WHEN** TDD Build Plan让一个Package只产生失败测试，另一个Package才实现并转绿，而前者仍声明可独立完成
- **THEN** Plan Evidence在派发Execute前拒绝该计划并返回Plan finding，不等到Package completion才失败或返回Design

#### Scenario: 一个 Package 覆盖完整 TDD 切片

- **WHEN** Package为同一行为保存RED、实现、GREEN和相关回归命令，且其依赖与write scope合法
- **THEN** Plan Evidence可以接受该Package并允许Runtime创建Execute Work

#### Scenario: Direct TDD 模式

- **WHEN** 已批准Strategy使用`tddMode=direct`

```

Full source: openspec/changes/stabilize-incremental-workflow-recovery/specs/managed-work-execution/spec.md

## openspec/changes/stabilize-incremental-workflow-recovery/specs/specification-authority/spec.md

- Source: openspec/changes/stabilize-incremental-workflow-recovery/specs/specification-authority/spec.md
- Lines: 1-55
- SHA256: 11001345169192e57677cba839712c5ab3f7e24b67cd6ae808d9a8ffb26d1754

```md
# specification-authority Delta

## ADDED Requirements

### Requirement: Task Requirement 映射必须在规划批准前解析

Specification Provider MUST 在Open与Design严格校验中把每个Task和Acceptance的Requirement metadata解析为规范化稳定引用，并确认引用存在于当前主规格或change delta。Provider MUST拒绝歧义分隔、空引用、重复冲突与未知Requirement；Runtime、Build Plan和Host不得重新解析自由文本或在Build阶段猜测映射。

#### Scenario: 多个 Requirement 使用受支持分隔符

- **WHEN** Tasks用Provider声明的逗号、分号或对应全角形式列出多个Requirement引用
- **THEN** Provider规范化为有序、去重的独立引用并为每个引用解析稳定Requirement identity

#### Scenario: 未知 Requirement 引用

- **WHEN** Task metadata引用当前主规格与delta均不存在的Requirement
- **THEN** Open或Design严格校验失败并定位Task与原始token，不创建Human Decision、Build Plan或Evidence Attempt

#### Scenario: 映射文本存在歧义

- **WHEN** Requirement metadata包含空token、未闭合标记或无法按声明语法唯一解析的内容
- **THEN** Provider fail closed并要求修正规划工件，不把整行静默当作一个Requirement identity

### Requirement: 新 Capability 的关闭前置条件必须早期验证

Specification Provider MUST 在规划批准前计算当前change可静态确定的关闭前置条件。每个新增capability MUST具有满足官方schema与严格校验的规范Purpose来源，且delta操作、退役声明和受影响主规格关系必须可形成唯一关闭计划；这些错误不得延迟到Archive候选创建后才报告。

#### Scenario: 新 Capability 缺少 Purpose

- **WHEN** delta新增capability但没有可归档为主规格Purpose的有效内容
- **THEN** Open或Design严格校验失败并指向对应delta，不允许进入Build

#### Scenario: Purpose 在规划时有效

- **WHEN** 每个新增capability均提供有效Purpose，操作集合与主规格现状可形成唯一关闭计划
- **THEN** Provider记录绑定planning semantic identity的closure preflight evidence，Archive仍重新观察当前输入但不重新发明Purpose

#### Scenario: Archive 前规划语义未变化

- **WHEN** Archive观察到planning semantic identity与获批closure preflight完全一致
- **THEN** Provider可复用静态关闭结论并只执行当前文件与候选checkout验证，不因更晚发现同一可预判错误返回Design

### Requirement: 规划语义与发布身份必须分别参与恢复分类

Specification Provider MUST分别公开规划语义identity、完成状态投影和publication provenance。Runtime MUST只用规划语义identity与trusted approval判定`revise-design`；checkbox、协调仓commit、分支发布OID和实现报告不得被折叠进该identity，除非它们改变Provider声明的规划语义字段。

#### Scenario: 实现提交推进 source OID

- **WHEN** source branch因实现或测试commit变化，但四类规划工件语义与Change metadata未变
- **THEN** Runtime只更新publication或workspace progress事实，不选择`revise-design`

#### Scenario: Task Acceptance 正文改变

- **WHEN** Task的Acceptance、Requirement mapping、依赖或正文在批准后改变
- **THEN** planning semantic identity改变，Runtime选择`revise-design`并精确失效依赖旧语义的Plan与Evidence

```
