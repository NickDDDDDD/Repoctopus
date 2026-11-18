# Design

## Context

问题与交付边界见 [proposal.md](proposal.md)。当前根因横跨入口、Service 和决定协议：

- `app/cli/main.ts` 与 `services/workflow-runs.ts` 在缺参时补 `autonomous + tdd`，启动 trigger 的完整 `buildStrategyPreference` 无法区分“用户选择”和“默认”。
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

建议理由和来源作为审查与审计材料，与决定关联；Strategy digest 仍只覆盖稳定语义选择及隔离意图，不混入解释措辞、Host identity、能力列表、HEAD 或机器路径。结构化字段位置与必要的 schema 版本调整在正式 Design 深化中按现有类型边界确定，不建立旧协议双读/双写或迁移执行分支。

### 4. 保持已有身份分离和恢复顺序

Design 决定通过既有宿主原生问答及 `run decide --response-file` 闭环处理。相同提案恢复原请求，提交成功响应丢失恢复已接受事实；不通过重复启动、重写 Store 或历史对话推断当前批准。

Configure 负责绑定事实，当前 Work claim 负责所需能力。缺兼容宿主时保留原策略并返回明确阻断，可换兼容宿主继续；不因为前后 Work 所需能力不同重建全部策略。显式改选才改变 Strategy 语义并走现有失效分类。代码提交、Task checkbox 与建议说明变化不单独改变策略授权；规划本身真实变化仍按现有规划恢复规则处理。

### 5. Cordis 与领域边界

- CLI 只解析显式输入和投影现有 continuation，不设置策略默认值或自行选阶段。
- Cordis Workflow Service 协调当前 Provider、Work、宿主观察与决定；统一入口，不新增平行 Store。
- 领域协议定义未决偏好、建议与 Strategy 的合法转换、稳定语义身份及决定绑定。
- Engine 继续负责原子提交、唯一 Run、Claim 与 Outcome 权威；平台适配器只提供真实 Git/Host 事实。
- Skill 负责场景推理与解释，方法增强继续使用现有 Matt/OpenSpec 组合。安装后的 Workspace 入口与教程从同一模板更新。

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
