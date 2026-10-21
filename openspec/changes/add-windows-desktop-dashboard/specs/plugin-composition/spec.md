# Spec Delta

## MODIFIED Requirements

### Requirement: 外部入口作为 Application Plugin 接入

CLI、IDE、API 与 Desktop Host MUST 作为 Application Plugin 通过版本化应用服务调用产品能力；命令能力插件通过 Effect 注册 Handler，协议入口只负责协议解析、结果渲染和进程退出语义，薄 Electron Shell 只能通过私有、有界的进程间契约桥接 Desktop Host 与 Renderer。

#### Scenario: CLI 与 IDE 查询同一 Run

- **WHEN** CLI 与 IDE 使用相同参数查询同一个 Run
- **THEN** 两者调用同一应用服务并获得语义相同的版本化结果

#### Scenario: 命令插件卸载

- **WHEN** 某个命令能力插件从 composition 卸载
- **THEN** Command Router 不再暴露该 Handler，并返回明确的能力不可用诊断

#### Scenario: Desktop Renderer 请求观测快照

- **WHEN** Renderer 通过声明的 IPC 契约请求当前 change 投影
- **THEN** Desktop Host 中的 Desktop Application Plugin 调用版本化应用服务返回快照，经 Electron Main 与 Preload 的声明式契约桥接给 Renderer；Renderer 不直接访问 Cordis Context、文件系统或 Receiver

## ADDED Requirements

### Requirement: 桌面能力使用跨进程 Cordis composition

Repoctopus MUST 在 Runtime 进程通过内置插件贡献桌面 Launcher 与本地遥测目的地，由薄 Electron Shell 启动独立 Node-mode Desktop Host 子进程，并在该 Host 中通过统一 App Boot 启动专用 Cordis composition，组合 OTLP Receiver、Projection Store 和 Desktop Application Plugin；Runtime 与 Desktop Host 不得共享内存容器，Electron Shell 不得成为产品级依赖容器。

#### Scenario: 开发 Run 启动桌面应用

- **WHEN** project composition 开始开发 Run 且本机桌面能力可用
- **THEN** Runtime 中的内置 Contributor 通过稳定应用端口启动或激活 Electron Shell，并把 Desktop Host 发布的本地目的地交给现有 Telemetry Service

#### Scenario: Electron Shell 启动 Desktop Host

- **WHEN** Desktop Application 启动
- **THEN** Electron Main 立即创建受限窗口并启动 Node-mode Desktop Host 子进程，Host 通过 App Boot 激活专用 composition；所需 Service 未就绪前窗口显示明确启动状态，Application Plugin 不发布 ready

#### Scenario: 桌面应用没有安装

- **WHEN** project composition 在没有可用 Desktop Application 的环境启动
- **THEN** Runtime、Run 和远端遥测继续工作，桌面 Contributor 返回明确能力不可用诊断

### Requirement: 桌面插件资源遵循 Cordis 生命周期

Desktop Host 内的 Receiver、Projection、Application Service、进程内订阅和 Timer MUST 由所属 Cordis Fiber 与 Effect 持有；Electron Main 的窗口、托盘、子进程控制器、私有 IPC 和原生监听器 MUST 由显式基础设施 owner 持有并按确定顺序释放。卸载、Host 重启或应用退出时先停止接纳新操作，再有界排空并撤销资源，已持久化 envelope 与 projection journal 保持可恢复。

#### Scenario: Desktop Application Plugin 卸载

- **WHEN** Desktop Application Plugin 所属 Fiber 开始卸载
- **THEN** Host 停止接纳新应用请求并有界排空 Receiver 与 Projection 订阅；Electron Shell 保持可恢复错误界面，并可启动新的 Host 实例

#### Scenario: Receiver Provider 重新加载

- **WHEN** Receiver 的有效本机配置变化并触发插件重新加载
- **THEN** 旧监听器完成撤销并使 discovery 失效后，新 Provider 才发布新的就绪端点

#### Scenario: Renderer 重新加载

- **WHEN** Renderer 窗口重新加载或崩溃恢复
- **THEN** Desktop Host 的 Cordis composition、Receiver 和 Projection 保持有效，新的 Renderer 经 Electron Main 重新取得版本化快照和后续增量
