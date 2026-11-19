# Comet Design Handoff

- Change: recommend-build-strategy-from-context
- Phase: design
- Mode: compact
- Context hash: b6ed51b5f6dc76f266e21a03098a71f0a22cd29e041d385de1cefb583f363545

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/recommend-build-strategy-from-context/proposal.md

- Source: openspec/changes/recommend-build-strategy-from-context/proposal.md
- Lines: 1-31
- SHA256: f365b12ded56b33928a7820443cd1fcd07da83aa2f4db4313b74d34c10e2e8ec

```md
# Proposal

## Why

当前入口未指定执行策略时，CLI 和 Service 会在 `run start` 把 `autonomous + tdd` 写成完整偏好；Design 审批和 Build Configure 随后复用该值。用户无法分辨这是结合任务场景作出的建议，还是未审查的默认值；多 Agent 与 TDD 的实际能力约束虽然存在，选择过程却没有接通。

## What Changes

- 在 Design 审批前，由当前 Host 根据已核对的任务范围、依赖、可委派边界、宿主能力和测试切面，分别推荐执行模式与 TDD，并说明依据；Runtime 校验并将最终选择绑定到当前 Design 决定。
- **BREAKING**：未提供执行模式或 TDD 的启动请求不再隐式冻结默认策略。明确输入只表达本次偏好，不能单独代替可信批准；缺项由受管 Design 路径补齐，不能阻止正常 Open。
- 保持现有两种执行模式与两种 TDD 选择、固定审查要求及五阶段协议。正常流程沿用 Open 和 Design 两次审批，不增加常规 Build 配置批准。
- 保留 Strategy 与机器 Binding 分离：Build Configure 核验真实能力及隔离绑定，冷恢复复用原选择；实际能力不满足时阻断，不静默换模式。
- 对齐入口、阶段 Skill、CLI 帮助和 Workspace 内教程，并用真实安装包多仓 Change 验证选择、执行、冷恢复及归档。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：补齐未决偏好、可审查建议、最终策略批准与冻结之间的生产流程。
- `skill-integration`：入口与 Design Skill 根据真实场景解释并推荐两个独立配置轴，执行仍消费 Runtime 冻结的当前 Skill 组合。

## Impact

- 涉及 `app/cli/main.ts`、`services/workflow-runs.ts`、Build Strategy/配置与生命周期决定协议，以及入口和 Design/Configure Skill。
- 更新相关 CLI 文档、Workspace 教程与执行配置说明；不新增配置中心、规划文档或遥测体系。
- 本次交付从公开入口到 Design 决定、Build Configure 与实际执行的完整切片；不新增执行模式、Hotfix profile、自动模式升级、团队策略语言或复杂度评分器。
- 参考固定 Comet 0.5.1 与本次核对的上游 0.5.5，采用其 Host 提案、Runtime 校验、当前决定绑定及恢复思想；不引入其 SDK、Superpowers 工作流或新依赖，不更新产品上游固定版本。沿用现有参考来源和许可证管理，若实施直接采用源码片段则同步 provenance 与必要声明。

```

## openspec/changes/recommend-build-strategy-from-context/design.md

- Source: openspec/changes/recommend-build-strategy-from-context/design.md
- Lines: 1-120
- SHA256: bcb9bff4d03b30e6ce5f0ba2cab86ed3828d48cd222e354909984c239370e8e1

[TRUNCATED]

```md
# Design

## Context

问题与交付边界见 [proposal.md](proposal.md)。当前根因横跨入口、Service 和决定协议：

- `app/cli/main.ts` 与 `services/workflow-runs.ts` 在缺参时补 `autonomous + tdd`，启动 trigger 的完整 `buildStrategyPreference` 无法区分“用户选择”和“默认”。
- 独立 `spec approval prepare` 也会补两轴默认并以 `current` 构造策略摘要；它不是根据本 Run 的当前 Design Work 形成的候选，不能继续成为默认策略的第二个入口。
- `WorkflowRunsService.buildStrategy()` 从该偏好创建 Strategy，Design 决定绑定它的 digest；当前阶段 Skill 没有把场景分析、建议与结构化配置提交接入此路径。
- `repoctopus-build-configure` 的正文仍写“提出执行/TDD 配置并由用户批准”，与主规格已经确立的“Design 批准 Strategy，Configure 验证 Binding”存在冲突。
- 已有 Strategy/ExecutionBinding 身份分离、受管子 Agent 回执、TDD 证据、宿主人工决定和增量恢复能力应继续作为权威，不另造并行机制。

## Goals / Non-Goals

目标是让建议在审批前真实发生，让批准后的运行遵循已展示选择。范围保留当前两种执行模式、两种 TDD 模式、固定 `standard` Review 和现有隔离模式；不加入 Hotfix、自动升级、打分分类器或第二套任务/设计文档。Task 与测试权威继续来自 OpenSpec 和既有 Evidence。

## Decisions

### 1. 借鉴 Comet 的责任划分，保留我们现有的两次审查

本次对照的上游证据：

| 来源 | 核对内容 | 采用范围 |
| --- | --- | --- |
| 固定 Comet 0.5.1，`35c9860b77b42bafa0c2d80d8d695889f888a924`，`domains/comet-classic/classic-build-configuration.ts` | full 配置缺项、枚举与实际委派确认校验；没有按仓数/复杂度自动选模式的分类器 | 未决配置显式表达，能力与配置分别验证 |
| 同一固定提交，`domains/comet-classic/classic-sdk-build.ts` | `full.build.configure` 提案，当前 proposal hash 决定，只有已有真实当前选择才可 confirmed | Host 提案、Runtime 校验，当前授权可复用且不重复确认 |
| 本次只读核对的 Comet 0.5.5 HEAD，`c458764e53fd3592bfdd9a0db6396a68c97a7758`，`assets/skills-zh/comet-build/SKILL.md` 与 `assets/skills-zh/comet-classic/reference/sdk-methods.md` | Design 后配置，按缺项或显式变更提问，恢复原待决定提案；执行与 TDD 为独立选择 | 同样的提案/授权/恢复边界，而非声称存在上游自动推荐算法 |

Comet 在 Build Configure 单独确认配置；Repoctopus 当前主规格为减少重复操作，已把完整 Strategy 并入 Design 决定。本次保持该用户体验，将 Host 的场景建议提前到 Design Work，Build Configure 只核验实际 ExecutionBinding 和能力。正常流程仍有 Open、Design 两次审查；策略真实改选时才沿既有决定路径处理。

未选择“再加一次 Configure 批准”，因为会恢复用户之前明确反对的重复确认；未选择“只给入口加提示”，因为 Service 默认冻结与结构化提交缺口仍存在。

### 2. 按事实推荐，Runtime 不推测任务复杂度

入口保存当前明确偏好，不先强迫用户选完配置才能进行 Open。Design Host 在已核对代码和 Tasks 后，依据实际影响范围、契约边界、依赖、宿主委派能力和测试切面提出完整建议。两轴分别说明理由：可独立分工时建议多 Agent，小范围紧耦合可建议 autonomous；可观察行为和缺陷回归优先 TDD，纯文档可选 direct。

这些是 Repoctopus Host 的判断指引，属于对 Comet 责任模型的适配，不是抄入一套不存在的上游评分算法。缺少能力或测试入口需要揭示，不静默改变已明确偏好。`direct` 只免除逐任务先红后绿，不能取消适用测试、Build Check 或 Verify。

### 3. 明确偏好、提案和授权的生命周期

启动偏好允许 execution/TDD 分别未指定，保留当前明确来源；移除 CLI 和 Service 的隐式补全。启动时非法值仍在持久化前拒绝。Design 的当前 Work 可以通过类型化 Outcome 提交完整建议与可展示理由；Runtime 校验枚举、当前 Work、proposal 和任务/规划归属，缺项不建立可批准的完整 Design 决定。

决定视图明确显示两轴的最终值、用户输入与 Host 建议的区别，以及能力限制。可信 Design approval 一次绑定当前规划语义和 Strategy digest，不能先写规划授权再留下缺失策略的半批准状态。Host 不直接写 Run Store、选择 phase 或另开配置入口。

建议理由和来源作为审查与审计材料，与决定关联；Strategy digest 仍只覆盖稳定语义选择及隔离意图，不混入解释措辞、Host identity、能力列表、HEAD 或机器路径。下述协议完成当前 Design 的数据落点与提交边界，不建立旧协议双读/双写或迁移执行分支。

#### 3.1 数据落点及来源

| 数据 | 所属权威与来源 | 消费规则 |
| --- | --- | --- |
| `buildStrategyPreference` | 新 Run trigger，schema 2；两轴可选，只保留公开请求显式输入 | trigger 保持不可变；未指定属性不补默认，不用它在后期重建完整 Strategy |
| `build-strategy-candidate` | 当前 `specification.plan` 的 Host Outcome result，schema 1 | 两轴完整、各有有限长度的理由与项目相对依据引用；Work/invocation/packet/attempt 从已有 envelope 核对，不接受调用方伪造来源 |
| `strategyProposal` | 同一 Run 的 lifecycle checkpoint，引用已接受 submission 及当前 Provider planning identity | 保存候选的规范选择、原审查材料及来源，供等待、决定和冷恢复读取；不是新 Store 或第五规划文档 |
| `BuildStrategy` | 已批准 Design 接受时生成，继续使用当前 schema 1 | 仅从同一次接受的完整提案生成，进入 BuildProtocol；后续从已批准 protocol 读取，不回读 trigger 偏好 |

候选内容明确为 `schemaVersion`、`kind`、`executionMode`、`tddMode` 和两轴的 `rationale`；每轴说明包含简述与有界依据引用列表。Review 固定 `standard`，isolation 来自已批准 Open，二者由 Runtime 组成最终 Strategy，不让 Host 在 result 中重复声明或改选。偏好来源与偏离由 Runtime 比较 trigger 和候选得出；Host 的理由不能把自己标成用户已经选择。真实能力来自现有 Host/能力观察，理由引用不构成能力认证。

`WorkExecutionResult` 扩展这个明确标签；`ManagedWorkExecutor` 的边界解析按 Work kind 限定 result。成功 `specification.plan` 缺候选、缺理由、越界或枚举无效时，使用现有可归属拒绝持久化与 `awaiting-correction`，保留原 invocation/packet，不能先把 Work 记成功再让后继永久等待。此 result 不注册到 Build 专用 processor 表，Build 四种既有 result 不变。

两处公开 CLI 和 Service 一并消除隐式选择。`spec approval prepare` 改为要求 `--run`，经相同 Workflow Service 读取本 Run 已接受的当前 Design 候选与 Open 隔离意图；已有 change/branch/target 参数只可作一致性断言，不得覆盖绑定身份。不再根据命令行的默认或单独两轴参数构造另一份 Strategy，更不硬编码 `current`。缺失 Run、未完成 Design Work、候选不完整或参数不匹配时返回当前工作流指引，不新建独立批准。测试覆盖 branch/worktree 与入口一致性，不因主 Skill 使用 `run start` 就遗漏它。

#### 3.2 首次执行、修正与原子接受

1. 设计 Work 的 packet 交付明确偏好、现有事实引用、两个独立选择轴和完整 result 协议。未决偏好不阻断该 Work 的生成、领取或执行。
2. 可信当前 Host 完成同一四类工件并提交候选。先通过现有 envelope、Skill 消费与 result 校验，再让 Provider 严格观察当前产物。Provider 不可用时保留原提交并重新观察；确定性产物错误沿既有 Design 修正路径处理。
3. 从已接受的当前 submission 派生候选，用其语义摘要执行 `SpecificationPlanning.assess`，然后在原有 `design-gate` 等待 transition 的受保护 CAS 中，把 submission 身份、Provider identity、候选和原请求一起保存为唯一 `strategyProposal`。不为这个字段额外增加一次 lifecycle transition 或 epoch。审批 Store 已准备而等待 CAS 未写入时，从原已接受 submission 重新核对并采用同一请求，不重跑 Host。如已保存相同提案则幂等复用；候选不存在或未被接受时只继续/纠正当前 Design Work，不调用需要完整 Strategy 的审批快照构造，也不把缺项误报成 Provider 不可用。
4. 原有 `LifecycleHumanDecisionView.materials` 追加可读策略、两轴理由、输入来源及限制；Shared Planning Approval 继续绑定原规划和 `buildStrategyDigest`，不另设配置批准。当前 Run 的参与事实仍需验证，另一 Run 的共享批准不能凭空提供本 Run 的提案或隔离绑定。
5. 用户通过现有 `approve | revise | reject` 回答。改选可在原生问题或对话里说明需要的两轴，再对当前提案提交 `revise`；沿现有 Design 修订 Work 提交新的完整候选后审查。不得把新值塞进旧提案的 approve 答复，或修改不可变 trigger 绕过当前提案。
6. Provider approval receipt 与 Run checkpoint 仍分别持久化。这里的“原子批准”指进入 Build 的 `design-gate` CAS 同时安装匹配的 planning identity、Strategy、BuildProtocol 与下一 Work；不声称两个 Store 有分布式事务。批准已持久化而 gate 未提交时，恢复重验原 request、当前提案、Provider、task set 和 revision，采用同一 receipt 后再提交，不重复向用户批准。

两轴值或隔离意图变化会改变 Strategy digest；附属解释、能力观察或提交变化不直接改变该 digest。已发布的提案材料保持不可变，同语义恢复展示原材料，不用重算的措辞覆盖它。四类工件本身真实修改仍按现有 Provider planning semantics 判定，不能借“解释变化不重批”跳过真实 Design 变更。

### 4. 保持已有身份分离和恢复顺序

Design 决定通过既有宿主原生问答及 `run decide --response-file` 闭环处理。相同提案恢复原请求，提交成功响应丢失恢复已接受事实；不通过重复启动、重写 Store 或历史对话推断当前批准。

Configure 负责绑定事实，当前 Work claim 负责所需能力。缺兼容宿主时保留原策略并返回明确阻断，可换兼容宿主继续；不因为前后 Work 所需能力不同重建全部策略。显式改选才改变 Strategy 语义并走现有失效分类。代码提交、Task checkbox 与建议说明变化不单独改变策略授权；规划本身真实变化仍按现有规划恢复规则处理。

从 Build/Verify 返回 Design 时，原 Strategy 作为“此前获批”的上下文交付，不重新标成新的用户偏好，也不丢失初始偏好来源。新 Work 对未改变的选择可以说明沿用理由；同一稳定策略授权按已有规则复用，真正变化才产生对应新摘要。协调 Host 或能力变化不进入候选的语义身份；Design 领取者只需满足当前只读/规格写入 Work 的能力，不能预先要求其 claim 满足完整 Build Binding。


```

Full source: openspec/changes/recommend-build-strategy-from-context/design.md

## openspec/changes/recommend-build-strategy-from-context/tasks.md

- Source: openspec/changes/recommend-build-strategy-from-context/tasks.md
- Lines: 1-48
- SHA256: 78ef36ceb3c1acb755c14a90e22471efabc7ca5bb5036dcdb5b460a8bacb7eba

```md
# Tasks

## 1. 打通未决偏好到 Design 决定的生产路径

- [ ] 1.1 先建立缺参默认冻结的失败回归，再更新启动偏好与建议协议，验证缺参、部分输入、完整输入和非法输入 <!-- comet-task:a62e6fb0-79be-4feb-b8f4-ced99cf94d42 -->
  **Acceptance:** 修复前公开启动路径因静默补全而失败；修复后缺参可进入 Open，部分偏好不被覆盖，非法值不创建 Run，完整值仍需当前可信批准；spec approval prepare 绑定同一 Run 候选和隔离意图，不再补默认策略；相关类型与回归检查通过。
  **Requirements:** change-lifecycle / 未指定的启动偏好不得成为已批准策略。
- [ ] 1.2 将 Design Work 的完整建议接入当前决定视图与原子批准路径，验证 Configure 使用同一已批准策略 <!-- comet-task:2b7a50f4-1883-401e-a4a7-1923062a0f3e -->
  **Acceptance:** 公开 Work Outcome 可提交两轴建议、理由与来源；缺项或非法候选保留原 invocation 进入可补交纠正，不提前记成功；陈旧响应不能进入 Build；真实当前 Design 决定一次批准规划与策略，Configure 不追加相同配置问题；同步更新运行时状态及协议说明。
  **Requirements:** change-lifecycle / Build Configuration 只允许受支持的固定策略；场景建议与策略授权保持可核对且可恢复。
  **Blocked by:** 1.1。

## 2. 接通场景建议和用户接入体验

- [ ] 2.1 更新入口、Design 与 Configure Skill 的责任及安装模板，用消费契约检查验证场景指引与 Runtime 权威一致 <!-- comet-task:6c5c49ef-7a54-4189-af15-ad85e9394d5d -->
  **Acceptance:** 入口不要求先选全才启动；Design 分别分析两轴并展示当前偏好；Configure 不再宣称重新批准策略；已安装入口、冻结 packet 与模板保持一致，不增加独立方法或规划权威。
  **Requirements:** skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略；change-lifecycle / Build Configuration 只允许受支持的固定策略。
  **Blocked by:** 1.2。
- [ ] 2.2 更新 CLI 帮助、工作流说明和 Workspace 本地教程，用生成产物检查和实际命令验证缺省与显式选择示例 <!-- comet-task:a701ac8f-c99a-40cf-99aa-e6d6477fe3e2 -->
  **Acceptance:** 文档清楚区分推荐、偏好、批准和实际执行；示例覆盖两轴独立与能力限制，没有默认为已批准或新增第三次常规确认的说明；初始化生成文档与源码说明一致。
  **Requirements:** change-lifecycle / 未指定的启动偏好不得成为已批准策略；skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略。
  **Blocked by:** 2.1。

## 3. 守住恢复、能力与执行证据边界

- [ ] 3.1 扩展决定及恢复回归，验证相同提案、响应丢失、显式改选和等价收尾的审批及失效次数 <!-- comet-task:e50b95cd-d8e9-4d5e-aee7-b898aa205a16 -->
  **Acceptance:** 新进程复用原请求或接受事实，覆盖 Provider approval 已写入但 Run gate 尚未提交的中断；相同配置只批准一次；run revise-strategy 从安全 Build/Verify 边界进入受管 Design，执行未知时阻断、终态拒绝、请求重放幂等，改选不复用旧答复；提交、checkbox、措辞或单纯能力缺席不使相同策略重新批准；真实规划或策略变化仍触发现有正确恢复路径。
  **Requirements:** change-lifecycle / 场景建议与策略授权保持可核对且可恢复；Build Configuration 只允许受支持的固定策略。
  **Blocked by:** 1.2。
- [ ] 3.2 验证四种支持组合及缺能力分支，核对实际 Execute Skill、TDD 和委派回执约束 <!-- comet-task:67524809-8c40-40c4-b28e-3e05e578cba3 -->
  **Acceptance:** 两轴四种组合均可被合法选择；tdd 实际交付方法且要求 RED/GREEN/回归证据；direct 保留适用检查；多 Agent 要求真实受管委派证据，缺能力明确阻断不静默降级；autonomous 不接受未声明的委派。
  **Requirements:** skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略；change-lifecycle / Build Configuration 只允许受支持的固定策略。
  **Blocked by:** 2.1；3.1。

## 4. 真实安装包多仓验收与完整验证

- [ ] 4.1 用实际候选包和宿主执行小型多仓 Change，完成场景建议、原生 Design 选择、实际执行、同 Run 冷恢复和 Archive <!-- comet-task:2171ed0c-5507-4d1e-a071-7e0414535fd8 -->
  **Acceptance:** 行为修改、可分工多包和纯文档场景有实际依据；至少一次真实宿主原生选择并经正式接口提交；在决定和首包边界冷恢复保持有效事实；到 Archive 后无重复发布；现有配置、Work/Skill 与恢复遥测对应实际批准选择，不以自造批准替代真实交互。
  **Requirements:** change-lifecycle / 场景建议与策略授权保持可核对且可恢复；未指定的启动偏好不得成为已批准策略；skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略。
  **Blocked by:** 2.2；3.2。
- [ ] 4.2 完成独立审查与完整 Verify，交付绑定实现和实际验收包身份的正式验证报告 <!-- comet-task:d55b0d76-6d49-481c-be64-881c115c4ff7 -->
  **Acceptance:** 独立审查无未解决阻断项；声明的完整验证和严格规格校验通过；`verification/recommend-build-strategy-from-context/verification-report.md` 包含实际实现提交、包内容摘要、文件数及字节数，原始实验记录可追溯，明确未覆盖限制。
  **Requirements:** change-lifecycle / 场景建议与策略授权保持可核对且可恢复；Build Configuration 只允许受支持的固定策略；skill-integration / 入口和 Design Skill 按真实任务场景推荐执行策略。
  **Blocked by:** 4.1。

## Workflow follow-up

- 获得当前交付目标与影响的明确授权后，归档、创建 PR，并在 CI 通过后合入；不把归档动作列为实现 checkbox。

```

## openspec/changes/recommend-build-strategy-from-context/.openspec.yaml

- Source: openspec/changes/recommend-build-strategy-from-context/.openspec.yaml
- Lines: 1-2
- SHA256: 277c3c07d7ab9927f15fff0d9c08afbbb9cc808d563ada95016a72a464a761e0

```md
schema: spec-driven
created: 2026-11-18

```

## openspec/changes/recommend-build-strategy-from-context/specs/change-lifecycle/spec.md

- Source: openspec/changes/recommend-build-strategy-from-context/specs/change-lifecycle/spec.md
- Lines: 1-100
- SHA256: 277ab2295d8c6fa51acfdbd1a034b770d59c52302b6bd6de2421405c9f814fa8

[TRUNCATED]

```md
## MODIFIED Requirements

### Requirement: Build Configuration 只允许受支持的固定策略

Repoctopus MUST把Build的稳定人类/团队语义建模为版本化`BuildStrategy`，仅允许`executionMode=autonomous|subagent-driven-development`、`tddMode=tdd|direct`、`reviewMode=standard`和`isolationIntent=current|branch|worktree`。Design Human Decision MUST展示Host结合当前场景提出的完整策略、来源与理由，并绑定完整Strategy semantic digest；Build Configure MUST只解析和验证独立ExecutionBinding。Runtime不得因合法Work间required capabilities不同、当前Work暂无兼容Host、进程恢复或同摘要返工而重建Binding或重复请求批准。只有Strategy语义、coordinator Host identity或Binding-owned Workspace facts变化时才能按对应权威失效。

#### Scenario: 兼容Host执行不同Build Action

- **WHEN** 同一coordinator Host依次为Configure、Plan、Execute和Check声明各自Work所需能力，Strategy和Workspace Binding未改变
- **THEN** Runtime保持同一Strategy和ExecutionBinding，逐Work完成claim preflight，不创建额外Human Decision或Configure Work

#### Scenario: 用户批准受支持的配置

- **WHEN** Host根据已批准Open、Design、Tasks、可核对能力和用户偏好提出合法BuildStrategy，当前composition兼容该策略，且可信用户批准Design语义摘要
- **THEN** Run固定Strategy identity/digest，后续Configure、Plan、Work、Check和遥测都引用该Strategy，不再创建常规Build Configuration approval

#### Scenario: 兼容 Host 或 checkout 变化

- **WHEN** 恢复时coordinator Host identity或本地checkout变化，但isolation intent、repository ownership和全部Strategy语义仍满足
- **THEN** Runtime重新验证并冻结新的ExecutionBinding，使依赖旧Binding-owned输入的Plan/Evidence失效，但复用已批准Strategy且不建立新Human Decision

#### Scenario: 实际隔离没有可信 binding

- **WHEN** Runner或Host只声明isolation名称，但没有为受影响仓库提供可验证checkout、branch、head、worktree ownership与Workspace facts
- **THEN** Build Configure阻断并报告ExecutionBinding诊断，不从路径或当前进程目录猜测，也不要求用户批准无法验证的机器事实

#### Scenario: 请求 Hotfix profile

- **WHEN** 调用方请求Hotfix、Tweak或任一未声明workflow profile
- **THEN** Runtime拒绝请求并保持唯一完整Change lifecycle，不把profile映射成隐藏快捷路径

#### Scenario: 批准后请求切换执行模式

- **WHEN** 已批准Strategy的execution/TDD/isolation语义被显式改变
- **THEN** Runtime使旧Strategy approval失效并建立绑定新语义摘要的Human Decision，不静默重写或把机器Binding重验冒充策略批准

#### Scenario: direct TDD 模式执行任务

- **WHEN** Strategy选择`tddMode=direct`
- **THEN** Work可以不强制逐任务先红后绿，但仍必须声明相关测试、执行回归检查并通过Build Check与Verify

#### Scenario: 当前Work缺少兼容Host

- **WHEN** Strategy和ExecutionBinding仍有效，但没有Host声明当前Work的完整capabilities
- **THEN** Runtime保持当前phase、Work和checkEpoch并返回结构化blocked continuation；它不得把Host availability误分类为Strategy或Binding变化

#### Scenario: 协调Host或Workspace事实变化

- **WHEN** coordinator Host identity、repository topology、branch/worktree ownership、isolation或local overlay与当前Binding不一致
- **THEN** Runtime派发唯一Build Configure revalidation并精确失效依赖旧Binding的后继事实，不重放旧Host Outcome

## ADDED Requirements

### Requirement: 未指定的启动偏好不得成为已批准策略

Repoctopus MUST 区分执行模式与 TDD 的明确启动偏好、未指定值、Host 建议和可信批准。缺少任一偏好的新 Run MUST 可以正常完成 Open，并在 Design 决定前补齐建议。默认值、历史 Run、CLI 成功或启动参数本身 MUST NOT 形成 Strategy approval；新请求中的非法值 MUST 在写入 Run 前被拒绝。

#### Scenario: 两个配置均未指定

- **WHEN** 用户通过入口 Skill 或公开 CLI 启动新 Change，没有选择执行模式和 TDD
- **THEN** Runtime 保留两个未指定事实并正常进入 Open，在完成 Design 前要求形成可审查策略，不静默把 `autonomous + tdd` 冻结为用户选择

#### Scenario: 只指定其中一个配置

- **WHEN** 本次启动明确选择了 TDD，但未选择执行模式，或反之
- **THEN** 系统保留明确偏好的来源，仅为缺项生成建议；如建议改变已有偏好，Host 展示差异并取得当前 Design 决定，不以另一项默认值覆盖用户意图

#### Scenario: 明确指定完整配置

- **WHEN** 用户提供受支持的完整执行模式与 TDD 偏好
- **THEN** Design 展示该选择与能力约束，当前可信 Design approval 同时批准该策略，后续 Configure 不重复请求相同配置批准

#### Scenario: 非法启动值

- **WHEN** 启动请求携带未声明的 execution 或 TDD 值
- **THEN** Runtime 返回可定位的参数诊断，且不为该请求创建新 Run 或 Work

### Requirement: 场景建议与策略授权保持可核对且可恢复

Repoctopus MUST 在 Design 决定中展示最终 execution mode、TDD mode、建议理由、明确偏好来源和已知能力限制。Runtime MUST 校验当前提案与决定身份，将策略授权与 Design 授权原子绑定；不完整、陈旧或不属于当前请求的答复不得进入 Build。相同语义的恢复 MUST 复用当前提案或已接受决定，不因建议措辞、进程、Git 提交或任务完成复选框变化重复批准。

```

Full source: openspec/changes/recommend-build-strategy-from-context/specs/change-lifecycle/spec.md

## openspec/changes/recommend-build-strategy-from-context/specs/skill-integration/spec.md

- Source: openspec/changes/recommend-build-strategy-from-context/specs/skill-integration/spec.md
- Lines: 1-35
- SHA256: c78b45df86643e1f54916e5edd38dcacf52ad3314a6fcc14dbc4a804d10b397e

```md
## ADDED Requirements

### Requirement: 入口和 Design Skill 按真实任务场景推荐执行策略

Repoctopus 的入口与 Design Skill MUST 引导 Host 核对当前 Change 的受影响范围、任务依赖、可委派边界、实际宿主能力及测试切面，分别解释 execution mode 与 TDD mode 的建议，并保留当前明确用户偏好。建议 MUST 在 Design 决定前可见，不得以仓库总数、任务数量或固定默认值替代分析。Host MUST 只通过当前 Work 的受管 Outcome 提交建议，不获得决定阶段、冻结配置或绕过审批的权限。

#### Scenario: 多仓 Workspace 只改一个紧耦合功能

- **WHEN** Workspace 登记多个仓库，但本次工作范围小、耦合强或缺少可独立委派边界
- **THEN** Host 可以推荐 autonomous，说明实际范围和选择理由，不仅因 Workspace 多仓而强制多 Agent

#### Scenario: 有明确可并行或分工边界

- **WHEN** 经代码与 Tasks 核对，工作可按清晰契约分为独立责任边界，且存在支持受管委派的宿主
- **THEN** Host 可以推荐 subagent-driven-development，并说明边界、依赖与委派能力依据；建议本身不构成已派发或已执行证明

#### Scenario: 行为变更或可复现缺陷

- **WHEN** 当前任务改变可观察行为，或具有可表达的缺陷回归条件
- **THEN** Host 通常推荐 tdd，指明可验证的行为与测试入口；缺少测试基础设施时展示需要补齐的条件，不把缺测试静默等同于无需测试

#### Scenario: 无可执行行为的文档修改

- **WHEN** 当前任务仅改文档等无可执行行为内容，核对后没有适用的失败行为测试
- **THEN** Host 可以推荐 direct 并解释原因，仍保留适用的内容校验、回归、Build Check 和 Verify，不伪造 RED/GREEN 证据

#### Scenario: 两个配置轴独立

- **WHEN** 当前场景适合多 Agent 分工，但不适合行为测试先行，或适合单 Agent 实施且需要缺陷回归
- **THEN** Host 分别解释 subagent-driven-development + direct 或 autonomous + tdd 的建议，不把执行模式绑定到固定 TDD 选择

#### Scenario: 执行阶段消费已冻结选择

- **WHEN** 当前 Design 与策略已获可信批准，Runtime 派发 Execute Work
- **THEN** Host 消费 Runtime 按冻结策略装填的 Action 与方法 Skill，只有 tdd 模式装填 TDD augmentation，且真实委派和测试证据仍由原有执行协议校验

```
