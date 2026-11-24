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
