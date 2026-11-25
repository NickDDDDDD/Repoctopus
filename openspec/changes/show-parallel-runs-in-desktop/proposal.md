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
