# Proposal

## Why

Repoctopus 已经能够把工作流事实导出为 OTLP，但开发者在本机无法即时看到当前 change 的 Agent、阶段、任务、验证和阻塞状态，只能依赖日志或事后查询远端后端。需要先交付一个由同一套 OTLP 数据驱动的桌面观测入口，使本地调试与团队遥测共享事实语义而不相互替代。

## What Changes

- 增加 Windows-first 的 Electron Desktop Dashboard，在开发 Run 开始时自动启动或激活单实例应用，并聚焦对应 Workspace 与 change。
- 在 Electron 主进程中提供仅监听本机的 OTLP/HTTP 接收器，把 Trace、Log 和 Metric 投影为 change、Run、阶段、Agent、任务、验证、阻塞和下一步动作等桌面视图；Renderer 只通过受限 IPC 接收快照与增量，不读取仓库文件或领域 Store。
- 将一次领域事实到 OTLP 的规范化结果作为统一观测 envelope，按独立目的地状态投递到本地 Desktop Dashboard 与团队 OTLP 后端；任一目的地不可用不得阻塞领域提交或另一个目的地。
- 增加本地重放、稳定事件身份、重复投递收敛和数据新鲜度诊断，使 Dashboard 晚启动或重启后可以从持久 outbox 追平，追平后由上报驱动实时更新而非轮询查询。
- 增加关闭偏好：直接退出、最小化到系统托盘或每次询问；偏好保存在用户级配置中，托盘驻留时本地接收器继续工作，完全退出时远端 OTLP 投递仍继续。
- 首个正式支持目标为 Windows 10/11 x64。核心投影与 UI 保持平台中立，但 macOS、Linux、Windows ARM64 的安装包、签名、系统集成和发布验证留给后续 change。
- 本次不部署本地 SigNoZ Docker Compose，不实现对 SigNoZ 查询 API 的依赖，也不以轮询远端后端驱动桌面状态；后续使用已部署的兼容 OTLP 后端验证同一数据契约。
- Comet Dashboard 只作为信息架构和交互参考，不采用其本地文件扫描、SQLite 索引或 Comet 专有状态模型，不直接复制其实现源码。

## Capabilities

### New Capabilities

- `desktop-observability-dashboard`: 定义桌面应用启动、OTLP 接收、change 状态投影、实时 IPC、恢复、托盘生命周期、安全边界和 Windows 首发支持。

### Modified Capabilities

- `development-telemetry`: 增加统一观测 envelope、多目的地独立投递、本地接收器重放与桌面状态所需的可验证低基数/关联维度。

## Impact

- 新增 Electron 桌面应用、Renderer 前端构建、Windows 安装与启动集成，以及相应的平台适配器和端到端测试。
- 调整 `platform/telemetry` 的映射、outbox、目的地游标与 OTLP/HTTP 发送边界；领域事件、Trajectory 和现有 Telemetry Port 保持后端中立。
- 增加 Electron 及桌面构建工具依赖，并把版本、许可证、安装脚本和发布产物纳入现有来源、构建与安全检查。优先选择项目可接受的宽松许可证，不采用 Comet 源码，因此不新增 Comet 派生作品义务。
- 更新遥测、架构、自举和桌面应用文档；SigNoZ 的本地部署文件不在本次范围。
