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

Envelope 先以原子写入进入 Workspace 的本地遥测 outbox，再由目的地 worker 独立读取和确认。目的地状态包含稳定 `destinationId`、独立确认集合、启停状态、最近投递健康和有界 gap 诊断；积压摘要由当前保留集与该目的地确认集合计算，不重复持久化。

- 远端目的地沿用标准 `OTEL_EXPORTER_OTLP_*` 配置。
- 桌面目的地使用稳定的用户本机身份，不把临时端口或会话 token 作为目的地身份。
- 远端成功、本地失败时只推进远端 cursor；反向亦然。
- 失败诊断有界且不保存响应正文。
- Outbox 使用按时间、数量和字节上限的保留策略；达到上限时记录明确 gap，不静默声称桌面状态完整。
- 禁用或卸载桌面目的地时停止其积压增长，并保留有界诊断；远端目的地不重置。

第一版复用仓库现有原子文件 Store、Journal 和 cursor 模式，不引入共享数据库。未来可以把 Store Provider 替换为 SQLite 或远端队列，但不得改变 per-destination 确认语义。

首个基础切片把身份和内容完整性分开：`envelopeId` 只对 schema version 与规范化来源身份（domain、event type、event id、可选 source sequence）计算 SHA-256，因此同一领域事实的身份不随传输目的地变化；`digest` 则覆盖除自身以外的完整规范 envelope，用于发现持久内容被修改。映射器显式重建 source 和三类 signal，不透传额外字段；属性必须同时通过调用方白名单与全局敏感 key/value、绝对路径、换行和长度边界。危险字段即使误入白名单也会使映射失败，危险值则不会进入 envelope。

文件 Store 以 `envelopeId` 为不可变键，用 exclusive 原子发布保证重复保存幂等、同身份不同内容冲突；读取时重新计算身份和摘要。由于多个领域来源不存在一条天然共享连续序列，Cursor 不伪造全局 offset，而是为每个稳定 `destinationId` 保存已确认的 `envelopeId → digest` 集合。确认、失败和进程中断只原子更新该目的地文件；未成功提交的确认在重启后仍进入 replay。因此传输契约是 at-least-once，不是 exactly-once。

Cursor schema v2 增加 `enabled`、`paused`、`removed` 三态、投递健康、有界 gap 历史和累计丢弃计数，并兼容读取 v1 确认集合。暂停只停止投递并保留积压；移除先为尚未确认的当前保留集记录 `destination-removed` gap，再停止该目的地积压增长。目的地从 removed 重新启用时以当时仍保留的 envelope 建立新基线，不追溯移除期间的数据，也不修改其他目的地 Cursor。

默认保留策略为 10,000 个 envelope、64 MiB、7 天和 32 条 gap 历史，可通过 Telemetry Provider 配置覆盖。Store 按观测时间应用数量、字节和时间上限；删除 envelope 前，先为所有未确认该 envelope 的非 removed 目的地原子写入稳定 gap 并压缩其确认集合。若 gap 写入中断，envelope 保持可重试；稳定 gap identity 防止重启后重复累计。内存保留索引只缓存不可变元数据，每次维护仍用磁盘文件名集合检测外部进程漂移，因此优化不会把内存状态变成事实来源。

业务提交 `b7b9845` 完成该边界。小容量故障测试覆盖三态转换、目的地隔离、数量/字节/时间超限、gap 历史上限、gap 提交中断恢复和 v1 Cursor 迁移；完整 `npm run verify` 通过 109 个测试文件、469 项测试并保留 1 项既有跳过，完整测试阶段耗时 103.23 秒。

遥测开发文档把操作步骤与数据契约分开：`docs/telemetry.md` 只说明如何配置、降级、恢复和执行验证，`docs/telemetry-reference.md` 集中记录身份、Cursor、保留、关联与隐私语义。仅远端不是另一套产品模式或私有开关；在新 Workspace 中，如果 Dashboard Receiver 尚未激活，Runtime 只建立 `remote-otlp` Cursor。Dashboard 首次激活后建立 `desktop-local` Cursor；关闭 Receiver 时远端继续确认，本地保留积压，下一次 `run start` 重新激活并先重放本地数据。

业务提交 `5d2532b` 增加 `npm run test:telemetry-docs`，用真实 Observation Provider、Desktop Destination 和 OTLP HTTP Receiver 执行仅远端、双目的地、桌面离线和恢复四个场景。测试同时校验三类 OTLP 路径、SigNoZ Header、本地会话认证、相同 envelope identity、远端 Cursor 不变、文档链接、命令、稳定目的地 ID 和默认保留预算；旧文档中未被实现读取的 `REPOCTOPUS_ENVIRONMENT` 已移除。完整 `npm run verify` 通过 110 个测试文件、471 项测试并保留 1 项既有跳过，完整测试阶段耗时 105.48 秒。

备选方案一是把一份数据同时直接 `Promise.all` 发往两个端点；进程退出后无法确定各目的地是否确认。备选方案二是让 Electron 接收后再转发 SigNoZ；Electron 关闭会切断团队遥测并使桌面成为单点，因此拒绝。

### 4. Desktop Host 子进程实现受保护的本地 OTLP 接收器

接收器仅绑定 `127.0.0.1`，由操作系统分配可用端口。每次 Desktop Host 就绪生成高熵会话凭据，把版本、Shell/Host 进程身份、端点、凭据引用和就绪时间原子写入用户级 discovery 文件。文件权限按 Windows 当前用户收紧，Runtime launcher 验证文件所有者、协议版本、进程存活和 freshness 后才登记本地目的地。

请求使用标准 OTLP/HTTP 路径和 content type，并通过标准 Header 携带会话凭据。接收器限制方法、content type、压缩、单请求体积、并发数和解析时间；拒绝未授权、畸形或超限请求，不把请求正文写入错误日志。响应只返回协议所需结果和低敏诊断。

Host 停止、重启或桌面退出后 discovery 文件被删除或失效。Runtime 无法连接时保留本地 cursor 并继续远端发送，不把桌面启动失败升级成领域失败。

首个 Receiver 切片明确使用标准 OTLP/HTTP JSON 编码：只注册 `/v1/traces`、`/v1/logs`、`/v1/metrics`，要求 `POST`、`application/json` 和 256-bit base64url Bearer 会话凭据，并以 constant-time 比较认证值；Protobuf 或其他 content type 返回 415，不做内容猜测。监听地址硬编码为 `127.0.0.1`、端口由系统分配，请求体和并发数有界。解析只确认对应 OTLP 顶层 resource 数组，完整属性语义验证和状态收敛由任务 2.4 的 Projection Reducer 负责；错误响应和 diagnostic 只含固定 code，不回显请求正文、凭据或内部异常。任务 2.5 已把 Receiver 封装为正式 Cordis Service Provider，并与 Projection 和 Desktop Application 一起进入 Desktop Host composition；Runtime 侧 Launcher、本地目的地 Contributor 和完整启停/卸载组合验证仍由任务 2.6、2.7 完成。

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

最小 Reducer 只接受版本化、无正文的 `ObservationRecord`：稳定 envelope/event/stream 身份、规范摘要、序列、观测时间，以及显式 Workspace、change、Run、status 和 stage 字段。它按 event identity 幂等去重，同 identity 不同内容或同 stream/sequence 不同 event 都作为冲突拒绝；内部保留事件集合并按观测时间、序列和 event id 规范排序，所以到达顺序不改变最终快照。当前 active change、Run 和 stage 只由显式字段投影，缺字段显示 unknown/null，不从 event name 或文本推断。

Gap 以当前 Run 的稳定 stream sequence 从 1 开始压缩为缺失区间；迟到事件可以缩小或消除 gap。Freshness 由调用方提供的规范 `now` 与最后观测时间、批准阈值纯计算，Reducer 不读取系统时钟。首版内存状态用于验证收敛契约，任务 2.5 把 OTLP 解码后的 Record 接入 Receiver 与 IPC，任务 5.5 再负责 journal、snapshot、压缩和重启恢复。

Desktop Host 把已接受记录写入追加式本地 journal，并周期生成原子 snapshot。启动时加载 snapshot 后重放 journal，重复 `event.id` 收敛为 no-op。该 journal 只保存经过遥测允许列表的数据，不复制 Artifact 正文。使用现有文件持久化模式可以避免 Windows 原生 SQLite addon 的构建和 ABI 风险；如果性能证据表明不足，数据库替换走后续 change。

### 6. Renderer 通过类型化 IPC 接收 snapshot 与有序 delta

Electron 启用 `contextIsolation`、renderer sandbox，并关闭 `nodeIntegration`。Preload 只公开版本化的窄接口：

- 获取当前 projection snapshot；
- 订阅指定 snapshot version 之后的有序 delta；
- 选择 Workspace/change；
- 读取和更新关闭偏好；
- 请求显示窗口或完全退出等有界桌面动作。

Renderer 不直接监听端口、不读取 discovery/journal、不访问文件系统或执行任意 IPC channel。订阅建立时，Desktop Host 生成一致 snapshot 与版本，经 Main/Preload 转交后只发送更高序列 delta；发现序列缺口时 Renderer 丢弃局部状态并经相同桥接请求新 snapshot，不轮询。Main 不解释或二次投影业务状态，只校验、关联和转发有界消息。

任务 2.5 采用单一版本链实现这条边界：Desktop Application Service 拥有 Reducer，并在记录成功收敛后发布带 `baseVersion`、`version` 和完整 projection 的 delta；Host ready 同时携带初始 snapshot 与仅供 Runtime 投递使用的回环 receiver endpoint。Host、Main 与 Preload 在各自边界校验固定 channel 和 payload，Renderer 只在 delta 的 `baseVersion` 与本地版本不一致时一次性调用 `currentState()` 重新取得 snapshot，不建立 timer 或轮询循环。Main 保留最近一次已校验 snapshot，但不重算 change 状态。

OTLP JSON decoder 只从 Trace/Log 的 Repoctopus 属性允许列表构造 `ObservationRecord`，忽略 Log body、Span event 正文、未知属性和凭据；Metric 在尚无低基数聚合投影契约前不生成实体记录，避免从高基数标签反推 change。真实 Electron smoke 通过 Host ready 返回的随机回环端点和会话 Bearer token 发送一个 OTLP Log，随后验证窗口无需刷新即可显示 change、Run 和 stage；同一测试同时验证 Renderer 没有 `process`/`require`、Preload 桥存在，以及默认和窄窗口无水平溢出。既有 backend controller 契约测试继续证明 ready 后 Host 退出只把 Shell 转入 error，并保留 retry，而不是关闭窗口。

浏览器 SSE/WebSocket 需要额外 HTTP surface、Origin 防护和端口，不为同进程桌面窗口提供价值，因此选择 IPC。

### 7. 单实例启动与关闭偏好由桌面生命周期适配器管理

开发 Run 在创建首个遥测 envelope 前调用 Desktop Launcher：

1. 查找并验证 discovery；
2. 已运行时通过第二实例参数/受保护唤醒通道传入 Workspace、change 和 Run 上下文；
3. 未运行时启动已安装应用并有界等待 ready；
4. 成功后唤醒本地目的地 worker 重放，失败则记录 warning 并继续 Run。

任务 2.6 把这个“启动”限定为 Runtime Run preflight，而不是 Electron 进程内部已经完成的 Shell → Host 启动。Launcher 使用版本化的一次性激活请求传递 Workspace、change 和 Run 身份；Windows 上首次调用启动 Electron，后续调用由单实例 owner 接收并返回同一个 Shell PID 与 Receiver。激活交换只在用户临时目录的固定 Repoctopus 子目录中创建随机身份 request/response，响应包含短期 Receiver 凭据，Runtime 读取后立即删除两份文件；所有路径和 payload 都经过固定 schema 校验，等待时间有界。正式的用户所有权、freshness、进程身份验证和长期 discovery 仍由任务 5.1 完成，当前握手不能被解释为已经满足该安全门槛。

自举开发在 product root 与 Workspace 重合且桌面构建存在时解析固定 Electron 依赖；已安装场景可以提供明确的 Desktop executable。未支持平台、未安装桌面端、启动超时、握手失败和本地重放失败统一返回固定 warning，不能抛出到 Run 领域转换。`run start --change <change-id>` 把显式 change 身份写入 Run；没有可信 change 输入时不为 Dashboard 伪造关联。

Launcher 在 Run 持久化前先激活 Receiver 并重放已有积压，Run 的首个 Trajectory 与规范 envelope 持久化后再唤醒一次本地目的地，因此首次 Run 也无需等到下一条命令。任务 2.6 的最小映射先覆盖显式绑定 change 的 Trajectory；映射只使用事件自身和不可变 Run 身份，不用后续“当前 Run 状态”重算旧事件，从而保证失败重试不会让同一 event ID 产生新 digest。进程外测试证明首次启动与第二次激活收敛到同一个 Shell PID 和 Receiver、本地 pending envelope 被确认且临时凭据文件被删除；另一个真实 CLI/远端 mock 纵切证明桌面不可用只增加 warning，Run 仍成功。

任务 3.1 将所有 Workflow Trajectory 迁移到同一映射，不再要求 Run 必须绑定 change 才能进入团队遥测；没有可信 change 的记录仍进入远端目的地，但 Desktop decoder 将其视为非投影记录并忽略，不伪造 change。Envelope signal 固化稳定 Trace/Span 父子身份、Log severity/context，以及事件 Counter 和步骤耗时 Histogram；步骤 duration 与 retry count 从该事件之前的持久 Trajectory 推导，避免用后续 Run 当前状态重算旧事件。Metric signal 只包含 workflow、event type 和 result 等低基数维度，不携带 Run、change、event 或 envelope 身份。

远端与桌面现在都调用同一个 OTLP/HTTP JSON encoder；旧 Workflow OpenTelemetry SDK exporter 和独立 mapping 已删除。远端目的地使用稳定 `remote-otlp` cursor，失败只记录该 cursor 的有界健康状态，恢复时重放未确认 envelope；桌面继续使用独立 `desktop-local` cursor。`OTEL_EXPORTER_OTLP_ENDPOINT` 生成完整三信号端点，或要求同时提供三条 signal-specific endpoint，拒绝只配置部分信号后却确认整个 envelope。架构门禁规定 `TelemetryBatch` 只能由共享 Workflow envelope mapper 解释，阻止重新引入第二套 exporter 语义。

双目的地测试把同一批 envelope 同时发送到远端 mock 与 Desktop mock，逐对象确认 Trace、Log、Metric payload 完全一致而仅认证 Header 不同，并验证稳定 envelope ID/digest、Trace 关系、Histogram 和 Metric 低基数边界。远端 503 故障测试证明远端 cursor 保持 pending/degraded、桌面 cursor 不变，恢复后只推进远端；独立 tracer E2E 与完整验证通过 108 个测试文件、450 项测试并保留 1 项既有条件跳过。

任务 3.2 把目的地中立的 `ObservationTelemetry` 提升为独立 Cordis Service。该 Service 是 envelope 持久化和远端重放的唯一 owner；Workflow 与 Evidence Provider 只把各自已持久化的领域事件映射为 envelope，再调用同一入口。这样避免两个领域 Provider 分别创建 Store worker，并发改写同一个 `remote-otlp` cursor。Builtin catalog 分别声明共享 Service 的文件系统、网络权限和 Workflow 映射 Provider 的无副作用权限，composition 也把共享 Service 作为显式必需依赖。

Evidence 保留自己的领域 outbox 与顺序 offset，因为它回答“哪些 Evidence 事实尚未成功交给遥测层”；共享 Envelope Store 的 per-destination cursor 则回答“哪些规范 envelope 已被某个目的地确认”。远端失败时，Evidence offset 不推进，已写入 Envelope Store 的内容保持幂等；重试再次映射同一 event ID 会得到相同 envelope ID 和 digest。远端已确认但 Evidence cursor 写入中断时，下一次重放只完成幂等保存并推进 Evidence offset，不重复改变远端逻辑状态。两层 cursor 因此不互相代替，也不产生 exactly-once 承诺。

Evidence mapper 只解释 Attempt、节点、Artifact 与 Gate 的持久事件。Attempt 和节点生成稳定 Trace，所有事件生成关联 Log，Counter 与节点耗时 Histogram 只使用 event type、adapter、status 和 freshness 等低基数维度。允许列表保留 superseded 状态、Receipt 复用的 freshness 与 `sourceReceiptId`、Artifact 摘要元数据和 Gate 结果，同时拒绝绝对路径、正文、命令输出、凭据及任意未声明字段。远端与桌面继续调用同一 OTLP encoder；架构门禁只允许 Evidence outbox 持久化批次，并只允许共享 Evidence mapper 解释批次。

任务 3.3 把 App lifecycle、平台事件和 Delivery 分别收敛到一个纯 `ObservationEnvelope` mapper，并删除领域专用 OpenTelemetry SDK exporter。Lifecycle 事实增加稳定 sequence 与 event ID；App Boot 让共享遥测 Provider 最后卸载，使其他插件的 `unloading`、`disposed` 和 App `closed` 事实先进入 Envelope Store。Boot 缓存 Fiber 与插件身份，因此 Loader 移除插件后仍能记录最终 `disposed`；共享遥测 Provider 不观察自己的生命周期，避免关闭时递归发布。

Desktop Host 把 Electron `userData` 作为可写数据根传给 composition。Bootstrap 允许调用方显式指定数据根，不再把安装目录当作持久化前提。

平台事件仍先提交持久 Inbox mutation，再映射和发布；精简组合没有共享遥测 Service 时只跳过观测，不阻止 Inbox 与 Runner 恢复，正式 Project 和 Runner composition 继续把该 Service 列为必需依赖。Delivery v2 与 v3 都先提交 Delivery state/event，再通过相同 Service 发布；任务 3.3 补齐 v3 的 prepared、decision、action、refresh、invalidated 和最终 Change publication 事实。遥测失败发生在领域提交之后并被隔离，不能回滚交付状态。

Post-merge 不建立第四个 exporter。Workflow mapper 从持久 `RunTriggerSnapshot` 和 action `correlationReceiptId` 生成 merge facts、Change 与 checkout/specification closure/path audit/publication Receipt 关联；最终 Change publication 同时由 Delivery v3 的开始、成功或失败事件表达。这样每种领域对象只有一个解释位置，OTLP destination 只接收 envelope。版本化 golden fixture 固定 Lifecycle、平台事件、Delivery 与 Post-merge 四种结果；双目的地测试证明远端和 Desktop 使用同一 encoder。架构门禁分别限制 `LifecycleTelemetryEvent`、`PlatformEventTelemetryEvent`、`DeliveryEvent` 和既有 `TelemetryBatch` 的解释位置，防止专用 exporter 回流。

业务提交 `6eb0bf2` 完成迁移。完整 `npm run verify` 通过 109 个测试文件、457 项测试，保留 1 项条件跳过；生成物、品牌、架构、provenance 和 13 项严格 OpenSpec 校验全部通过。验证产生的临时 Workspace telemetry envelope 已清理，未保留调试日志或 scratch 产物。

任务 3.4 把桌面状态关联限定为可追溯的持久事实。Workflow mapper 从固定 Project Snapshot、Run 身份和 Trajectory Action 建立 Workspace、change、Run、阶段、Run→Action 父子执行、任务和权威下一步动作；Evidence mapper 从 Attempt、Receipt、Adapter 与 Gate 建立 Run→Attempt、Attempt→Node、执行主体、验证和阻塞；Delivery mapper 只在事件与 State 的 change 和 state version 精确匹配时读取 Human Decision Request 或可信 Actor。旧 Delivery 事件与较新 State 一起重放时只保留事件自身的 change、版本和允许列表数据，不把新请求或状态嫁接到旧事件。

执行主体遵循“缺失即未知”。当前 Run State 没有持久化 Agent 身份，因此 Workflow Action 不从 summary、自定义 trigger facts 或 action 附加字段猜测 Agent；只有持久 Evidence Adapter 和 Delivery Approval Actor 才导出执行主体。`action.proposed` 是 Workflow 下一步动作的权威来源，等待中的 Human Decision Request 是 Delivery 下一步动作的权威来源；Evidence Gate 没有持久化处理动作时只导出 blocker，不补造建议。OTLP `repoctopus.observed_at` 与信号时间直接使用领域事件 timestamp，不用接收时间或最新状态更新时间。

正向 fixture 覆盖 Human Decision、Evidence Gate、父子执行、执行主体、任务与验证；反向 fixture 注入伪造的 `parentRunId`、`agentId`、`nextAction`、change 和较新 Delivery State，确认这些值不进入 envelope。跨领域 Metric 检查拒绝 Workspace、change、Run、execution、task、verification、blocker、Attempt、Bundle、Delivery、Envelope、Event 或 Receipt 身份，只保留 workflow、event type、result、adapter、status 和 freshness 等有界维度。业务提交 `3e83033` 完成实现；完整 `npm run verify` 两次通过 109 个测试文件、463 项测试并保留 1 项条件跳过，生成物、品牌、架构、provenance 和 13 项严格 OpenSpec 校验全部通过。每轮验证生成的 150 个临时 telemetry envelope 已清理。

任务 2.7 把这条纵切的进程边界收敛为可执行 composition 生命周期。Runtime 的 Launcher 与本地目的地只由 builtin catalog 注册的 Service Provider 构造，project composition 只持有稳定应用端口；Desktop Host composition 显式包含 Application Service、OTLP Receiver Provider 和依赖两者的 Application Plugin。Application Fiber 获取 Receiver 的接纳租约，卸载时先归还租约，使既有端口对新遥测返回可重试的 unavailable；重新加载 Fiber 可以恢复接纳。Receiver Provider 自己的 Effect 仍唯一拥有并最终关闭回环监听器，因此应用可用性和原生端口所有权不会混为一体。

架构门禁额外拒绝 Electron Main/Preload 调用 App Boot、composition compiler 或 builtin catalog，并拒绝在显式 Service Provider/Shell owner 之外直接构造 Windows Launcher、OTLP Receiver 或 Host controller。零桌面能力测试证明 Runtime 返回固定 unavailable 诊断而不启动进程；正常 Desktop Host、缺失依赖 fail-closed、Host 失败后串行替换、Application Fiber 卸载/重载和 Provider 关闭端口均有自动化证明。完整验证通过 105 个测试文件、445 项测试并保留 1 项既有条件跳过，桌面进程外 E2E 2/2 通过；这完成 composition ownership，不提前宣称任务 5.1 的 discovery 安全或 5.2 的全部并发单实例恢复已完成。

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

上游采用单元必须是可执行行为切片，而不是孤立文件清单。每个切片同时审计实现、应用入口、开发/打包布局和相邻契约测试，并在机器清单中记录行为、来源、成立前提、Repoctopus 差异和补偿测试。若 Repoctopus 改变 DSH 的入口或目录布局，就不能直接继承 `app.getAppPath()` 等路径结论；必须先把差异封装为可测试端口。Electron 二进制解析同样与 lifecycle install script 分开治理，干净环境通过显式准备命令验证惰性下载或缓存，而不登记不存在的安装脚本。

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

### 12. 旧流程基础切片按新交付契约续作

本 Change 的旧流程 Spec MR #11 和基础实现 MR #12 已进入主线，但 #12 的批准正文明确把它限定为第一个桌面基础切片；OTLP receiver、统一 envelope、投影、完整界面、托盘和 Windows 打包仍未交付。因此 MR 合入事实不能被解释为 Change 已完成，也不能直接归档当前四类规划产物。

续作从包含两个旧 MR 和 `finalize-change-before-change-mr` 的最新干净主线重新建立基线。2026-10-22 的恢复验证中，DSH `687f282e8625c6b8d11ff58211a90524be2e4317` 与 Comet `575ab0d172e8105257b3c9172b8c8a9b628960ca` 均未漂移；`npm run verify` 通过 99 个测试文件、420 项测试并保留 1 项既有 Windows 条件跳过，`npm run test:tracer-e2e` 1/1 通过，桌面 smoke、来源与架构检查也通过。这些事实完成任务 1.1 和 1.3，但不为剩余能力提供完成证明。

依赖恢复同时发现 10 个 moderate、0 个 high/critical 的 npm advisory。Vitest 已从 `4.1.11` 补丁升级到 `4.1.12`，两条测试工具 advisory 随之消失，完整验证继续通过；`npm audit --omit=dev` 为 0。其余 8 条全部收敛到仅在构建期使用的 Electron Builder 传递链，其中根 advisory `GHSA-hp3w-g68c-fv3c` 没有已发布修复版本。npm 的自动建议会把固定的 DSH 基线 `26.15.3` 降到 `26.5.0`，而 Electron Builder 上游已继续发布 `26.18.0`，因此该建议不能证明安全升级，也不能用 `npm audit fix --force` 绕过来源和上游采用审计。

任务 1.2 的结论是保留已审计的 DSH 固定版本，把现有 moderate 视为不进入生产依赖、且没有不可信 format string 输入面的构建工具风险；任何升级继续走上游基线、provenance、Windows 打包和完整验证。此结论不把 advisory 宣称为已修复，也不允许未来的 high/critical 或生产依赖 advisory 通过同一理由放行。

恢复后的 Change 分支遵循 v3 边界：先公开分支并取得 Planning Approval，剩余实现默认汇入一个 Business MR；最终 Change MR 只能由 Post-merge 在业务合入、Evidence、主规格同步和归档完成后创建。旧 MR #11/#12 是历史事实，不是复用旧批准或提前创建最终 MR 的授权。

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
