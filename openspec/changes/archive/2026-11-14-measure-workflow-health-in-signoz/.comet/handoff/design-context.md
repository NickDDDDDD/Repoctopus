# Comet Design Handoff

- Change: measure-workflow-health-in-signoz
- Phase: design
- Mode: compact
- Context hash: 3f58a1b8aa8c1f01f8e5be74b2186581476331e6ba87bc08317af4f0db487dbf

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/measure-workflow-health-in-signoz/proposal.md

- Source: openspec/changes/measure-workflow-health-in-signoz/proposal.md
- Lines: 1-25
- SHA256: 3d7f2faee23c57a3de58e7b3dc5200f3788b56f5f5ff3509549638c89968e64e

```md
# 工作流健康指标与 SigNoz 看板

## Why

团队 SigNoz 接收到大量工作流诊断事件，但现有看板不能可靠回答运行了多少 Change、使用哪些 Build 配置、多少 Run 未结束及原因，以及完成一个 Run 平均要返工几次。第一阶段用 Runtime 已接受的工作流事实建立可核对的团队统计，并降低默认远端上报量。

## What Changes

- 在 SigNoz 展示 Run 总数与已批准 Build 配置分布、Run 终态失败率、未到终态的数量和占比，以及每个完成 Run 的平均跨阶段回退次数。
- 未到终态可按当前阶段、状态、原因及停留时长下钻。回退可按目标阶段及具体路径拆分。
- 远端默认上报工作流统计所需事实和必要诊断，按大小及时间边界合批。细粒度诊断按需开启，OTLP 信号分别确认和恢复。本地桌面端继续即时消费同源 OTLP 事实。
- 提供可导入看板、字段及统计口径说明。在本地 Docker Desktop SigNoz 用真实多仓 Run 对账并测量上报前后差异，使用本地 MCP 验证看板导入和查询。
- 本轮范围限工作流使用及健康统计。Skill、Rules、采纳率和效率指标留待后续。

## Capabilities

### New Capabilities

### Modified Capabilities

- `development-telemetry` — 工作流健康指标、默认远端上报、投递恢复和 SigNoz 看板。

## Impact

涉及 Runtime 观测投影、OTLP 导出和重放、本地桌面 OTLP 回归、生成的遥测参考以及 SigNoz 看板。验收使用独立的本地 SigNoz 实例及多仓 Workspace。

```

## openspec/changes/measure-workflow-health-in-signoz/design.md

- Source: openspec/changes/measure-workflow-health-in-signoz/design.md
- Lines: 1-24
- SHA256: 448a770eb4b6b39ef9ce721fef183dca6af907ccc8201727842ea8be7b352965

```md
# 工作流遥测与 SigNoz 验收设计

## Context

Runtime 已持久化 Run 轨迹、Build 配置审批及生命周期转换。当前 OTLP 编码为每份 envelope 同时生成 Log、Span 和 Metric，多个信号又共用确认位置。已部署的本地 SigNoz 和 MCP 可验证真实入库和看板读写。

## Goals / Non-Goals

- 以权威 Run 事实驱动四项团队统计，标明窗口、去重粒度和未知值。
- 让远端默认只投递看板事实与必要诊断，测量请求和记录量变化，保持桌面当前 Change 的即时状态。
- 第一阶段聚焦工作流指标。保留现有其他遥测契约和 Collector endpoint 配置，字段继续使用公开规范名。

## Decisions

1. 将 Run 启动、当前已批准策略、生命周期转换、当前等待或阻塞及终态投影到共享观测。一份事实使用同一个稳定身份，Run 明细通过 Log 的允许列表字段关联，Metric 只用有界枚举。Design 阶段将核对需要补充的字段和事件来源。
2. 按目标阶段和来源阶段统计真实回退。当前有 Build → Open、Build → Design、Verify → Design、Verify → Build、Archive → Design、Archive → Verify 六条路径。以实际接受的转换为准。
3. 在已有投递边界应用远端信号选择、合批和独立确认。本地保持当前 OTLP 编码及低延迟。对短生命周期命令、进程恢复、部分拒收和确认未知定义验证场景。看板通过事件身份处理重放。
4. 交付可导入看板。Run 统计在所选截止时刻重建状态，终态和回退用相应结算窗口。验收包含报告窗口外开始而在窗口内结束的 Run，以及 Run 完成前窗口外已发生的回退。

## Risks / Trade-offs

- 合批降低请求数，默认信号筛选才降低记录数。验证报告分别列出三类量及测试条件。
- 部分历史记录可能缺少配置、原因或前置阶段。面板明确显示未知或覆盖不足。
- OTLP 接收确认与后端可查询有时间差。使用真实 Collector、SigNoz 和本地 MCP 对账，在有界等待内核对入库结果。

```

## openspec/changes/measure-workflow-health-in-signoz/tasks.md

- Source: openspec/changes/measure-workflow-health-in-signoz/tasks.md
- Lines: 1-18
- SHA256: 0fbea0491273a2709ee0cf3e141855dd4f1fdf3a9c9758afb67f336dc3e740ec

```md
# 工作流健康指标实施任务

## 1. Runtime 统计事实

- [ ] 1.1 核对 Run 启动、已批准 Build 策略和终态的权威来源，补齐规范观测及稳定身份。验收：换进程恢复、重复批准和导出重放后，同一 Run 只计一次。 <!-- comet-task:d0efea8d-630c-45a4-b0aa-63d25a30a407 -->
- [ ] 1.2 投影当前阶段、状态、等待或阻塞原因与阶段进入时间。验收：等待审批、阻塞、恢复和未知原因都能从 OTLP 还原。 <!-- comet-task:4dc1ce65-14c5-4eae-9404-19e89337f48c -->
- [ ] 1.3 从状态机投影所有跨阶段回退及原目标阶段。验收：覆盖现有六条路径、连续回退、同阶段重试和零回退，重放无重复计数。 <!-- comet-task:0181fa75-2c75-4038-a8c9-32b001fc0628 -->

## 2. 远端降噪与投递

- [ ] 2.1 定义默认远端事实及按需诊断，按有限大小和时间合批。验收：短生命周期进程或恢复后仍能投递关键事实，桌面实时视图保留。 <!-- comet-task:8808e0ea-dedb-4546-99e6-8e9c7e732554 -->
- [ ] 2.2 按目的地与信号跟踪投递进度，处理旧积压、部分拒收与明确失败。验收：Log 成功、Metric 失败后不会重发已确认的 Log；重复送达对看板计数无影响。 <!-- comet-task:e36f0f3b-2c64-42cc-8f57-42cfd4e6ec6d -->

## 3. SigNoz 看板与验收

- [ ] 3.1 交付可导入看板及字段、查询、窗口和下钻说明。验收：四项指标可重复查询，跨窗口和空分母口径正确。 <!-- comet-task:0072b5f3-bf8d-443d-bc37-43f60b4b3fe8 -->
- [ ] 3.2 用真实多仓 Run 与本地 SigNoz MCP 对账。验收：覆盖完成、终态失败、等待、阻塞和不同回退路径，统计值与 Runtime 记录一致。 <!-- comet-task:34c2a89a-0620-495d-be5f-8a4b82afc4a2 -->
- [ ] 3.3 用同一多仓场景比较降噪前后的 HTTP 请求数、入库记录数和重复记录数。验收：记录测量范围、数据、失败恢复和桌面回归结果。 <!-- comet-task:7d553ec3-4faf-47f9-b1af-a89a7400d217 -->

```

## openspec/changes/measure-workflow-health-in-signoz/.openspec.yaml

- Source: openspec/changes/measure-workflow-health-in-signoz/.openspec.yaml
- Lines: 1-2
- SHA256: 2e91af4681be83038a92e715cfb64d8067b4c8399c2b25074da27a778869f3aa

```md
schema: spec-driven
created: 2026-11-14

```

## openspec/changes/measure-workflow-health-in-signoz/specs/development-telemetry/spec.md

- Source: openspec/changes/measure-workflow-health-in-signoz/specs/development-telemetry/spec.md
- Lines: 1-97
- SHA256: 42dce3eafaf3dd6c6a34ede0d07d5289d4877ee9f15c6613196668d2af784a15

[TRUNCATED]

```md
# 工作流健康观测规格变更

## MODIFIED Requirements

### Requirement: 本地 Dashboard 与远端后端必须消费相同 OTLP 协议

Repoctopus MUST 从同一份已持久化领域事实生成规范观测 envelope。本地桌面端通过 OTLP 即时显示 Change、Work、Skill、等待和恢复。远端可按信号选择和合批发送 envelope。两处收到同一事实时，事件身份、关联字段和含义 MUST 一致。

#### Scenario: 同一事件由不同 OTLP 目的地消费

- **WHEN** 一个已持久化的阶段转换同时上报本地和远端
- **THEN** 两端收到相同的事件及 Run 身份和阶段变化
- **AND** 桌面投递无需等待远端合批或查询远端后端

#### Scenario: 本地 Dashboard 未运行

- **WHEN** 工作流执行期间桌面 Receiver 不可用
- **THEN** 远端上报和工作流继续执行，桌面按既有有界恢复规则处理

### Requirement: 遥测目的地独立确认和恢复

Telemetry Provider MUST 按目的地和 OTLP 信号独立记录投递进度。远端默认 MUST 保留统计所需事实及必要诊断，按有界批次发送。团队可显式启用细粒度诊断。导出失败 MUST 保留可重试的投递进度，工作流结果保持有效。

#### Scenario: 本地成功而远端失败

- **WHEN** 桌面接收器确认 envelope 但远端 OTLP 后端超时
- **THEN** 本地确认进度推进，远端待确认的信号独立重试，桌面不重复制造逻辑状态

#### Scenario: 远端成功而本地失败

- **WHEN** 远端 OTLP 后端确认 envelope 但桌面接收器未运行
- **THEN** 远端确认进度推进，本地确认进度保持并在接收器恢复后重放

#### Scenario: 移除桌面目的地

- **WHEN** 用户禁用桌面应用或卸载本地接收器
- **THEN** 停止该目的地积压增长，远端确认进度保持有效

#### Scenario: 单个信号明确投递失败

- **WHEN** 同批 Log 已确认成功且 Metric 投递失败
- **THEN** 恢复时仅重试仍待确认的信号，已确认的 Log 不因 Metric 失败而重发

#### Scenario: 重放或确认结果未知

- **WHEN** Runtime 恢复后重发具有相同身份的工作流事实
- **THEN** 团队统计按照稳定身份去重，重复送达不会增加计数
- **AND** OTLP 部分拒收和结果未知均保留可诊断状态

#### Scenario: 暂停或移除一个目的地

- **WHEN** 团队暂停或移除桌面或远端目的地
- **THEN** 该目的地按相应保留规则处理，另一目的地的确认进度不受影响

### Requirement: 工作流健康和效率度量必须可复算

Repoctopus MUST 从持久化 Run 启动、已批准 Build 配置、当前生命周期、已接受的阶段转换和终态导出可关联的事实。看板 MUST 使用唯一 Run 和转换身份，并提供运行量及配置分布、终态失败率、未到终态占比和完成 Run 平均回退次数。已有权威周期继续可供同口径的效率基线查询。

#### Scenario: 按配置查看运行量

- **WHEN** 团队查看统计期内启动的 Change Run
- **THEN** 每个唯一 Run 计一次，并按该 Run 截止时有效的已批准执行方式、测试方式和隔离方式归类
- **AND** 尚未批准配置的 Run 单列，重复审批、恢复和重试不增加 Run 数

#### Scenario: 工作流执行失败

- **WHEN** 团队查看某统计期的 Run 终态
- **THEN** 分子为同期进入失败终态的唯一 Run 数，分母为同期进入完成或失败终态的唯一 Run 数

#### Scenario: 定位未到终态的 Run

- **WHEN** 统计期内启动的 Run 在统计截止时尚未完成或失败
- **THEN** 该 Run 进入未到终态分子，总量使用同期启动的唯一 Run
- **AND** 可查看最后确认的阶段、状态、原因与停留时长，缺失原因显示未知

#### Scenario: 分析平均回退次数

- **WHEN** 团队查看统计期内进入完成终态的 Run
- **THEN** 按每个 Run 完整生命周期统计实际接受的跨阶段回退，使用同一完成 Run 集合计算总平均及按目标、具体路径的分项平均
- **AND** 零回退 Run 纳入分母，同阶段重试不计入，窗口前发生的回退仍归属该完成 Run

```

Full source: openspec/changes/measure-workflow-health-in-signoz/specs/development-telemetry/spec.md
