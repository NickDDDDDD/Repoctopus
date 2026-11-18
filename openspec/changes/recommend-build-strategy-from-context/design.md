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

#### 4.1 已批准后的明确改选入口

当前 `run decide` 只能回答已存在的决定，不能主动修改 Build/Verify 的策略；本次补齐公开的 `run revise-strategy --run <id> [--execution-mode <value>] [--tdd-mode <value>]`。它表达修订意图，不提交批准或目标 phase，也不直接切换正在运行的策略。

- 至少给出一个合法值；未给的轴取当前已批准 Strategy，首次 Design 尚未批准时取当前完整待审候选。二者均不存在则要求补全，不能回读启动默认。两个轴均未改变时只返回原状态。Runtime 核对当前 Run、预期 revision、原策略或候选 identity、可信调用 actor 与该请求的幂等身份。
- 允许范围为非终态 Design/Build/Verify。Design 已有待决定提案时沿现有 revise 路径处理；Build/Verify 在相关执行没有 running/unknown invocation、未决命令或不可核对副作用时，由 Runtime 记录 `strategy-revision-requested` 并选择受管 `revise-design`。否则保留原策略，返回具体待核对原执行的指引；Archive 和终态明确拒绝。
- Runtime 保存独立的修订请求事实和新偏好来源，不修改 trigger；由生命周期创建当前 Design Work，旧批准、Plan、Binding 和完成事实保持可审计，并按现有 suspension/依赖规则处置。恢复记录明确原因为用户请求策略改选，不谎称 Provider 规划内容已漂移。
- Host 在新 Design Work 中针对这个请求提交完整候选；用户仍批准当前 Design 提案，接受后才形成新 Strategy。之后合法 Configure/Plan 重验依赖新策略的输入。已经运行中的包不会被直接切换协议，也不会为了保留进度而复用无法证明兼容的旧证据。
- 修订请求持久化而响应丢失时，恢复原请求及同一 Design Work；重复请求不再回退或增加决定。该路径不扩展自动模式升级，不提供设置 phase 或篡改已批准配置的接口。

### 5. Cordis 与领域边界

- CLI 只解析显式输入和投影现有 continuation，不设置策略默认值或自行选阶段。
- Cordis Workflow Service 协调当前 Provider、Work、宿主观察与决定；统一入口，不新增平行 Store。
- 领域协议定义未决偏好、建议与 Strategy 的合法转换、稳定语义身份及决定绑定。
- Engine 继续负责原子提交、唯一 Run、Claim 与 Outcome 权威；平台适配器只提供真实 Git/Host 事实。
- Skill 负责场景推理与解释，方法增强继续使用现有 Matt/OpenSpec 组合。安装后的 Workspace 入口与教程从同一模板更新。

术语遵循已落地的身份分离：`specification-authority` 中不参与规划授权的 Build configuration 指机器 ExecutionBinding 与执行计划，不包含 `change-lifecycle` 明确要求绑定 Design 的稳定 BuildStrategy。当前实施只能把稳定策略语义放进现有 `buildStrategyDigest`；能力、checkout、Plan 或候选解释不得借该字段进入审批语义。若代码或 Provider contract 显示这一既有分界不成立，停止实施并核对权威冲突，不能用混合摘要折中。

### 6. 以真实生产路径验收选择和使用

先建立修复前必败回归：缺参启动不应被视为已选择，Design 无完整策略不得推进。覆盖两轴部分输入与四种合法组合、非法输入、陈旧决定、能力不满足、相同提案冷恢复和真实语义修改。

使用当前候选 `.tgz` 初始化独立的模拟多仓项目，经公开 CLI 从 Open 到 Archive 执行小 Change：一条可观察行为修改验证 TDD 和 RED/GREEN；一条明确分工的多包任务验证受管多 Agent；无可执行行为的文档路径验证 direct 及正常校验。真实宿主展示至少一次完整 Design 选择并回传，不能把测试进程自己构造 approve 当作真实用户决定。能够共享同一案例覆盖多轴时合并案例，仍保留所有边界断言。

在 Design 决定前、决定提交后和首包完成后换进程恢复，交叉核对 checkpoint、真实消费的 Skill、TDD 或委派证据、有效包完成身份和发布副作用次数。遥测仅核对现有 Run/config、Work/Skill 和恢复事实正确反映最终批准选择，不新增高频建议事件、正文或高基数字段。验收结果写入正式 `verification/<change>/verification-report.md`，绑定真实实现提交与实际安装包的规范化内容摘要。

## Risks / Trade-offs

- Host 判断可能不够好 → 理由、输入来源与差异对用户可见，由真实当前决定批准；不把关键词命中当事实证明。
- 将完整策略从启动延后可能触发旧默认假设 → 回归覆盖 Open、Design、Configure 的完整公开路径与所有生产调用方，缺项只阻断需完整策略的边界。
- 宿主在 Design 后变化 → 继续用既有 Binding 与逐 Work claim 校验，能力缺席不静默降级，不重新发起相同策略批准。
- 规划身份与策略身份互相误伤 → 分别记录实际语义来源；正反向测试提交、checkbox、说明文字和真正配置变更，保持现有最高受影响权威规则。

## Migration Plan

本次优先保证新 Run，不恢复旧缺少来源信息的开发 checkpoint，不引入兼容层。若协议或 definition 需要更新，按现有预发布规则明确版本与拒绝诊断，保留旧 Run 供只读审计。发布回退使用原包与隔离实验现场，不将新旧状态互相覆盖。

当前 BuildStrategy 与 BuildProtocol 的结构不因这次选择入口变化而改变，保留现有 schema；新增候选协议与 trigger schema 独立版本化。Lifecycle definition 与 Design Validator identity 随实际新 contract 更新，不把旧成功 Design Outcome 自动补成新候选，不对旧 Run 宣告兼容恢复。
