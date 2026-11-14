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
