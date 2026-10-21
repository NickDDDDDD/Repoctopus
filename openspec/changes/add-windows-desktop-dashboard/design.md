# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。当前 Runtime 在领域事实持久化后，由多个 OpenTelemetry exporter 分别构造并发送 Trace、Log 和 Metric；Evidence 已有持久 outbox 与 cursor，但生命周期、平台事件和 Delivery 映射仍分散在不同 exporter 中。仓库没有桌面应用、前端构建链或多目的地投递抽象。

桌面端需要以标准 OTLP 上报作为唯一状态输入，不能扫描 OpenSpec、Git 或领域 Store，也不能查询 SigNoZ 后轮询刷新。团队远端后端与本地 Dashboard 必须消费同一事实映射，但桌面应用离线、关闭或卸载不能阻塞工作流和远端遥测。

Comet 固定源码基线提供 change explorer、阶段进度、任务、验证、阻塞和下一步动作的信息架构参考。Repoctopus 不采用 Comet 的本地文件 Collector、Classic/Native 状态分支、SQLite read-through cache 或实现源码，因此不存在派生其 UI 代码的许可边界。

当前固定 DSH commit `687f282e8625c6b8d11ff58211a90524be2e4317` 已包含完整 Desktop 实现。它使用薄 Electron Shell 启动 `ELECTRON_RUN_AS_NODE=1` 的独立 Host 子进程，Host 再运行共享 Cordis profile；Shell 管理窗口、托盘、单实例、安全边界与 Host 恢复。此前上游采用审计只覆盖 Skill、Webhook 和 Cordis，遗漏了 `apps/desktop` 与 `apps/desktop-host`，本 change 补齐该审计缺口，并以固定 MIT 源码为进程模型参考。

## Goals / Non-Goals

**Goals:**

- 在 Windows 10/11 x64 上交付可安装、自动激活、单实例和可选托盘驻留的 Electron Dashboard。
- 先生成一份稳定观测 envelope，再向本地桌面与远端 OTLP 后端独立投递。
- 由本机 OTLP/HTTP 接收驱动 change 状态投影，并通过类型化 IPC 实时更新窗口。
- 在重复投递、应用晚启动、窗口重载、桌面退出和远端故障下保持可诊断、可恢复。
- 保持 Engine、Workflow、领域 Store 与 UI/后端产品无关，并延续现有隐私允许列表。

**Non-Goals:**

- 不部署本地 SigNoZ、OpenTelemetry Collector 或 Docker Compose。
- 不实现 SigNoZ 查询、告警和团队 Dashboard；真实远端 SigNoZ 接入留给后续验证。
- 不为 macOS、Linux 或 Windows ARM64 生成正式支持安装包或完成系统集成验收。
- 不把桌面应用变成 Workflow 编辑器、任务控制台、规格编辑器或通用日志浏览器。
- 不复制 Comet UI 源码，也不把 Comet 专有状态模型引入领域层。

## Decisions

### 1. 桌面观测采用薄 Electron Shell 与独立 Cordis Desktop Host

物理上存在 Runtime、Electron Shell、Desktop Host 与 Renderer 四个执行环境；产品级 composition 只存在于 Runtime 与 Desktop Host。Electron Main 是基础设施 Shell，不运行 Cordis 产品 composition：

```text
Runtime App Boot / project composition
  ├─ Telemetry Service + Provider
  ├─ Desktop Launcher Service/Contributor
  └─ Desktop OTLP Destination Contributor
       └─ durable envelope store + per-destination cursor
              ├─ remote OTLP destination
              └─ desktop OTLP destination
                       │ loopback OTLP/HTTP
Thin Electron Main
  ├─ window / tray / single-instance / shell settings
  ├─ Desktop Host start / retry / stop controller
  └─ bounded typed IPC bridge
                       │ private Node IPC
Node-mode Desktop Host child
  └─ App Boot / desktop Cordis composition
       ├─ Receiver Service Provider + authentication
       ├─ Projection Store Service Provider
       └─ Desktop Application Plugin
                       │ Main + Preload bridge
Sandboxed Renderer
  └─ read-only UI client; no Cordis or Node access
```

Runtime 侧的内置插件只通过稳定应用 Service/Contributor 发现、启动和投递，不直接构造 Electron 对象。Electron Main 立即创建安全窗口并显示本地启动状态，然后以 Electron executable 和 `ELECTRON_RUN_AS_NODE=1` 启动 Desktop Host 子进程。Host 使用专用 App Boot；Receiver、Projection 与 Application Plugin 依赖由 Inject 管理，监听器、订阅和 Timer 由 Effect 撤销。它与 Runtime 使用相同 Cordis 架构，但不共享 Context、Fiber 或内存 Service。

Electron Main 显式拥有窗口、托盘、原生监听器、Shell 设置与子进程控制器。启动、重试和停止必须串行化；Host 通过私有 Node IPC 发送经过校验的 ready、fatal、snapshot 和 delta 消息。退出先请求优雅关闭并设置 deadline，超时后逐级终止，防止 Shell 退出后遗留孤儿 Host。Host 崩溃不关闭窗口，Shell 显示可诊断错误并允许重试。

Renderer 不是 Cordis 插件：把插件系统或 Node 暴露给不可信展示上下文会破坏最小权限。它是 Desktop Application Plugin 的版本化 IPC 客户端，只消费 snapshot/delta 和少量有界动作；Main 和 Preload 都校验 channel、sender、origin、schema version 与 payload 上限。

Engine 和 Workflow 只产生现有领域事实。Runtime 的 Desktop Contributor 与 Electron 的 Desktop Application Plugin 身份分别进入各自 composition 快照；桌面进程启停不改写既有 Run 的领域结果，目的地可用性通过遥测健康状态表达。

备选方案一是在 Electron Main 内运行 Cordis、Receiver 与投影；这会把可热重载或可失败的产品插件与不可替换的原生 Shell 放进同一故障域，不利于恢复和安全审计，因此在审计 DSH 后拒绝。备选方案二是把 Electron 加载进每个 CLI Context，会把窗口生命周期和大体积依赖耦合到短命令。备选方案三是在 CLI 内嵌 HTTP UI 或让 Engine 直接发布 UI 状态。后两者分别破坏进程边界或后端中立，也拒绝。

### 2. 规范观测 envelope 是不可变投递单元

把分散 exporter 中的领域映射收敛为纯映射层。每个已持久化事件生成版本化 `ObservationEnvelope`，至少包含：

- `schemaVersion`、稳定 `envelopeId`、来源 `event.id` 和观测时间；
- 信号类型与固定事件名称；
- 已脱敏、允许列表内的 resource、scope 和 record 属性；
- 可验证的 Workspace、change、Run、父子执行、阶段、任务、验证和阻塞关联；
- 用于完整性校验的规范摘要。

Envelope Store 只保存不可变 envelope。目的地 Adapter 将同一 envelope 编码成标准 OTLP/HTTP 请求，可以拥有不同端点、Header、超时和批量策略，但不得再次读取领域 Store 或改变领域属性。这样保证“同一套 OTLP 数据”指相同身份和语义，而不是要求不同 HTTP 请求具有逐字节相同的压缩、批次或传输头。

备选方案是让每个 exporter 分别从领域对象构造 SDK Span/Log/Metric。这是当前分散实现，容易在新增字段或修复映射时产生本地与远端差异，因此替换。

### 3. 使用共享 envelope store 与独立目的地 cursor

Envelope 先以原子写入进入 Workspace 的本地遥测 outbox，再由目的地 worker 独立读取和确认。目的地状态包含稳定 `destinationId`、最后确认 envelope、连续序列、最近尝试、结果分类和积压摘要。

- 远端目的地沿用标准 `OTEL_EXPORTER_OTLP_*` 配置。
- 桌面目的地使用稳定的用户本机身份，不把临时端口或会话 token 作为目的地身份。
- 远端成功、本地失败时只推进远端 cursor；反向亦然。
- 失败诊断有界且不保存响应正文。
- Outbox 使用按时间、数量和字节上限的保留策略；达到上限时记录明确 gap，不静默声称桌面状态完整。
- 禁用或卸载桌面目的地时停止其积压增长，并保留有界诊断；远端目的地不重置。

第一版复用仓库现有原子文件 Store、Journal 和 cursor 模式，不引入共享数据库。未来可以把 Store Provider 替换为 SQLite 或远端队列，但不得改变 per-destination 确认语义。

备选方案一是把一份数据同时直接 `Promise.all` 发往两个端点；进程退出后无法确定各目的地是否确认。备选方案二是让 Electron 接收后再转发 SigNoZ；Electron 关闭会切断团队遥测并使桌面成为单点，因此拒绝。

### 4. Desktop Host 子进程实现受保护的本地 OTLP 接收器

接收器仅绑定 `127.0.0.1`，由操作系统分配可用端口。每次 Desktop Host 就绪生成高熵会话凭据，把版本、Shell/Host 进程身份、端点、凭据引用和就绪时间原子写入用户级 discovery 文件。文件权限按 Windows 当前用户收紧，Runtime launcher 验证文件所有者、协议版本、进程存活和 freshness 后才登记本地目的地。

请求使用标准 OTLP/HTTP 路径和 content type，并通过标准 Header 携带会话凭据。接收器限制方法、content type、压缩、单请求体积、并发数和解析时间；拒绝未授权、畸形或超限请求，不把请求正文写入错误日志。响应只返回协议所需结果和低敏诊断。

Host 停止、重启或桌面退出后 discovery 文件被删除或失效。Runtime 无法连接时保留本地 cursor 并继续远端发送，不把桌面启动失败升级成领域失败。

备选方案是固定端口且无凭据。任何本机进程都能伪造 change 状态或读取错误细节，因此拒绝。Windows named pipe 虽然权限更自然，但不是标准 OTLP/HTTP 端点，首版不采用。

### 5. OTLP 解码后进入确定性 change 投影

Receiver 先验证 OTLP 和 Repoctopus schema version，再把 Span、Log 和 Metric 解码为只读 `ObservationRecord`。Projection Reducer 按 `event.id`、envelope 序列和关联身份确定性地产生：

- Workspace/change 列表和 active/completed/failed/stale 状态；
- 当前 Run、workflow、阶段、执行主体和父子执行；
- 任务总数、完成数、活动任务和最近转换；
- Evidence 验证、Gate 结果与 Artifact 元数据引用；
- blocker/Human Decision 类别与已上报的下一步动作；
- 最近接收、最近观测、追平、gap 和新鲜度状态。

Projection 不读取仓库、OpenSpec、Git 或领域 Store，不从文本猜测 Agent、完成度和下一步动作。Metric 仅用于聚合摘要；具有稳定身份的 UI 状态主要来自 Span 与 Log，避免从低基数 Metric 反推实体。

Desktop Host 把已接受记录写入追加式本地 journal，并周期生成原子 snapshot。启动时加载 snapshot 后重放 journal，重复 `event.id` 收敛为 no-op。该 journal 只保存经过遥测允许列表的数据，不复制 Artifact 正文。使用现有文件持久化模式可以避免 Windows 原生 SQLite addon 的构建和 ABI 风险；如果性能证据表明不足，数据库替换走后续 change。

### 6. Renderer 通过类型化 IPC 接收 snapshot 与有序 delta

Electron 启用 `contextIsolation`、renderer sandbox，并关闭 `nodeIntegration`。Preload 只公开版本化的窄接口：

- 获取当前 projection snapshot；
- 订阅指定 snapshot version 之后的有序 delta；
- 选择 Workspace/change；
- 读取和更新关闭偏好；
- 请求显示窗口或完全退出等有界桌面动作。

Renderer 不直接监听端口、不读取 discovery/journal、不访问文件系统或执行任意 IPC channel。订阅建立时，Desktop Host 生成一致 snapshot 与版本，经 Main/Preload 转交后只发送更高序列 delta；发现序列缺口时 Renderer 丢弃局部状态并经相同桥接请求新 snapshot，不轮询。Main 不解释或二次投影业务状态，只校验、关联和转发有界消息。

浏览器 SSE/WebSocket 需要额外 HTTP surface、Origin 防护和端口，不为同进程桌面窗口提供价值，因此选择 IPC。

### 7. 单实例启动与关闭偏好由桌面生命周期适配器管理

开发 Run 在创建首个遥测 envelope 前调用 Desktop Launcher：

1. 查找并验证 discovery；
2. 已运行时通过第二实例参数/受保护唤醒通道传入 Workspace、change 和 Run 上下文；
3. 未运行时启动已安装应用并有界等待 ready；
4. 成功后唤醒本地目的地 worker 重放，失败则记录 warning 并继续 Run。

Electron Main 使用单实例锁，后续启动只把上下文交给主实例；Main 再把已校验的启动上下文发给当前 Desktop Host。新 change 加入列表但不强制抢走用户正在查看的 change；首次启动或当前没有选择时自动显示启动来源。

关闭偏好存放在 Electron 用户级配置目录，不进入 Workspace：

- `quit`：关闭最后窗口后停止 Desktop Host 与接收器；
- `tray`：隐藏窗口，Receiver 和投影继续运行；
- `ask`：每次提供本次选择并允许记住。

未保存设置默认进入 `ask`，避免第一次关闭就留下用户不知情的后台进程。托盘的“完全退出”绕过偏好并关闭应用；Windows 会话退出和更新安装也使用真正退出路径。

### 8. Windows 是唯一首发验收平台，代码边界保留可移植性

使用 Electron、TypeScript、React 和 Vite 构建桌面应用，使用 `electron-builder` 生成 Windows x64 安装产物。选择 `electron-builder` 是因为固定 DSH Desktop 已验证同类 thin-shell/Host 资源打包路径，便于采用经过验证的 Windows 基线；依赖仍使用精确版本并纳入许可证、来源、构建脚本和漏洞检查。UI 不采用 Comet 的 Ant Design/Tailwind 组合；首版建立自己的轻量语义组件和设计 token，避免为了少量状态页面引入完整 UI 框架。

操作系统差异被限制在 `DesktopLifecycleAdapter`、`TrayAdapter`、`NotificationAdapter`、`AutoLaunchAdapter` 和 `UpdaterAdapter`。首个 change 只实现和验证 Windows adapter；其他平台 adapter 显式返回 unsupported，而不是依赖 Electron 可以启动就宣称支持。

Renderer 首版包含 change 列表、概览、阶段/任务、验证与阻塞、最近事件和连接状态。所有可达状态包括启动中、无数据、追平、实时、过期、gap、Receiver 错误、Run 完成和 Run 失败；视觉实现与可访问性在业务实现阶段按 UI 设计检查验证。

### 9. DSH 采用遵循选择性源码采用矩阵

对固定 DSH commit 的采用分三类，避免把“参考桌面端”误解为复制整个产品：

- **源码级采用并按 Repoctopus 修改**：Host process 生命周期、backend controller 串行 start/retry/stop、Node-mode 环境、single-instance、Tray、IPC sender/origin 校验和 Shell settings ownership。实现时在 `third_party/dsh-adoption.json` 登记上游文件、固定 commit、本地目标和变更摘要。
- **行为级适配**：窗口先于 Host ready 显示、Host 崩溃恢复、有界优雅退出、Renderer sandbox 和 `electron-builder` Windows 资源打包。Repoctopus 按自己的契约重写，不保留 DSH 的 Web app 假设。
- **明确排除**：DSH Web Host HTTP/WebSocket 代理、完整 DSH profile/plugin/agent/session/workspace 模型、账户/浏览器能力、自动更新系统、打包的 Python/Node/pnpm 运行时和平台安装器链。

Repoctopus 的 Renderer 是本地 OTLP 投影客户端，不需要 DSH 的共享 Web App 和鉴权反向代理；Desktop Host 也只包含桌面观测 composition，不加载 DSH 产品插件。这样采用的是被验证的进程与生命周期模式，而不是引入另一个产品内核。

### 10. SigNoZ 与本地 Docker Compose 不进入首个验证门槛

自动化测试使用协议 fixture 和进程外 mock OTLP receiver，验证三类信号、身份一致、目的地隔离、重放和隐私。桌面 E2E 在 Windows 启动打包候选，向真实本机 receiver 发送 OTLP，验证 projection、IPC、单实例、关闭和托盘生命周期。

本 change 不创建本地 SigNoZ Compose，也不让真实公司后端成为 CI 或合入前提。后续在可访问环境中把远端 endpoint 指向已部署 SigNoZ，比较固定 event identity、属性与查询结果；发现后端兼容问题时修改 OTLP Adapter，而不是给桌面建立专用旁路。

### 11. 规格、设计与来源冲突是停止条件

以下情况停止受影响实现并请求决定：

- 标准 OTLP 与已批准的 envelope 身份、脱敏或重放语义不能同时满足；
- Electron、打包工具或新增依赖的许可证、安装脚本或来源不符合项目治理；
- Comet 参考行为与本 change 的 Delta Specs 冲突；
- Windows 安全边界要求 Renderer 获得未声明的 Node/文件系统权限；
- 现有领域事实不足以表达已承诺的阶段、任务、阻塞或下一步状态，且补充事实会改变其他规格；
- 实现需要把 Electron 变成远端遥测唯一网关，或依赖 SigNoZ 查询才能刷新本地状态。

普通实现决定、约束和经批准偏差继续记录在本 `design.md`；测试事实进入 Evidence 和正式验证报告，不新增 implementation notes 或 ADR。

## Risks / Trade-offs

- [Electron 安装体积和常驻内存高于原生轻客户端] → 这是换取成熟跨平台窗口、托盘和前端生态的成本；首版限制窗口数量、后台任务和 UI 依赖，并测量 idle/active 资源。
- [额外 Desktop Host 进程增加启动、IPC 与退出复杂度] → 采用串行 controller、结构化消息、严格 schema、ready deadline、stderr 上限、优雅停止与强制终止升级；以 Shell 存活和 Host 可重启换取故障隔离。
- [DSH 源码采用可能随上游更新漂移] → 所有源码级采用固定到已批准 commit、逐文件登记 provenance 与本地差异；每日上游检查只提示新候选，不自动覆盖本地实现。
- [本地目的地关闭导致 outbox 增长] → 使用独立保留上限、积压健康状态和 gap 诊断；直接退出不影响远端 cursor。
- [文件 journal 随事件增长降低启动速度] → 原子 snapshot、增量 journal 和阈值压缩；用高事件量基准决定是否需要后续数据库 change。
- [回环端口仍可被同用户恶意进程访问] → 随机端口、会话凭据、受限 discovery 权限、请求上限和无正文诊断；不宣称抵御已控制同一用户账户的攻击者。
- [OTLP Trace、Log 和 Metric 乱序到达] → 投影按稳定事件身份和观测序列收敛，缺口显示 stale/gap，不以接收时间伪造严格业务顺序。
- [自动弹出窗口打断开发者] → 单实例、新 change 不抢占已有选择；关闭偏好与后续通知偏好保持用户级可控。
- [Windows-only 首发掩盖平台耦合] → 纯投影、OTLP 和 IPC 契约运行平台中立测试，所有 OS 调用只能通过 adapter；不对未验收平台做支持承诺。
- [真实 SigNoZ 尚未纳入本 change 验证] → 以标准 OTLP mock 完成协议契约，把远端 SigNoZ 接入作为显式已知限制和后续验证项。

## Migration Plan

1. 保存当前遥测测试与映射快照，增加 envelope schema 和兼容读取器，不改变领域事件。
2. 将现有 exporter 逐类迁移到纯映射与共享 Envelope Store，用 golden fixture 证明迁移前后允许列表语义保持一致。
3. 增加多目的地 cursor；先只注册现有远端目的地，验证失败和恢复行为后再启用桌面目的地。
4. 实现 headless Desktop Host 的本机 receiver、认证、投影、journal、App Boot 和协议测试。
5. 基于固定 DSH 模式实现 thin Electron Main、Host controller、私有 Node IPC、preload/renderer、单实例、Launcher、关闭偏好与托盘，并完成 Windows 打包 E2E。
6. 用 Repoctopus 自身的开发 Run 启动桌面应用，发送真实 OTLP，验证本地实时状态；远端使用 mock receiver 验证相同 envelope。
7. 运行完整验证、生成 Evidence 和正式验证报告，明确未连接真实 SigNoZ 与未支持平台。

回滚通过普通 revert MR 移除 Desktop Launcher 和本地目的地。Envelope schema 与多目的地 Store 保持向后兼容读取；回滚版本忽略未知桌面目的地但不得删除远端 cursor 或领域事实。桌面用户数据可以由卸载流程选择保留或删除，默认不在代码回滚时自动删除。
