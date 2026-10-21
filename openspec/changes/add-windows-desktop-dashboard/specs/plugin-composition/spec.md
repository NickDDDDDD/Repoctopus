# Spec Delta

## MODIFIED Requirements

### Requirement: 外部入口作为 Application Plugin 接入

CLI、IDE、API 与 Desktop 主进程 MUST 作为 Application Plugin 通过版本化应用服务调用产品能力；命令能力插件通过 Effect 注册 Handler，协议入口只负责协议解析、结果渲染和进程退出语义，Desktop Renderer 只能通过版本化 IPC 使用主进程公开的有界能力。

#### Scenario: CLI 与 IDE 查询同一 Run

- **WHEN** CLI 与 IDE 使用相同参数查询同一个 Run
- **THEN** 两者调用同一应用服务并获得语义相同的版本化结果

#### Scenario: 命令插件卸载

- **WHEN** 某个命令能力插件从 composition 卸载
- **THEN** Command Router 不再暴露该 Handler，并返回明确的能力不可用诊断

#### Scenario: Desktop Renderer 请求观测快照

- **WHEN** Renderer 通过声明的 IPC 契约请求当前 change 投影
- **THEN** Desktop Application Plugin 调用同一主进程应用服务返回版本化快照，Renderer 不直接访问 Cordis Context、文件系统或 Receiver

## ADDED Requirements

### Requirement: 桌面能力使用跨进程 Cordis composition

Repoctopus MUST 在 Runtime 进程通过内置插件贡献桌面 Launcher 与本地遥测目的地，并在 Electron 主进程通过统一 App Boot 启动专用 Cordis composition，组合 OTLP Receiver、Projection Store、生命周期适配器和 Desktop Application Plugin；两个进程不得共享内存容器或建立 Cordis 之外的产品级依赖容器。

#### Scenario: 开发 Run 启动桌面应用

- **WHEN** project composition 开始开发 Run 且本机桌面能力可用
- **THEN** Runtime 中的内置 Contributor 通过稳定应用端口启动或激活 Electron 主进程，并把本地目的地交给现有 Telemetry Service

#### Scenario: Electron 主进程启动

- **WHEN** Desktop Application 启动
- **THEN** 它通过 App Boot 激活专用 composition，所需 Service 未就绪前 Application Plugin 保持未激活且不创建可用窗口

#### Scenario: 桌面应用没有安装

- **WHEN** project composition 在没有可用 Desktop Application 的环境启动
- **THEN** Runtime、Run 和远端遥测继续工作，桌面 Contributor 返回明确能力不可用诊断

### Requirement: 桌面插件资源遵循 Cordis 生命周期

Desktop Receiver、Projection、IPC、窗口、托盘、进程监听器和 Timer MUST 由所属 Cordis Fiber 与 Effect 持有；卸载或应用退出时先停止接纳新操作，再有界排空并撤销资源，已持久化 envelope 与 projection journal 保持可恢复。

#### Scenario: Desktop Application Plugin 卸载

- **WHEN** Desktop Application Plugin 所属 Fiber 开始卸载
- **THEN** 新窗口与 IPC 请求停止接纳，既有请求有界排空，窗口、托盘和监听器按依赖顺序撤销

#### Scenario: Receiver Provider 重新加载

- **WHEN** Receiver 的有效本机配置变化并触发插件重新加载
- **THEN** 旧监听器完成撤销并使 discovery 失效后，新 Provider 才发布新的就绪端点

#### Scenario: Renderer 重新加载

- **WHEN** Renderer 窗口重新加载或崩溃恢复
- **THEN** Electron 主进程的 Cordis composition、Receiver 和 Projection 保持有效，新的 Renderer 重新取得版本化快照和后续增量
