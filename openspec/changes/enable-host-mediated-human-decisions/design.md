# Design

## Context

动机和范围见 proposal.md。当前 `run decide` 在 CLI 边界强制检查 stdin/stdout 的 TTY 状态；`nextActions` 只给终端命令。领域层已经具有版本化规划请求、`requestId`、`proposalHash`、阶段区分和可信 Actor 参数，`run.change.decide` 已通过统一 Cordis Command Router 进入 WorkflowRuns。缺口是 Host 获取当前决定材料并提交真实选择的公开链路。

本文件是 Open 基线中的高层设计。正式 Design 阶段继续深化同一文件，确定 CLI 参数、数据合同和提交协调，不另建规划权威。两个 delta spec 是行为要求，tasks.md 是任务完成权威。

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

公共 CLI 显式区分终端评审与 Host 回传；原终端用法继续收集用户输入，Host 路径处理已取得的真实决定。两者共享决定解析和 `run.change.decide` 权威入口，不让 Agent 导入 Service、编辑 Store 或把审批塞入 Work Outcome。公开参数及来源记录的最小合同在正式 Design 中确定；不能以一个不绑定当前请求的自动批准开关替代。

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
