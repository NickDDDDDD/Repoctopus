# Proposal

## Why

Repoctopus Runtime 已经以 `Open → Design → Build → Verify → Archive` 管理 change，并把 Work、Build 子动作、Skill 交付与消费、验证、等待和恢复等事实导出为 OTLP。但是开发者在本机仍无法即时看到这些状态，只能依赖日志或事后查询团队后端。需要交付一个由同一套 OTLP 数据驱动的桌面观测入口，让开发者看清当前 change 正在做什么、为什么停住，以及工作流本身是否健康。

已有 Dashboard 实验分支早于当前 Runtime 协议，包含过时的生命周期和任务语义。本 change 从最新 `main` 重新实施；旧分支只作为逐项核验的实现候选库，不继承其完成状态，不整体合并，也不读取旧协议数据。

## What Changes

- 增加 Windows-first 的 Electron Desktop Dashboard，在开发 Run 开始时自动启动或激活单实例应用，并聚焦对应 Workspace、change 与 Run。
- 主视图以五阶段为骨架，Build 阶段展开 `Configure → Plan → Plan Evidence → Execute → Check`；当前执行显示 Work、Task、attempt、Host、Validator、Runtime continuation 与最近活动。
- 按 action/augmentation 角色展示当前 Work 的 Skill，并区分 resolved、delivered、consumed 与尚未上报；consumed 只表示 Host 声明且 Runtime 已校验的消费证明。
- 分别呈现流转健康、执行健康、质量健康和遥测健康，以可解释事实和诊断取代单一健康分数。
- 通过现有 Cordis Plugin Composition 接入桌面能力：Runtime composition 提供桌面目的地与 Launcher Contributor；薄 Electron 主进程只管理原生窗口、托盘、单实例和 Host 生命周期；独立 Node-mode Desktop Host 子进程通过专用 App Boot composition 组合 Receiver、Projection Store 和 Desktop Application Plugin；Renderer 不建立第二套容器。
- 在 Desktop Host 中提供仅监听本机的 OTLP/HTTP 接收器，把 Trace、Log 和 Metric 投影为桌面视图。Electron 主进程只桥接有界的类型化 IPC，Renderer 不读取仓库文件或领域 Store。
- 将一次领域事实到 OTLP 的规范化结果作为统一观测 envelope，按独立目的地状态投递到本地 Dashboard 与团队 OTLP 后端；任一目的地不可用不得阻塞领域提交或另一个目的地。
- 增加本地重放、稳定事件身份、重复投递收敛和数据新鲜度诊断，使 Dashboard 晚启动或重启后可以从持久 outbox 追平，追平后由上报驱动实时更新而非轮询查询。
- 增加关闭偏好：直接退出、最小化到系统托盘或每次询问。托盘驻留时本地接收器继续工作，完全退出时远端 OTLP 投递仍继续。
- 首个正式支持目标为 Windows 10/11 x64。核心投影与 UI 保持平台中立，但 macOS、Linux、Windows ARM64 的安装包、签名、系统集成和发布验证留给后续 change。
- 本次不部署本地 SigNoZ Docker Compose，不依赖 SigNoZ 查询 API，也不以轮询远端后端驱动桌面状态；后续使用已部署的兼容 OTLP 后端验证同一数据契约。
- Comet Dashboard 只作为信息架构和交互参考，不采用其本地文件扫描、SQLite 索引或 Comet 专有状态模型，不直接复制其实现源码。
- DSH Desktop 作为固定 MIT 上游的桌面进程、安全和生命周期参考：选择性采用其薄 Electron Shell、Node-mode Host 子进程、有界启动/停止、单实例、托盘和 IPC sender 校验模式，不采用其 Web Host 代理、完整运行时打包、账户或更新系统。
- 不迁移旧 Dashboard 本地数据或旧投影 schema；预发布阶段以当前权威遥测事实重新生成投影，避免兼容代码固化已经废弃的语义。

## Capabilities

### New Capabilities

- `desktop-observability-dashboard`: 定义桌面应用启动、OTLP 接收、五阶段与 Build 子动作投影、Skill 消费状态、健康诊断、实时 IPC、恢复、托盘生命周期、安全边界和 Windows 首发支持。

### Modified Capabilities

- `development-telemetry`: 增加统一观测 envelope、多目的地独立投递、本地接收器重放与桌面消费所需的可信关联；五阶段、Build 动作、Skill、Validator、等待和恢复继续由主规格定义。
- `plugin-composition`: 明确桌面能力的跨进程 Cordis composition、Application Plugin、生命周期和 Renderer 权限边界。

## Impact

- 新增 Electron 桌面应用、Renderer 前端构建、Windows 安装与启动集成，以及相应的平台适配器和端到端测试。
- 调整 `platform/telemetry` 的映射、outbox、目的地游标与 OTLP/HTTP 发送边界；领域事件、Trajectory 和现有 Telemetry Port 保持后端中立。
- 扩展 builtin catalog 与 Desktop Host App Boot composition；Electron 主进程保持基础设施外壳，不增加第二套产品级依赖容器或让 Electron 类型进入 Engine。
- 增加 Electron、`electron-builder` 及桌面构建工具依赖，并把版本、许可证、安装脚本和发布产物纳入现有来源、构建与安全检查。对 DSH 的源码级采用记录固定 commit、源文件和本地修改；不采用 Comet 源码，因此不新增 Comet 派生作品义务。
- 旧 Dashboard 分支中的代码只有通过当前 Work Package、测试和规格审查后才可选择性移植；旧任务勾选、旧 Run 状态和旧投影数据不计入本 change 的完成度。
- 更新遥测、架构、自举和桌面应用文档；SigNoZ 的本地部署文件不在本次范围。
