# Comet Design Handoff

- Change: improve-desktop-workflow-guidance
- Phase: design
- Mode: compact
- Context hash: a30a8db2f006aebf7de929fc3f61e85c19b9e7a630a7f99eb0b37f9d8c3302d3

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/improve-desktop-workflow-guidance/proposal.md

- Source: openspec/changes/improve-desktop-workflow-guidance/proposal.md
- Lines: 1-22
- SHA256: e853bc9b3d63fb4cd20949b8c2e724f6e216219803530181fcfe920f1757c7b6

```md
## Why

v0.1.4 的桌面端已显示五阶段、Build 子动作、Skill 与证据。对于正在等待 Design 审批的 Change，首屏显示的是状态和内部字段，用户仍要自己找出应审核什么、去哪里处理。执行、返工以及数据断开时，也缺少直接的下一步说明。

## What Changes

- 主视图优先显示当前阶段、发生了什么、是否需要人工处理以及对应的下一步。
- 按当前阶段展开 Build 执行进度和 Skill 摘要，保留可查看的运行、验证、回退和接收器详情。
- 审批提示支持复制给原 Agent 宿主的上下文，由现有人工决定入口读取材料并提交实际用户选择。
- 从同源 OTLP 观测核对阶段、等待、恢复和终态。用实际 Windows 安装包和多仓 Run 证明桌面与 Runtime 一致。

## Capabilities

### New Capabilities

### Modified Capabilities

- `desktop-observability-dashboard`：明确阶段和下一步，减少首屏重复状态，在已知事实范围内正确解释等待、执行、返工、阻塞和数据新鲜度。

## Impact

主要涉及桌面投影、Renderer、安装包验收和桌面使用指南。遥测在既有接收和投递边界使用，团队 SigNoz 的事件筛选、合批和计数以当前契约为准。

```

## openspec/changes/improve-desktop-workflow-guidance/design.md

- Source: openspec/changes/improve-desktop-workflow-guidance/design.md
- Lines: 1-44
- SHA256: 21f2caa7ff1e05a490acd05a3761e40a60a527eb01bda461c2bcabf7f082eee8

```md
## Context

以主线 v0.1.4 的桌面界面与之前确认的体验规划为基线。当前 Renderer 的首屏平铺五阶段、Build 子动作和多组元数据，等待审批时显示审批内部类别。桌面即时接收本地 OTLP。SigNoz 的降噪发生在远端投递边界。

## Goals / Non-Goals

- 开发者在首屏读清当前阶段、是谁在处理，以及自己如何继续。
- 收到等待、恢复、回退、阻塞、终态或不完整数据时，展示与该 Run 一致的可读状态。
- 通过现有宿主完成审批。桌面仅提供真实审批请求的定位指引。

## Decisions

1. 在现有桌面投影上确定当前阶段、等待和终态，再由 Renderer 写成用户文案。阶段转换、Work、Skill 完成和接收器健康分别使用自己的事实。最近一次观测缺失时保留最后已确认状态和时间。
2. 主区依次展示 Change、五阶段、当前工作或下一步。Build 子动作只在需要时展开。左侧按 Workspace 展示 Run，待处理项靠前，保留已选中的 Run。详细身份、证据、历史和四类健康放到详情。
3. 先贯通同一多仓 Run 的 Design 等待审批、现有宿主决定与 Build 开始。复制只提供 Run 和当前审批请求定位，审批材料和状态由原宿主重新读取。
4. 用实际事实核对策略、工作包及归档结果后再决定是否扩展少量有界字段。复用同一 envelope、接收器、投影增量和远端降噪策略。

## 当前状态与事实来源

已完成的五仓验收 Run `change-workspace-verify-autonomous-direct-66c551c981ffb470` 中，`design.await-approval` 在序列 68 被接受，69 报告等待开始，71 接受 `design.approved` 并同时进入 Build，73 才报告等待结束。先根据 71 更新当前阶段并关闭首屏审批提示，73 只补记同一请求的结束历史。迟到的旧 Skill、Work 或 Wait 事实不能让首屏退回 Design。

- 用已接受的生命周期转换和 Run 启动、恢复事实确定当前阶段与 Run 状态。一个 Archive Work 完成后还有可能等待发布确认，直到 Runtime 接受终态才显示归档完成。Work、Skill、Evidence 和历史继续使用原来的细粒度状态。
- 当前审批来源与阶段及当前等待身份绑定。已结束和被替代的请求保留在历史。复制给 Agent 的文字只含稳定定位及读取当前请求的指引。审批仍由宿主现有工具收集，Runtime 校验后推进。复制失败要有可读的反馈和可选择的文本。
- 在已知回退之后，按后续已接受的进展显示「正在执行」「等待」「阻塞」等当前状态。来源、目标、影响范围及次数继续留在详情。数据新鲜度是单独的提示，不能用绿色连接标记表示工作成功。静默等待继续显示最后确认阶段和时间。
- 工作包进度依赖当前被接受的计划和完成事实。计划重做或局部失效时跟随 Runtime 的保留结果。缺少计划计数时只展示当前动作。已批准策略显示其执行模式、TDD 和隔离事实，Skill 的消费证明与 TDD 测试证据各自展示。
- 优先复用 `domains/trajectory/observation.ts` 中已有的阶段、等待和分类字段。若实际安装包轨迹证明信息不足，只在状态变化时补有界的同源观测。Desktop Host 的本地持久化沿现有 journal 与 snapshot，旧 snapshot 缺少的新视图信息按已观察范围呈现。

## 界面布局与交互

沿用浅色 Windows 外观与现有色彩。用紧凑的五阶段轨道表达阶段路径，当前节点以文字和显著样式指出。首屏将「下一步」和当前工作放在同一上下文中。只有在需要人工决定时提供复制和反馈；运行中清楚写明由 Agent 处理。按 Workspace 分组，在列表中写明行内状态，多个同名 Change 用 Run 身份区分，用户选择不被新观测抢占。详情保留阶段尝试、当前工作、Skill、Evidence 与健康，键盘可展开。

## 实现落点

- `domains/trajectory/projection.ts` 提供可靠的当前状态，观察字段不足时在 `domains/trajectory/observation.ts` 核对真实来源后补齐。
- `app/desktop/renderer/src/dashboard.tsx`、`styles.css` 负责状态文案与布局。复用应用的快照、增量和 IPC 边界，复制操作不会调用批准或发布。
- 在现有投影、Renderer 和 Windows 实包测试中加入对应场景。覆盖真实 Design 等待到 Build 的事件先后关系，确保重复投递、重开窗口、部分观测、临时远端失败及历史返工不会改变正确的首屏结论。

## Risks / Trade-offs

等待是 Run 当前状态，连接新鲜度是观测状态。断线可能发生在审批或返工期间，需要同时说明最后确认的阶段和数据范围。收据与测试证明以 Runtime 的已接受事实为准。

## Verification

先用真实 Windows Electron 渲染和多仓 Run 核对审批竖切，保存同一 Run 待审和进入 Build 两张图及轨迹序列。再覆盖 Build、Verify 返工、Archive 终态、重放恢复与键盘和高 DPI 布局。通过回归核对远端降噪时本地仍即时更新。若实际已测状态缺少来源，在证明来源之前界面保持明确的未知状态。

```

## openspec/changes/improve-desktop-workflow-guidance/tasks.md

- Source: openspec/changes/improve-desktop-workflow-guidance/tasks.md
- Lines: 1-14
- SHA256: 7fdce092b31cdf8d5e7d120444d184479ba6f643df4c705661441bfd7dcd5140

```md
## 1. 确认桌面当前状态

- [ ] 1.1 通过真实多仓 Run 收集 Design 待审、通过、Build 启动的本地 OTLP，确认生命周期、审批和工作事实的显示依据。验收覆盖「首屏说明当前工作和开发者的下一步」的审批竖切。 <!-- comet-task:c45a3b79-ef11-4ef0-a8bd-ea57d20b10fc -->
- [ ] 1.2 实现和验证当前与历史状态的投影，覆盖终态、回退后继续、数据缺失、重复投递和冷恢复。根据实测补齐必要的有界字段。 <!-- comet-task:37bf2548-ec4a-4a66-8582-82c4ba1df774 -->

## 2. 改善桌面首屏

- [ ] 2.1 实现紧凑的五阶段、可切换的 Change Run 列表、当前状态和下一步指引。验收覆盖「主视图呈现完整五阶段与 Build 子动作」。 <!-- comet-task:a1321ba7-f983-4890-8112-8961efbeac79 -->
- [ ] 2.2 通过现有宿主完成审批引导，并展示 Build 进度、Skill 摘要、证据、健康与历史详情。验收覆盖复制行为、只读边界、重放与匿名观测。 <!-- comet-task:eadfa99c-3f35-4ff6-a01e-df609ee51694 -->

## 3. 验证 Windows 与文档

- [ ] 3.1 用实际 Windows 安装包跑真实多仓审批、实现、Verify 返工和 Archive，对照 Runtime 及本地观测验证，并核对远端降噪、键盘、高 DPI、窄窗口与托盘恢复。 <!-- comet-task:857ff474-f700-42b0-b8bb-2036ae0f9fce -->
- [ ] 3.2 更新桌面用户指南及证据，归纳可读状态和审批路径。完成构建、相关回归、严格规格校验与完整 Verify。 <!-- comet-task:44e121c3-8a75-4c57-8be7-cc416ed9a5ce -->

```

## openspec/changes/improve-desktop-workflow-guidance/.openspec.yaml

- Source: openspec/changes/improve-desktop-workflow-guidance/.openspec.yaml
- Lines: 1-2
- SHA256: 0b89965c6919ee9f0b3679bc8491b3c9efd623f2ceac7e5bd3929eff87f22215

```md
schema: spec-driven
created: 2026-11-24

```

## openspec/changes/improve-desktop-workflow-guidance/specs/desktop-observability-dashboard/spec.md

- Source: openspec/changes/improve-desktop-workflow-guidance/specs/desktop-observability-dashboard/spec.md
- Lines: 1-56
- SHA256: 4053cba4b7a11755091647b9dc9e365ef645a2ee19f05c6176d22d88071a80c3

```md
## MODIFIED Requirements

### Requirement: 主视图呈现完整五阶段与 Build 子动作

桌面应用 MUST 以 `Open → Design → Build → Verify → Archive` 五阶段作为当前 Change 的主体导航，清楚区分当前阶段和它的已观察状态。阶段详情 MUST 保留进入时间、尝试及可信可用的持续时间。处于 Build 时 MUST 能查看 `Configure → Plan → Plan Evidence → Execute → Check`，以及当前 Work、Task、attempt、Host、Validator、Runtime continuation 和最近活动。其他阶段默认折叠 Build 历史。

#### Scenario: Change 正在 Build Execute

- **WHEN** 投影收到已完成 Open/Design、已完成 Build Configure/Plan/Plan Evidence 和当前 Execute Work 的权威事实
- **THEN** 主视图标识 Build 为当前阶段和 Execute 为当前动作，并能从详情查看当前 Task、Work attempt、Host、Validator 和 Runtime continuation

#### Scenario: Verify 发现问题并返回 Build Plan

- **WHEN** 投影收到 Verify finding、受影响 Plan Evidence 失效和 Runtime 选择返回 Build Plan 的权威事实
- **THEN** 主视图标识当前 Build 返工和回退的来源与去向，保留已观察的 Verify 尝试、有界 finding 类别和仍有效的完成事实

#### Scenario: Build 子动作尚未上报

- **WHEN** 当前 Run 只上报 Build 阶段而没有可信的 Build action
- **THEN** 主视图显示当前处于 Build 且子动作尚无可信观测

## ADDED Requirements

### Requirement: 首屏说明当前工作和开发者的下一步

桌面应用 MUST 使用收到的同一 Run 的阶段、生命周期、等待、恢复和观测新鲜度解释当前状态与下一步。审批、执行、外部等待、阻塞、返工、终态和不完整数据 MUST 有可区分的文案及适用的操作指引。缺少证据的进度、审批主体、发布结果和详情保持未知。

#### Scenario: 通过现有宿主审核设计

- **WHEN** 当前 Run 在 Design 有权威的待处理审批请求
- **THEN** 首屏说明需要审核的内容及批准后的步骤，提供复制给 Agent 的定位信息，保留现有宿主的审批入口与 Runtime 校验

#### Scenario: 同一 Run 批准后进入 Build

- **WHEN** Runtime 接受原请求中的用户决定并上报新的 Build 事实
- **THEN** 界面即时更新当前阶段和工作提示，已结束的审批入口从首屏移除

#### Scenario: 当前 Run 执行中

- **WHEN** 投影收到当前 Work 或已批准的策略和进度事实
- **THEN** 首屏展示已经证实的工作与策略。工作包总数与完成数都有依据时展示数量进度，当前 Skill 摘要可展开查看来源与消费证明

#### Scenario: 归档或恢复仍在等待外部结果

- **WHEN** Work 已完成但 Runtime 正在等待外部确认、核对发布结果、或仍未接受 Run 终态
- **THEN** 界面说明当前等待与后续路径，仅在 Runtime 上报终态后显示 Run 完成

#### Scenario: 观测存在缺口或过期

- **WHEN** 当前 Run 的本地观测无法确认完整性或时效
- **THEN** 界面说明最后确认的阶段和时间，待处理决定引导宿主核对当前请求，历史状态不能冒充当前已确认状态

#### Scenario: 同一 Change 有多条 Run

- **WHEN** 多条活动或历史 Run 使用相同的 Change ID
- **THEN** 用户可区分和切换这些 Run，新观测到达时保留用户的有效选择

```
