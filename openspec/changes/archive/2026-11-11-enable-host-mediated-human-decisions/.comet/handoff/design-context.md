# Comet Design Handoff

- Change: enable-host-mediated-human-decisions
- Phase: design
- Mode: compact
- Context hash: 41650df1a92d7fa6988bb978e4c7deec51aaab0232f3c51e39af30f4c73c4af8

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/enable-host-mediated-human-decisions/proposal.md

- Source: openspec/changes/enable-host-mediated-human-decisions/proposal.md
- Lines: 1-32
- SHA256: 11e3656764d3d2d121000a0aac2008c900ee456eef9fc620657b7b9b735ea03a

```md
# Proposal

## Why

当前 Open、Design 等生命周期人工决定已经生成有效请求，但公开 `run decide` 只接受交互式终端，Host 无法把宿主原生问答中的真实用户选择提交给 Runtime。用户因此被要求离开 Agent 对话手工执行命令；升级版本也不能补齐这条交互链路。

## What Changes

- 提供同一 Run 当前 Human Decision 的只读结构化交互材料，以及绑定该请求的公开 Host-mediated 决定提交入口。
- 采用 Comet 的职责分工：Host 收集真实用户选择，Runtime 验证当前请求、提案身份、规划事实与决定边界并推进；非交互命令本身不构成用户授权。
- 优先使用宿主原生结构化提问工具；工具不可用时在对话中展示明确选项并等待答复。没有可用用户交互上下文时保留交互式终端回退。
- 第一条可交付纵切覆盖 Open 与 Design 两个独立审批，以及 Open 的 isolation 选择；同一 `run decide` 已支持的执行意图修订与 Build Plan 风险审批沿用一致的交互材料和提交路径。
- 保留阶段边界、Provider 严格校验、授权检查及真实选择来源记录；覆盖过期请求、不同提案、冲突决定、重复提交和中断后的结果核对。
- 更新 lifecycle Action 与公开使用指南，区分禁止 Agent 自行批准和允许 Host 传递真实用户决定。增加真实安装包、多仓和宿主交互验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：生命周期人工决定支持宿主交互与正式回传，保持现有阶段转换和终端回退。
- `specification-authority`：Open／Design 的宿主回传绑定当前规划提案，并保留 Provider 重验及独立批准边界。

## Impact

- 影响公共 CLI、Run 的只读交互视图、Human Decision 提交协调、相关类型与审计记录、lifecycle Skill 和使用文档；复用 Cordis Command Router、Specification Planning 与现有 Run 持久化边界。
- 不新增阶段、Work kind、Runtime、守护进程、审批服务器或专用 IDE SDK。Desktop／OTLP 仍是观测来源，不作为审批凭据；项目接入、旧 delivery 审批入口及其他未归档提案不纳入本次改造。
- 参考固定 Comet 0.5.1 的决策点 Skill、公开决定命令与 Runtime Wait 解析方案，适配 Repoctopus 多仓身份与规划权威；不引入 Comet SDK 或新的第三方实现依赖。行为参考继续记录来源与 MIT 许可证边界。
- 后续是否扩展到其他审批入口另行评估；本 Change 的完成不声明所有 IDE 已具有独立认证插件，也不把模拟问答当作真实宿主验收。

```

## openspec/changes/enable-host-mediated-human-decisions/design.md

- Source: openspec/changes/enable-host-mediated-human-decisions/design.md
- Lines: 1-223
- SHA256: f8f5cc190127d8eec8337badb22f94059282bed49b565e70edfcd808fc1df93c

[TRUNCATED]

```md
---
comet_change: enable-host-mediated-human-decisions
role: technical-design
canonical_spec: openspec
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

```

Full source: openspec/changes/enable-host-mediated-human-decisions/design.md

## openspec/changes/enable-host-mediated-human-decisions/tasks.md

- Source: openspec/changes/enable-host-mediated-human-decisions/tasks.md
- Lines: 1-58
- SHA256: 6d3384f88693140ee55f9a4ad84400181e0c27bd1163cb8f67d06684003c2eb1

```md
# Tasks

## 1. Open 宿主审批纵切

- [ ] 1.1 为非 TTY Host 无法合法回传当前 Open 决定建立真实失败回归，同时固定当前请求、提案、四件套和 isolation 的读取合同；保存 RED 命令与诊断。 <!-- comet-task:45cc005b-f601-4196-996a-36d1b4ab5dfd -->
      **Acceptance:** 回归在原实现上因缺少公共宿主回传路径失败，不能用伪造 TTY、内部 Service 调用或 Store 写入冒充复现。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 1.2 实现有界的当前决定材料读取和显式 Host-mediated 提交，复用统一组合及规划决定权威；补齐 CLI／服务回归和公开用法。 <!-- comet-task:eb078f36-db52-45a1-ad98-02f90f0e1016 -->
      **Blocked by:** 1.1
      **Acceptance:** 非交互 Host 提交已取得的匹配用户选择后，Runtime 接受 Open 并按当前 isolation 和规划重验规则创建 Design Work；原终端路径仍通过。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 1.3 将读取、提问、等待、提交和核对步骤接入 ask continuation 与 Host 指引，优先原生提问并支持对话选项回退；增加协议测试和使用说明。 <!-- comet-task:fbc0c4ae-7dfa-4e77-830d-de9eff46e8ac -->
      **Blocked by:** 1.2
      **Acceptance:** 指引包含实际请求允许的选择及必需输入；无用户答复时不调用决定提交，无可用交互上下文时提供终端回退，不要求用户手工复制摘要。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交

## 2. 独立审批与恢复边界

- [ ] 2.1 覆盖 Design、执行意图修订和 Build Plan 风险请求，通过同一公开交互路径处理真实类型及必需字段；更新相应文档并运行参数化回归。 <!-- comet-task:dcf7ce8a-35df-4cb3-b0f9-1e62672a1b5c -->
      **Blocked by:** 1.3
      **Acceptance:** Open 决定不能批准 Design，其他等待不被伪装成规划批准；同一入口所有现有决定种类均有成功或拒绝的明确路径。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 2.2 为错误 Run、requestId、proposalHash、旧阶段、非法选择和规划／Provider 漂移增加先红后绿回归，复用当前规划有效性及隔离校验。 <!-- comet-task:2b099ab6-895c-49ed-a88b-2bc003535bf5 -->
      **Blocked by:** 2.1
      **Acceptance:** 每类非法响应都有可定位诊断，缺失或不兼容 isolation 在写入批准前被拒绝；当前请求及其他有效决定不受损，不产生部分批准。合法参与 Run 保留同语义规划批准复用，无请求参与事实的 Run 不能凭同名 change 冒领批准。
      **Requirements:** change-lifecycle#宿主人工决定恢复保留原请求及已接受结果, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 2.3 验证真实用户交互与普通 Work Outcome 的边界，核对来源和授权依据的记录、缺答复保持等待及终端回退；运行负例并完善信任边界说明。 <!-- comet-task:bb96f143-5cd5-4691-b286-b437f58ff22a -->
      **Blocked by:** 2.1
      **Acceptance:** Work Outcome 或推荐值不能充当 Human Decision；Host 回传不伪装为另一个 IDE 认证会话，文档不把本地 CLI 参数宣称为独立人类点击证明。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 2.4 在提问后、决定已接受但响应返回前分别中断并以新进程核对恢复；覆盖重复和冲突回传，记录原请求及后继身份。 <!-- comet-task:531e8859-c670-472f-8370-f36b2bf790d6 -->
      **Blocked by:** 2.2, 2.3
      **Acceptance:** 原请求或已接受决定可核对；不重复推进 phase/checkEpoch，不重派已接受后继 Work，不覆盖原决定，也不因恢复额外要求批准。
      **Requirements:** change-lifecycle#宿主人工决定恢复保留原请求及已接受结果

## 3. 观测与实际安装包验收

- [ ] 3.1 对齐实际采用的 Comet 固定来源、provenance 和 Human Decision／Wait 观测，运行来源审计、遥测隐私与有界标签测试并更新字段说明。 <!-- comet-task:4c916fb7-f239-4117-ba92-d31b9dbce115 -->
      **Blocked by:** 2.4
      **Acceptance:** 观测只来自已持久化决定，可关联原请求且不上传问答正文或凭据；没有新审批后端、SDK 依赖或用遥测提交决定的入口。
      **Requirements:** specification-authority#规划批准的宿主回传绑定当前提案
- [ ] 3.2 用规范 Git 字节打包并独立安装，在真实多仓目录验证 Open／Design 两次独立审批、isolation、公开 CLI 提交和冷恢复；至少保存一次真实宿主原生问题、用户选择及 Runtime 接受的完整回执。 <!-- comet-task:cb90b94f-8f60-4e40-8e55-c11e34c53123 -->
      **Blocked by:** 3.1
      **Acceptance:** 安装包身份、真实交互来源和请求／提案／阶段前后事实可核对；无终端手工决定即可完成宿主路径；模拟 Host 与真实 UI 证据明确区分，未完成真实交互时不宣称验收通过。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, change-lifecycle#宿主人工决定恢复保留原请求及已接受结果, specification-authority#规划批准的宿主回传绑定当前提案

## 4. 集成验证准备

- [ ] 4.1 完成独立集成审查和相关回归，整理正式验证报告、实际包身份与 RED／GREEN／恢复回执，并固定 Comet 完整 Build／Verify 的精确检查入口。 <!-- comet-task:85e5ae15-673f-49c4-869f-684fe4cd9f36 -->
      **Blocked by:** 3.2
      **Acceptance:** 无未处理阻断发现，源码与验证候选一致；报告不提前宣称后续 Guard、归档、CI、合入或发布已完成，不放宽严格包身份校验。
      **Requirements:** change-lifecycle#生命周期人工决定通过宿主交互闭环提交, change-lifecycle#宿主人工决定恢复保留原请求及已接受结果, specification-authority#规划批准的宿主回传绑定当前提案

## Workflow follow-up

- Open 四类产物完成并通过预检后，取得当前范围的人工批准，进入正式 Design；深化同一 design.md 并确认正式设计及本 Change 的执行配置后才能实施。
- 同一 Comet Run 实际执行 check policy 声明的完整 Build 与 Verify，依据真实收据判断结果。
- 完整 Verify 和独立审查通过后核对归档及交付授权；本次不发布 Release，不收尾或修改其他未归档提案。

```

## openspec/changes/enable-host-mediated-human-decisions/.openspec.yaml

- Source: openspec/changes/enable-host-mediated-human-decisions/.openspec.yaml
- Lines: 1-2
- SHA256: 519b5d2f2c95a5824a38a573c58ef1067b39bf77f183f2c01b55804de4c18bde

```md
schema: spec-driven
created: 2026-11-10

```

## openspec/changes/enable-host-mediated-human-decisions/specs/change-lifecycle/spec.md

- Source: openspec/changes/enable-host-mediated-human-decisions/specs/change-lifecycle/spec.md
- Lines: 1-54
- SHA256: 39386db762e4e6d9c5c3a5627307fe284bb07a2859fddfa16cbe3f8d27a7f51f

```md
## ADDED Requirements

### Requirement: 生命周期人工决定通过宿主交互闭环提交

Repoctopus MUST 为当前生命周期 Human Decision 提供只读交互材料和公开的 Host-mediated 提交路径。Host MUST 优先使用可用的原生结构化提问工具收集真实用户选择；工具不可用时在对话中展示选项并等待答复。Runtime MUST 沿既有请求、提案与权限校验处理该选择并决定后续 Action，不以非交互提交命令本身推断用户授权。

#### Scenario: 宿主具有原生提问工具

- **WHEN** 当前 Run 等待人工决定，且 Host 能在当前会话中使用结构化提问工具
- **THEN** Host 展示当前提案、决定影响和有效选项，等待用户选择后通过公开入口回传；用户无需离开对话手工运行终端命令

#### Scenario: 宿主只有对话交互

- **WHEN** Host 没有原生结构化提问工具，但可以取得当前用户的明确对话答复
- **THEN** Host 在对话中给出明确选项并等待真实答复，再通过同一正式决定路径提交，不把工具缺失解释为批准

#### Scenario: 尚未得到用户选择

- **WHEN** Host 已展示问题但没有有效用户答复或覆盖该提案的明确授权
- **THEN** Run 保持等待，Host 不提交推测的选择，不因默认值、推荐、超时或 Work Outcome 推进阶段

#### Scenario: 没有可用宿主交互上下文

- **WHEN** 当前调用无法收集真实用户选择且存在交互式终端
- **THEN** 系统保留当前请求并提供原有终端评审入口；普通终端调用仍能完成同一决定

#### Scenario: 同一入口的其他生命周期决定

- **WHEN** 当前待处理请求是执行意图修订或 Build Plan 风险审批
- **THEN** Host 读取其真实类型、必需选项和影响，通过相同交互与提交约束处理，不把它伪装成 Open 或 Design 批准

### Requirement: 宿主人工决定恢复保留原请求及已接受结果

Repoctopus MUST 让宿主以当前请求身份和提案身份核对等待状态及已有决定。重复读取或进程恢复 MUST 保留原有效请求；重复回传已经接受的相同决定不得创建第二次阶段转换。过期、冲突或归属不匹配的响应 MUST 保留可定位诊断，不得改变当前决定或授权未审查的内容。

#### Scenario: 展示问题后进程中断

- **WHEN** Host 展示待批准问题后中断，并由新进程恢复同一 Run
- **THEN** 系统返回当前仍有效的请求或其已接受结果，Host 核对后继续，不仅因恢复而创建新审批或重复要求用户批准

#### Scenario: 决定已接受但返回结果丢失

- **WHEN** 决定已经提交成功，但 Host 未收到成功响应
- **THEN** 后续核对可以确定该请求的已接受决定；相同决定的重试不会重复推进，后继 Work、完成事实和 checkEpoch 保持正确

#### Scenario: 相同请求出现冲突决定

- **WHEN** 同一请求已经接受一个决定，随后收到不同选择
- **THEN** 系统报告决定冲突并保留原接受事实，不覆盖历史决定或回退后继阶段

#### Scenario: 请求不属于当前审批边界

- **WHEN** 响应的 Run、请求、提案身份或有效审批边界与 Runtime 当前事实不一致
- **THEN** 系统拒绝该响应并保留当前等待状态或已接受结果，不将旧答复应用到新提案

```

## openspec/changes/enable-host-mediated-human-decisions/specs/specification-authority/spec.md

- Source: openspec/changes/enable-host-mediated-human-decisions/specs/specification-authority/spec.md
- Lines: 1-40
- SHA256: 4e8247cad77d5a7512f0f2f0c009690d87e7ab2df68461ddfab9b7f22032aaea

```md
## ADDED Requirements

### Requirement: 规划批准的宿主回传绑定当前提案

Repoctopus MUST 让宿主读取当前 Open 或 Design 批准请求的完整评审材料，并通过公开入口提交绑定 requestId、proposalHash 和审批阶段的真实用户决定。宿主交互与终端交互 MUST 复用同一规划批准权威；Runtime MUST 保留 Provider 校验、当前规划事实重验、独立阶段批准及 Open 执行隔离意图校验。

#### Scenario: Open 通过宿主批准

- **WHEN** 四类规划工件通过严格校验，用户通过 Host 审查当前 Open 提案并选择合法 isolation
- **THEN** Runtime 验证请求、当前提案及 isolation 后记录 Open 决定，按既有规划重验规则创建 Design Work；Host 不直接指定阶段

#### Scenario: Design 通过宿主批准

- **WHEN** Design Work 已接受，用户通过 Host 审查当前 Design 提案并批准
- **THEN** Runtime 记录独立 Design 决定并沿已批准规划与 Strategy 继续；Open 的答复不能替代本次 Design 审查

#### Scenario: 用户选择修改或拒绝

- **WHEN** 用户通过 Host 对当前规划提案选择要求修改或拒绝
- **THEN** Runtime 沿既有决定语义处理并保留选择依据，不生成批准事实，也不进入依赖批准的后继 Work

#### Scenario: 展示后规划发生变化

- **WHEN** Host 已展示规划提案，但回传前当前请求身份、规划语义或 Provider/schema 事实发生有效性变化
- **THEN** Runtime 拒绝把该答复用于未审查的新内容，并返回可定位的重新观察或评审指引

#### Scenario: Open 隔离选择缺失或不兼容

- **WHEN** Host 提交 Open 批准但缺少当前请求必需的 isolation，或选择与真实 checkout facts 不兼容
- **THEN** Runtime 在写入批准和 intent 之前拒绝响应，保留同一可纠正请求，不猜测隔离方式或部分批准

#### Scenario: Work Outcome 包含自行批准声明

- **WHEN** Agent 仅在 Work Outcome、摘要或结果中声明用户已批准，而没有独立决定入口接受的匹配响应
- **THEN** Runtime 不把该声明作为规划批准，不绕过 Open 或 Design 人工边界

#### Scenario: 交互记录与遥测保持边界

- **WHEN** 系统记录宿主交互及接受的规划决定
- **THEN** 决定来源与请求、提案身份可供核对，Trajectory 和 OTLP 继续由已持久化事实生成；遥测事件或 Dashboard 投影不能充当用户授权，指标不包含问答正文或凭据

```
