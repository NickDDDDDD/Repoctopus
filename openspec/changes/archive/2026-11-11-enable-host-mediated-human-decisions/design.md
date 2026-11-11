---
comet_change: enable-host-mediated-human-decisions
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-11-enable-host-mediated-human-decisions
status: final
---

# Design

## Context

动机和范围见 proposal.md。当前 `run decide` 在 CLI 边界强制检查 stdin/stdout 的 TTY 状态；`nextActions` 只给终端命令。领域层已经具有版本化规划请求、`requestId`、`proposalHash`、阶段区分和可信 Actor 参数，`run.change.decide` 已通过统一 Cordis Command Router 进入 WorkflowRuns。缺口是 Host 获取当前决定材料并提交真实选择的公开链路。

本文件是基于已批准 Open 基线深化的候选正式设计，仍等待 Design 决定。两个 delta spec 是行为要求，tasks.md 是任务完成权威。下述设计无需修改已批准 delta specs。

## Goals / Non-Goals

**Goals:**

- 交付当前生命周期人工决定的读取、宿主交互、正式回传、Runtime 接受和恢复闭环。
- 优先验证真实 Open／Design 双审批和多仓 isolation；同一 `run decide` 的执行意图修订、Build Plan 风险请求复用该合同。
- 保持现有规划权威、Cordis 组合、当前 Run 和持久化边界。

**Non-Goals:**

- 不改变五阶段状态机，不把人工决定包装为新的 Work 或普通 Work Outcome。
- 不新增专用 IDE SDK、后台审批服务、Dashboard 写入通道或 OTLP 授权通道。
- 不改造项目接入和旧 delivery 审批入口，不处理三个旧提案，不实现新的方法证据框架。

## Decisions

### 1. 采用 Comet 的 Host-mediated 决策分工

参考固定 Comet 0.5.1（`35c9860b77b42bafa0c2d80d8d695889f888a924`）：

- `skills/comet-classic/reference/decision-point.md`：有原生提问工具时使用工具；没有则在对话中列出选项并等待真实答复；已有明确且仍适用的授权可以复用，工具缺失不构成授权。
- `domains/comet-classic/classic-sdk-design.ts`：校验阶段、分支、当前 Wait 和 proposalHash，并在批准前重新验证 Design 来源，再交由 Runtime 解析 Wait。
- `domains/comet-classic/classic-sdk-build.ts`：正式决定绑定当前待处理配置或计划请求，而不是依赖交互终端状态。
- `domains/comet-classic/classic-sdk-archive-decision.ts`：分离准备提案、决定提交与实际副作用，并保留未知结果和过期输入的阻断。

只采用已核对的行为与分工，不执行 Comet 内部脚本、不引入其 SDK。Host 是真实用户答复的信任来源；Runtime 负责可验证的请求归属、当前性、选择与后继行为。非交互 CLI 是传输入口，不宣称它能够独立证明人点击了某个工具。来源和授权依据需要如实记录，不能伪造为另一个经过认证的 IDE 会话。

### 2. 提供材料读取与显式提交，保留终端模式

由产品 Service 从当前 Run 和已有规划批准状态构建有界的只读交互视图，包含 Run/change、phase、decision kind、请求及提案身份、评审材料引用、允许选择和必需附加输入。视图不自行重新生成审批或改变语义摘要。

公共 CLI 显式区分终端评审与 Host 回传；原终端用法继续收集用户输入，Host 路径处理已取得的真实决定。两者共享决定解析和 `run.change.decide` 权威入口，不让 Agent 导入 Service、编辑 Store 或把审批塞入 Work Outcome。公开参数及来源记录的最小合同见下方接口设计；不能以一个不绑定当前请求的自动批准开关替代。

### 3. 在 Host 协议中明确交互职责

Runtime 的 `ask` continuation 及相关公开指引提供可以执行的“读取材料 → 提问 → 等待 → 回传 → 核对结果”流程。原生提问工具的选择属于 Host 适配，不把某个平台的工具名写入核心 Runtime。没有结构化工具时使用对话选项；没有可用真实用户上下文时才要求终端评审。

Open／Design Action 只执行当前 Work。Host 完成 Work Outcome 后处理独立决定，不自行改变 phase。Open 必需的 isolation 和当前等待类型由请求声明；不增加每次恢复都要用户确认的额外配置步骤。

### 4. 复用权威校验与恢复结果

提交协调验证当前 Run、请求、提案身份、phase 和所选选项，并调用既有 Provider／Planning 权威和 isolation 绑定验证。新入口不削弱这些校验，也不按用户消息文本猜测目标阶段。

中断后先读取当前等待或该请求的已接受决定。重复选择不产生第二次转换；冲突、过期和未知结果保留可定位诊断。Open 与 Design 使用不同请求，不通过读取“最新任意批准”跨阶段复用答复。多仓 Workspace、Store 和 repository identities 继续由现有组合及冻结事实约束。

### 5. 区分协议验收与真实宿主验收

先用真实失败回归证明当前非 TTY Host 无法完成合法回传，再实现安装包公共 CLI 的端到端路径。负例覆盖错误 Run/request/hash、旧阶段答复、缺少 isolation、非法选择、冲突决定和结果返回前中断。

至少完成一次真实宿主原生问题展示、真实用户选择、实际候选包提交和 Runtime 接受的闭环；另覆盖 Open／Design 两个独立请求及多仓恢复。模拟 Host 用于自动化边界测试，不能作为真实 UI 验收。若当前宿主无法完成真实交互，记录阻断，不把脚本输送终端输入或伪造 TTY 当作通过。

### 6. 保持观测和来源审计的单向性

复用当前 Human Decision／Wait 的持久化与 Trajectory／OTLP 投影链路，必要来源字段只使用有界枚举。Telemetry 和 Desktop 只能展示已接受事实，不能写入决定。问答正文、自由评论、凭据和本地路径不得进入新 Metric label 或遥测载荷。

在正式 Design／Build 固定实际采用的上游文件、摘要和行为对应关系，沿现有 provenance 审计执行；不复制新第三方实现时不增加运行依赖。

## Approaches

用户已经在 Open 选择采用 Comet 的 Host-mediated 方式，并批准本次范围；以下是工程取舍，不是新增用户需求。

| 方案                                       | 取舍                                                        | 结论                     |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------ |
| 显式只读材料与 Host 回传，复用当前决定权威 | 复用 Comet 分工，可覆盖不同宿主；真实用户答复仍由 Host 保障 | 采用                     |
| 强制所有决定都转到终端                     | 无法解决已经复现的对话中断问题                              | 保留为回退，不作为主路径 |
| 专用 IDE 认证插件或常驻审批服务            | 增加新的宿主集成、部署与身份系统；不在已批准范围内          | 不采用                   |

## Public Interfaces

### 1. 只读材料与结果核对

新增公开命令：

```text
repoctopus run decision --run <run-id> --json
repoctopus run decision --run <run-id> --request-id <request-id> --proposal-hash <digest> --json
```

第一种读取当前等待；没有等待时返回当前阶段和明确的无待决定状态。第二种按完整身份核对原请求：两个 selector 同时提供，不能只凭一个摘要或任意最近批准进行匹配。

结果使用现有 CLI envelope，内部为版本化 `LifecycleHumanDecisionView`，包含 Run/change、原审批 phase、`decisionKind`、请求及提案身份、`pending | accepted | superseded | not-found` 状态、评审材料、允许选择、条件必需输入、响应模板以及下一步完整命令 argv。`accepted` 仅表示该原决定已被权威接受，不表示后继阶段已经完成；另返回当前 Run phase/status 和是否仍为当前有效请求。规划决定同时标明 `authorityScope=planning-change`、原记录的 `recordedViaRunId`（历史未知时为 null）及当前 Run 的等待／采纳情况，不能把共享批准伪装成当前 Run 的一次用户点击。

四种 kind 固定为 `specification-open`、`specification-design`、`workspace-intent-revision`、`build-plan-risk`。材料分别来自规划批准 Store 和当前 Run 的 intent／Plan Evidence，不从 prompt 或 OTLP 拼接。规划材料包含当前被冻结的 Provider/schema、Store、能力、目标分支、四类工件与 Strategy 引用；意图和风险材料包含既有有界原因与对应 Plan／隔离事实。视图不触发新的审批、不改变摘要，也不把“读到材料”解释为已完成提交前重验。

### 2. 显式 Host 回传与原终端模式

新增 Host 模式，沿用原命令：

```text
repoctopus run decide --run <run-id> --response-file <response.json> --json
```

未提供 `--response-file` 时继续原交互终端模式及 TTY 检查；提供文件时进入显式 Host 模式，不读取终端问题或依赖伪造 TTY。Host 从视图返回的模板填充，避免猜测 JSON 格式。文件合同如下，所有未知字段拒绝，`decision` 的合法值由当前 kind 的合同控制：

```json
{
  "apiVersion": "repoctopus/v1alpha1",
  "kind": "LifecycleHumanDecisionResponse",
  "runId": "<run-id>",
  "phase": "open",
  "decisionKind": "specification-open",
  "requestId": "<request-id>",
  "proposalHash": "sha256:<digest>",
  "decision": "approve",
  "isolation": "branch",
  "interaction": {
    "channel": "native",
    "authorization": "user-response",
    "reference": "<opaque-answer-reference>"
  }
}
```

- `isolation` 仅适用于需要它的批准；Open 批准及意图替换批准要求明确合法值，Design 与风险决定不得携带无关 isolation。
- 可选 `comment` 沿用现有 4096 字符上限。整个文件限制为 64 KiB，模板中的未填写值不能通过验证。
- `interaction.channel` 只允许 `native | conversation`；`authorization` 只允许 `user-response | delegated`；reference 为非空、至多 512 字符的 opaque 引用，Host 只能引用真实答复或仍覆盖当前提案的明确委托。缺少实际授权时不提交。
- 文件不接受 `actorId`、`source`、`authenticated`、目标 phase 或 continuation。phase 是待决定请求的匹配字段，不能作为推进指令。
- CLI 从本地执行上下文取得 Actor，来源仍如实标记为 CLI 传输；不声称它是经过另一个 IDE SDK 认证的主体。宿主问答渠道和授权依据与本机执行主体分开记录。reference 存储摘要用于关联，不能当作 Runtime 已独立核验用户点击的证明。

Runtime 返回接受结果及正式下一步 argv。Host 按返回结果调用后续 pull，提交命令不主动执行下一项 Agent Work。这样保留 Open／Design 的“决定存入规划批准 Store，后续 pull 重验并推进”和另两种决定直接产生受保护转换的既有区别。

## Implementation Boundaries

- 在 `domains/change-lifecycle` 定义交互视图、回传合同、kind 映射、输入边界和纯校验；不能从 CLI 自己解释 phase transition。
- 由一个 Cordis Service 汇聚只读材料、校验 Host 回传及查找已有决定，再委托现有 `WorkflowRuns.decideChange`。通过统一 App Boot 和 Command Router 注册 `run.decision` 与对应提交命令；CLI 不直接组装新 Service。
- 原终端选择也转成相同领域输入，经同一提交协调入口处理；只保留呈现方式差异，避免复制四份审批分支。
- `SpecificationPlanning` 增加按原 phase 观察当前提案的只读 helper，复用现有 collect／PlanningSnapshot 逻辑。提交前核对 Provider/schema、严格校验、规划语义和当前请求，写入仍受已有 CAS 保护。后继 pull 的既有规划重验继续保留，处理文件无法被审批操作全程锁定的 TOCTOU。
- 修改 `nextActions`、`ask` continuation 的相关可执行指引和 Host workflow 文档，让 Host 获得当前决定视图与提交步骤。核心只声明交互职责，不绑定特定平台工具 API；有原生工具优先使用，无工具采用对话答复，没有交互上下文才回退终端。

## Decision Semantics

| kind                      | 权威来源及可用决定                                             | 结果                                                                               |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| specification-open        | 当前 Open 请求的 approve/revise/reject；approve 需要 isolation | 复用规划决定与 intent 验证，随后 pull 重验；不能冒充 Design                        |
| specification-design      | 当前 Design 请求的 approve/revise/reject                       | 复用独立 Design 决定，随后 pull 决定后继 Action                                    |
| workspace-intent-revision | approve 替换意图；非批准沿原不应用语义处理                     | approve 原子生成 intent 修订转换；非批准明确返回未应用且保持等待，不伪造已接受决定 |
| build-plan-risk           | 使用既有 Plan Evidence 的批准／返回规划语义                    | approve 继续当前有效包／Check；非批准回到 Plan，保留实际原始选择及其规范化效果     |

Host 视图和响应校验从同一 kind 描述导出允许选择及条件字段。Build Plan 中既有 revise/reject 的效果等价映射不能静默丢失原始选择；接受后若再回传不同原始选择，应报告冲突，而不是覆盖。终端模式保留原选项和效果。

## Persistence and Recovery

### 权威保持单一

不建立新的决定 Store、第二套审批状态机或通用 Receipt 框架。Open／Design 的决定仍以规划批准 Store 中的记录为权威；意图与 Plan 决定仍以既有 `change.lifecycle.transitioned` 观察和转换事实为权威。

在原始权威记录中保存最小交互 provenance 与需要核对的原始选择。新规划记录的 `recordedViaRunId` 只说明传输来源，不成为规划语义身份或每 Run 独立授权字段。规划批准记录被 supersede 时保留新产生的原决定；没有完整决定内容的历史记录只能返回 superseded／未知详情，不猜测其 choice。对 Run 转换决定，元数据随同既有 guarded commit／转换 Journal 持久化；后置遥测或日志不充当接受凭据。无需改变现有 phase、Run 或 Build Protocol schema，也不新增旧 checkpoint 迁移层。

### 共享规划批准与 Run 交互归属分开

现有规划 Store 按 change／phase 存储，同一规划摘要会在使用 `decisionRunId` 生成新请求前直接复用已有记录。本次保留该行为：规划批准的权威范围是 SpecificationRoot、change、phase 与提案语义，不能为了交互入口把 runId 加入其语义摘要或改为每 Run 独立审批。

但是，交互查询和提交必须先在指定 Run 中证明请求参与关系：当前 Human Decision wait，或持久化的原等待／规划批准采纳事实，包含匹配的 requestId、proposalHash、phase/kind，并与该 Run 冻结的 SpecificationRoot/change 一致。通过这一核对后，才能读取对应规划决定；仅因 Store 中有同名 change 的已批准记录不能判定任意 Run 已获批准。

- Run A 的回传文件带 runId=A，却被用于 CLI `--run B` 时，在写入前拒绝，即使规划摘要相同。
- Run B 合法持有同一共享请求时，可以沿现有政策复用 Run A 写入的同语义批准；视图明确展示共享批准来源与 B 的等待／采纳状态。不同原始选择仍与已接受决定冲突。
- Run C 没有该请求的等待或采纳事实时，不能凭 change 名称和 Store 命中返回 accepted 或提交决定。
- 查询旧请求时先证明该 Run 的历史参与，再解析规划历史；来源或决定内容不完整时显示 unknown／superseded，不伪造采纳、choice 或用户身份。

这一区分同时约束终端和 Host 路径，不改变既有共享规划批准政策，也不增加新的批准权威。

### 核对先于重试

1. 在当前请求上先完成结构、选择、身份、规划和 isolation 前置校验；非法字段或不兼容 isolation 不得产生批准事实。
2. Open 意图已记录、规划决定尚未写入时，恢复返回仍待决定及已选 isolation；同一原始回传可复用既有 intent 幂等记录并完成未完成的规划提交，不重新让人批准，也不猜测或替换原 isolation。
3. 规划决定已写入但回包丢失时，从该 phase 的权威记录核对原决定，直接返回原结果及 pull 指引。不能因为当前 phase 已前移就把原成功误报成未提交。
4. 意图／Plan 转换已经提交时，按原 requestId/proposalHash 查询持久观察；相同选择和输入返回原结果，不能重建 Work、递增 checkEpoch 或覆盖新阶段。
5. 冲突选择、不同 isolation 或错误归属拒绝；已经 supersede 的批准可作为历史事实展示，但不得再次授权当前内容。未知持久化结果先恢复既有 Journal，仍未知则停止并保留原请求和输入。

并发提交继续依赖现有规划 Store CAS、Run guarded commit 和 reducer 的请求约束。不能只在新门面层读取一次状态后，把旧结果当作提交锁；相关核对接入实际接受边界。文件在观察后变化时，既有后继规划重验阻止未审查内容进入下一阶段。

## Verification Matrix

| 层级         | 证明内容                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实 RED     | 当前版本的非 TTY 公共 CLI 无法提交合法 Host 回传，失败由缺失能力造成                                                                                                   |
| 领域和 CLI   | schema/kind/phase、条件字段、上限和未知字段拒绝；默认 TTY 路径保留                                                                                                     |
| 权威边界     | 错 Run/request/hash、规划与 Provider 漂移、非法 isolation、Work Outcome 自批、冲突选择，不损坏当前请求；共享规划批准允许合法参与 Run 复用，但无参与事实的 Run 不能冒领 |
| 持久化恢复   | intent 已写但批准未写、批准已写未回包、转换已提交未回包；新进程查询及重试无重复副作用                                                                                  |
| 四类决定     | Open／Design 独立请求、意图修订不批准保持等待、风险审批拒绝返回 Plan                                                                                                   |
| 真实宿主与包 | 原生问题真实展示并取得实际用户选择，通过独立安装包提交；多仓 Store/分支/isolation 保持正确                                                                             |

安装包实验使用独立且已正常初始化的测试 Workspace／Store，并通过公开 OpenSpec 命令在专用 registry 登记，不能更改产品仓的全局 Store 登记。Open 准备阶段的补充产品校验曾因真实 Store 指向另一 checkout、隔离 registry 未登记而失败，记录在外部证据目录；不是通过证据，也不扩展本次产品范围去修该登记。

正式报告保存候选 archive 与规范 Git 内容摘要、公共 CLI 原始回执、原生工具问题及实际答复引用、四类决定矩阵和中断注入点。将模拟 Host 自动化与真实 UI 验收分开列出；只用模拟工具不能完成任务 3.2。

## Execution Configuration Proposal

建议本 Change 使用 `autonomous + tdd + thorough`，沿用当前独立 worktree。当前 Agent 制定计划和实施，以真实失败回归先红后绿，实施分段及最终集成由独立 reviewer 复核。此为候选执行配置，随正式 Design 一次确认；之后不再为相同配置反复提问。

## Risks / Trade-offs

- Host 具有真实用户答复的外部信任边界 → 文档和来源记录明确采用 Comet 相同的职责分工，不把 CLI 参数冒充独立的人类身份认证。
- 仅添加 CLI 参数而未装配宿主指引 → 验收覆盖实际 ask continuation、所需材料和真实宿主问答回传，不只检查函数返回值。
- 对不同决定种类硬编码同一表单 → 使用当前请求声明的类型、选项和必需输入，覆盖同一入口已有的四类决定。
- 重试时决定已接受但阶段已变 → 先核对该请求的已接受结果，验证不重复推进、不覆盖历史。
- 验收包与被验证 Git 字节不一致 → 按既有严格包内容 Gate 绑定规范 Git 字节，保存实际安装包身份及原始回执，不放宽摘要校验。

## Migration Plan

本次使用现有 Human Decision 和规划身份边界，不计划新增开发 checkpoint 迁移或兼容层。旧版本仅有终端审批的事实如实说明；现有终端操作继续可用。部署以新的真实包和实际合同测试为准，不对未实现的旧 Run 跨实现采纳作额外承诺。

## Stop Conditions

- 需要以普通 Work Outcome、自报用户点击或伪造认证会话替代真实用户决定；
- 规格、设计或 Provider 合同冲突，或者必须改变已批准范围；
- 回传无法核对当前请求和规划身份，或需要旁路现有隔离、Store、分支与权限校验；
- 无法确认已提交决定的结果，却打算重放阶段转换；
- 只能完成模拟问答而无法执行本次承诺的真实宿主验收。
