# Comet Design Handoff

- Change: show-parallel-runs-in-desktop
- Phase: design
- Mode: compact
- Context hash: 66b3dd95a5fed9c8d8802e7f2a9b081a1754f9b80aec287143fd0471ffdea379

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/show-parallel-runs-in-desktop/proposal.md

- Source: openspec/changes/show-parallel-runs-in-desktop/proposal.md
- Lines: 1-22
- SHA256: 69fd344f896d8ce6347a5f5b10cfa5cea719e0c9b562e0fb48dd2881e6164081

```md
## Why

桌面端已经能说明单条 Run 的当前阶段和下一步，但切换式布局无法同时监看多条运行。多 Agent 策略目前有完成回执，桌面端缺少能证明子 Agent 正在工作及最近进展的观测。开发者需要可以扫一眼的工作台，每条 Run 的人工待办、执行状态和诊断都能在原位置找到。

## What Changes

- 按已确认的原型，将首屏改为自适应的 Run 宫格。每个格子显示 Workspace、Change、五阶段、当前工作、执行配置及可信的工作包进度。历史 Run 仍可打开。
- 明确区分待用户决定、Agent 执行、外部等待、阻塞和数据暂未确认。同一条 Run 的审批结束时撤下提示。继续通过当前 Agent 会话审阅和批准。
- 点击 Run 名称或展开按钮可铺满窗口，Esc 或返回入口恢复宫格位置及焦点。保留详细阶段、Skill、验证、恢复和健康诊断。
- 在多 Agent Run 中用已观测的子 Agent 事实展示人数、任务、仓库与最近进展。首屏用像素头像加可键盘访问的摘要，放大后直接展开并按宽度换行。
- 通过同一条 OTLP 观测流补齐受管子 Agent 的生命周期事实。仅在真实事实可用时报告活跃、阶段与进展，保持团队遥测的降噪边界。

## Capabilities

### Modified Capabilities

- `desktop-observability-dashboard`：并行 Run 的工作台、全窗口详情、独立的人机状态和子 Agent 展示。
- `development-telemetry`：在受管执行下观测子 Agent 的开始、可证实的进展与结束。保持现有运行控制与远端指标口径。

## Impact

涉及 Windows Electron renderer、现有桌面 OTLP 接收与投影、受管 Host 的子 Agent 观测，以及桌面指南和遥测字段说明。继续使用现有审批入口和 Runtime 权威。验收覆盖多 Workspace、同名 Change 的多 Run、不同执行策略、分阶段等待与恢复，以及子 Agent 的缺失事实、重复投递和重放。

```

## openspec/changes/show-parallel-runs-in-desktop/design.md

- Source: openspec/changes/show-parallel-runs-in-desktop/design.md
- Lines: 1-47
- SHA256: 7854e81836391f5c4491fe69b00a7a9cd69403f1265930018989300402ea5691

```md
## Context

已合入的桌面版本通过 OTLP 查看单条 Run，已经具备生命周期、Build 配置、任务进度、审批、Skill 和诊断投影。当前的 `delegation.completed` 来自父 Host 提交的完成回执，只证明受管子执行的结果，无法还原正在工作的成员。此次保留现有执行权威、接收器和安装入口，按已确认原型实现并行工作台。

## Goals / Non-Goals

- 在同一界面扫读当前并行 Run、五阶段和人工待办，进入一条 Run 查看当前工作、子 Agent 与原有诊断。
- 接入真实的受管子 Agent 活动，并在冷恢复、延迟和重复投递时维持可信状态。
- 继续使用 Agent 会话内的审批入口和现有 Runtime Gate。范围集中于本地桌面观测。

## Decisions

### Run 宫格和全窗口详情

Renderer 用 Workspace、Change、Run 的组合作为稳定键。在投影快照中查找当前展开的 Run，实时更新其内容。新的自动启动上下文可以把对应卡片标为最近启动，保留用户已经展开的 Run。尚未收到投影时保留现有等待提示。

活动卡按 1、2、3、4 列密度排列，再按可用宽度降列。完整历史继续可访问。每张卡展示身份、五阶段缩略、当前工作、获批的策略和可信进度。相同 Change 在不同 Run 中显示可辨认的 Run 身份。仅在 Build 工作包总量及完成数都可确认时展示工作包进度。

点击卡片标题或展开按钮打开同窗口的详情。上方保留五阶段，当前 Work 和进度共同跨整行。紧接着显示子 Agent，活动列表下是可折叠的「运行与诊断详情」，保留 Work、Skill、阶段尝试、Build 子动作、审批、证据、恢复与健康。列表会随可用宽度换行。返回或 Escape 恢复原滚动位置和触发按钮焦点，卡片已转为历史时定位到对应历史入口。鼠标、触摸和键盘可打开卡片里的子 Agent 摘要。

复用现有 `workflowGuidance` 的审批有效性检查。只有存在当前 Runtime 决定时使用琥珀色与「需要你决定」信号，颜色同时配文字和状态符号。活跃、外部等待、受阻与观测待确认分别呈现。决定失效时自动撤下复制入口。当用户留在同一页面时，状态更新保留焦点，辅助技术播报有意义的交接变化。

### 受管子 Agent 活动

在现有公开 `run work-*` Host 协议内新增有界的活动报告。CLI 与 Build Execute 的宿主指引在真实派发、取得可证明的进展、收到返回时报告边界事实。报告包含协议版本、Run、父 invocation、提交者和 packet 绑定、子执行 ID、角色及有界里程碑。任务 ID 与仓库 ID 可以省略，确认时必须属于当前 package。禁止接受名称、进度文案、命令输出、路径、Prompt 或凭据作为观测输入。报告由拥有父 invocation 的协调 Host 提交。

Runtime 复用现有调用方身份与 frozen Work packet 模型，在同一个 Run Store 锁内核对当前 Work、attempt、check epoch、Host、packet、已批准的执行策略及 attested capability。取当前 package 的冻结任务和仓库范围核对报告，不从临时目录扫描或依据调用方的任意标签补全数据。里程碑来自宿主真实可观测的动作。只按已收到的事实展示「执行中」「已进入测试」「已返回结果」等阶段，成功与否由有效的完成回执确认。已有 Host 仅上报完成回执时沿用原协议。

使用既有 Trajectory 事务与 outbox。子执行的身份由父 invocation 和子执行 ID 共同限定。观察类别采用固定枚举，开始、允许的阶段里程碑和返回按子执行分别去重，一次不可逆结束之后不会被迟到数据重新打开。报告的缺失或发送失败不阻塞宿主执行和正常提交 Outcome。没有心跳请求。新增只为桌面服务的活动事实在远端选择器处排除，包括显式 Signal 端点和远端诊断模式，现有完成回执与 SigNoz 四项指标按原策略交付。

### 投影、中断与重放

Receiver 继续按事件身份与 Run 序列处理投递。投影以当前 Work 尝试与父 invocation 作为有效边界。父 Work 退出、被替换或进入未知恢复时，原活动从实时人数中撤下，已观测历史可在诊断中查看。gap、catching-up、过期和旧缓存只展示最后可信的记录，缺少事实时文案说明尚未确认。继续复用现有推送式 IPC。呈现层用本地时间计算已经收到的观测是否过期，按最近到期时间刷新视图，无需向 Receiver、Runtime 或 SigNoz 发起轮询。

缺失活动字段的旧本地快照按未知状态读取。活动状态是观测数据，独立于 package completion、Skill 消费和用户审批，不触发重算 Plan 或重新冻结策略。

## Risks / Trade-offs

- 仅靠完成回执进行事后推断，无法满足实时目标。独立读取 Git、工作目录或宿主进程则会绕过已有权威与隐私边界。选用同一 OTLP 流里的 Host 边界事实。
- 当某宿主无法观测具体任务、仓库或中间进展时，仅展示它能证明的字段。避免把当前 package 的全部仓库直接归给每个子 Agent。
- 目前默认窗口较窄，首屏的列数会随有效空间调整。验收时以实际 Electron 默认窗口、缩窄到最小尺寸、高 DPI 和宽窗口分别检查，保留键盘路径。

## Verification

- 测试活动报告身份、冻结范围、重复提交、结束后的迟到提交、正常 Outcome 与活动提交竞争，以及非法报告不改变 Work 与生命周期。
- 通过标准 OTLP 验证新增字段的接受、本地恢复时的去重和远端隔离。用历史完成回执、换 attempt、外部阻塞及观测过期验证活跃人数。
- 在 Windows Electron 验证多个 Workspace、同名 Change、Open/Design 独立待办、审批后更新、历史入口和放大/返回交互。用实际可派发子 Agent 的宿主验证至少一次运行时上报至 Electron 的完整链路。使用 3 位、5 位与窄窗口的可重复数据验证视图容量和换行。

```

## openspec/changes/show-parallel-runs-in-desktop/tasks.md

- Source: openspec/changes/show-parallel-runs-in-desktop/tasks.md
- Lines: 1-16
- SHA256: fabe9db3236359a4e97b5f87d809321bfe602ee623aefe90632d783f9bd9785f

```md
## 1. Run 工作台

- [ ] 1.1 用响应式 Run 宫格替换侧栏选择布局，支持同名 Run 区分、历史入口及并行状态更新。 <!-- comet-task:7b4d9738-1d49-4247-9811-8815b2ca3331 -->
- [ ] 1.2 实现全窗口 Run 详情、五阶段和整行当前 Work，保留诊断入口、返回滚动位置和键盘焦点。 <!-- comet-task:46160bb0-1784-49dd-86c3-e56ba8bc908d -->
- [ ] 1.3 接入不同交互状态的视觉层级，验证真实审批提示出现、清除和宿主交接。 <!-- comet-task:8a64f922-4107-4cc4-862f-448cad8070cd -->

## 2. 子 Agent 观测

- [ ] 2.1 从真实受管 Host 记录有界的子 Agent 活动，核对父 Work 和授权范围，保留现有委派回执及远端指标边界。 <!-- comet-task:da7bd392-4d8f-41dd-90e9-a62c803344e3 -->
- [ ] 2.2 通过现有本地 OTLP 链路投影子 Agent 活动，覆盖重复、冷恢复、未知、父 Work 换代和终态清理。 <!-- comet-task:36ec88b7-8765-49e5-8d23-1e90fa2fefa8 -->
- [ ] 2.3 在卡片与展开视图连接真实子 Agent 数据，覆盖键盘与指针访问及 3 位、5 位和窄窗口布局。 <!-- comet-task:686d92ca-1953-4e77-9954-268dda47b8d6 -->

## 3. 验收与指南

- [ ] 3.1 在 Windows Electron 实跑并行多仓 Run，覆盖自主执行、多 Agent、人工待办、恢复及诊断，保留实际截图和运行证据。 <!-- comet-task:20f8bbd1-5dc2-4b6b-9759-85bdff14cdba -->
- [ ] 3.2 更新桌面指南和遥测字段说明，通过项目构建、相关回归、OpenSpec 严格校验与完整 Verify。 <!-- comet-task:3c87bf43-145a-4fa0-93a5-4b0475efc6fb -->

```

## openspec/changes/show-parallel-runs-in-desktop/.openspec.yaml

- Source: openspec/changes/show-parallel-runs-in-desktop/.openspec.yaml
- Lines: 1-2
- SHA256: 3c3c72cd1a100807c59ef8347538654b4d2d22269f59561c985b01cb44c39491

```md
schema: spec-driven
created: 2026-11-25

```

## openspec/changes/show-parallel-runs-in-desktop/specs/desktop-observability-dashboard/spec.md

- Source: openspec/changes/show-parallel-runs-in-desktop/specs/desktop-observability-dashboard/spec.md
- Lines: 1-51
- SHA256: 6a12df6caf248ad71b325238385766905e366caafbeb8c49ead64b53a055e41e

```md
## ADDED Requirements

### Requirement: 工作台同时展示多条 Run

桌面应用 MUST 用自适应宫格同时展示收到的活动 Run，并以 Workspace、Change、Run 三者区分身份。每张卡 MUST 展示当前阶段、当前工作、已知的执行配置和可信的工作包进度。界面 MUST 保留历史 Run 的入口和现有五阶段及诊断详情。

#### Scenario: 多个 Workspace 的 Run 同时可见

- **WHEN** Receiver 收到多个 Workspace 或同一 Change 的多个 Run
- **THEN** 工作台为每个活动 Run 提供独立的卡片，按窗口宽度减少列数，并能区分同名 Change 的不同 Run

#### Scenario: 放大和返回

- **WHEN** 用户激活卡片名称或展开按钮
- **THEN** 同一窗口展示该 Run 的五阶段、整行当前工作、子 Agent 列表和可展开的运行与诊断详情
- **AND** 用户通过返回入口或 Escape 回到原宫格位置与有效的键盘焦点

#### Scenario: 状态更新时保留查看上下文

- **WHEN** IPC 推送同一 Run 的新状态或另一条 Run 的活动
- **THEN** 用户正在查看的 Run 随观测更新且身份保持不变，其他卡片的更新不会抢走查看和键盘焦点

### Requirement: 卡片通过视觉层级提示人机交接

桌面应用 MUST 结合颜色、文字与形状区分当前需要人工决定、Agent 执行、等待外部结果、受阻和状态未确认。只在 Runtime 投影存在当前有效决定时提供对应宿主交接指引。

#### Scenario: 并行 Run 各自等待

- **WHEN** 一条 Run 等待有效的人工决定，而另一条 Run 正在执行或等待外部结果
- **THEN** 工作台突出前者并显示其对应审阅内容和宿主交接方式，后者仍展示自己的状态
- **AND** 决定解决、失效或无法确认时撤下原决定提示，按当前观测解释状态

### Requirement: 多 Agent Run 展示可信的子 Agent 活动

桌面应用 MUST 使用同一 Run 的受管委派观测展示子 Agent 与当前 Work 的关系。已知人数、任务、仓库、状态和进展 MUST 对应真实事实。数据缺失或过期时 MUST 表示未知或最后观测状态。

#### Scenario: 多位子 Agent 同时执行

- **WHEN** 当前 Work 的受管委派观测确认有多位活跃子 Agent
- **THEN** Run 卡片显示人数与可交互的子 Agent 摘要，鼠标、触摸和键盘均可查看每位的任务、仓库和已知进展
- **AND** 放大后直接展示各位子 Agent，按窗口宽度自动换行

#### Scenario: 委派已结束或父工作被替换

- **WHEN** 子 Agent 的结果已确认、父工作结束或替换，或者观测连续性无法确认
- **THEN** 桌面更新状态和即时人数，保留可证实的历史，且不把历史委派显示为当前执行

#### Scenario: 未报告活动或使用自主执行

- **WHEN** Runtime 只确认了多 Agent 策略，尚无当前委派事实，或者当前策略为自主执行
- **THEN** 界面按实际情况显示未知状态或主 Agent 工作，不推算子 Agent 数量、任务、仓库或进度

```

## openspec/changes/show-parallel-runs-in-desktop/specs/development-telemetry/spec.md

- Source: openspec/changes/show-parallel-runs-in-desktop/specs/development-telemetry/spec.md
- Lines: 1-20
- SHA256: d648e848c2a8f0547d865f70e17fabee6ecbe8455ab2d0365797512d40e695be

```md
## ADDED Requirements

### Requirement: 当前受管子 Agent 的活动可以通过本地 OTLP 观测

Repoctopus MUST 将实际发生的受管子 Agent 开始、可证实的进展和结束关联到 Workspace、Change、Run、当前父 Work 尝试与子执行身份。由 Runtime 核验的任务和仓库标识才允许用于显示。进展只包含可证明且有界的里程碑或数量。观测不得授予执行权限或更改工作流权威状态，不得改变现有 SigNoz 指标口径或包含自由文本、路径、凭据与命令输出。

#### Scenario: 宿主派发当前 Work 的子 Agent

- **WHEN** 有权处理当前 Work 的 Host 提交已经发生的子 Agent 活动
- **THEN** Runtime 核验父 invocation、策略、子执行身份及工作范围，将可信的状态变化交付给本地 OTLP Receiver

#### Scenario: 活动重复或对应的 Work 已被替换

- **WHEN** 相同事实重试、迟到或来自过期的执行
- **THEN** 重复投递收敛到同一活动记录，过期执行不能更改当前活跃视图或影响原 Run 的权威进度

#### Scenario: 宿主没有实时活动事实

- **WHEN** 现有 Host 只提交合法的完成回执
- **THEN** 正常接受原回执，保留既有执行结果，且不补造实时开始或中间进展

```
