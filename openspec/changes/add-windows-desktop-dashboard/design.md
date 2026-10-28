# Design

## Context

参见 [proposal.md](./proposal.md) 的动机。当前 Runtime 已经以 `Open → Design → Build → Verify → Archive` 管理 change，Build 内部具有 `Configure → Plan → Plan Evidence → Execute → Check`，并把 Work Package、Host Outcome、Skill resolved/delivered/consumed、Validator、Human Decision、等待和恢复作为权威事实。现有 OpenTelemetry exporter 在领域事实持久化后分别构造并发送 Trace、Log 和 Metric；Evidence 已有持久 outbox 与 cursor，但平台事件和目的地投递映射仍分散在不同 exporter 中。

主线已经包含第一版桌面 foundation，而不是从零开始：`app/desktop` 提供 thin Electron Main、Node-mode Host、Preload、最小 Renderer、单实例锁和串行 backend controller；`bootDesktopComposition()` 只组合 `desktopApplication` Service 与 Application Plugin；构建脚本已经固定 Electron、React、Vite 和 `electron-builder` 的精确版本，并有 composition、startup、controller 与 Host E2E 测试。当前 `DesktopApplicationSnapshot` 只表达 `{ phase: "ready" }`，单实例回调只聚焦窗口，桌面 composition 尚无 OTLP Receiver、Projection Store、Launcher、目的地、托盘、持久投影或工作流视图；也没有安装包配置。因此本 change 深化现有模块，不复制或平行重建第二套 Shell。

桌面端需要以标准 OTLP 上报作为唯一状态输入，不能扫描 OpenSpec、Git 或领域 Store，也不能查询 SigNoZ 后轮询刷新。团队远端后端与本地 Dashboard 必须消费同一事实映射，但桌面应用离线、关闭或卸载不能阻塞工作流和远端遥测。

Comet 固定源码基线提供 change explorer、阶段进度、任务、验证、阻塞和下一步动作的信息架构参考。Repoctopus 不采用 Comet 的本地文件 Collector、Classic/Native 状态分支、SQLite read-through cache 或实现源码，因此不存在派生其 UI 代码的许可边界。

当前固定 DSH commit `687f282e8625c6b8d11ff58211a90524be2e4317` 已包含完整 Desktop 实现。它使用薄 Electron Shell 启动 `ELECTRON_RUN_AS_NODE=1` 的独立 Host 子进程，Host 再运行共享 Cordis profile；Shell 管理窗口、托盘、单实例、安全边界与 Host 恢复。此前上游采用审计只覆盖 Skill、Webhook 和 Cordis，遗漏了 `apps/desktop` 与 `apps/desktop-host`，本 change 补齐该审计缺口，并以固定 MIT 源码为进程模型参考。

旧 Dashboard 实验分支建立在上述 Runtime 协议定型之前，包含已经废弃的独立修复阶段、merge 后自动化、已完成 Task 回退和旧 Run schema。整体合并会把双重生命周期重新引入主线。当前实现因此从最新 `main` 和全新的 Runtime Run 开始；旧分支只作为行为与代码候选库，每个候选必须由当前 Work Package 重新验证，不能继承旧任务勾选、旧 Evidence 或旧本地投影数据。

## Goals / Non-Goals

**Goals:**

- 在 Windows 10/11 x64 上交付可安装、自动激活、单实例和可选托盘驻留的 Electron Dashboard。
- 先生成一份稳定观测 envelope，再向本地桌面与远端 OTLP 后端独立投递。
- 由本机 OTLP/HTTP 接收驱动 change 状态投影，并通过类型化 IPC 实时更新窗口。
- 以五阶段为主体呈现 change，并展开 Build 五个子动作、当前 Work/Task/attempt/Host/Validator/continuation、Skill 装填与消费以及最近活动。
- 分别呈现流转、执行、质量和遥测健康，使工作流不足可以被定位和复盘。
- 在重复投递、应用晚启动、窗口重载、桌面退出和远端故障下保持可诊断、可恢复。
- 保持 Engine、Workflow、领域 Store 与 UI/后端产品无关，并延续现有隐私允许列表。

**Non-Goals:**

- 不部署本地 SigNoZ、OpenTelemetry Collector 或 Docker Compose。
- 不实现 SigNoZ 查询、告警和团队 Dashboard；真实远端 SigNoZ 接入留给后续验证。
- 不为 macOS、Linux 或 Windows ARM64 生成正式支持安装包或完成系统集成验收。
- 不把桌面应用变成 Workflow 编辑器、任务控制台、规格编辑器或通用日志浏览器。
- 不复制 Comet UI 源码，也不把 Comet 专有状态模型引入领域层。
- 不兼容或迁移旧 Dashboard 分支的 Run、projection、journal 或 IPC schema。

## Decisions

### 1. 从最新主线重建，旧分支只提供可审查候选

实现分支 MUST 从本 change 开始执行时的最新 `main` 建立，并使用更新后 Runtime 的 Work Package、Skill、Outcome、Validator 与阶段推进。旧 Dashboard 分支不得整体 merge、rebase 或批量 cherry-pick；先建立按行为切片的 salvage ledger，记录候选来源、当前规格对应项、依赖、需要重写的旧语义、验证方法和最终采用结论，再在当前任务内选择性移植。

以下内容一律不继承：旧任务完成状态、旧 Run/Evidence、独立修复生命周期、merge 后自动化、已完成 Task 回退、旧遥测/投影 schema 和旧数据读取器。Task 完成保持单调；Verify finding 通过失效受影响的 Plan Evidence、Build Package 或 Check 返回 Build Plan/Execute，而不是复写已完成 Task。

该选择会牺牲直接复用 55 个旧提交的速度，但能保证桌面端成为当前 Runtime 的真实消费者，而不是维护第二套历史协议。对旧分支做代码考古仍有价值：纯 UI 组件、OTLP fixture、Electron 生命周期和安全测试只有在依赖与语义均通过当前规格后才可移植。

### 2. 桌面观测采用薄 Electron Shell 与独立 Cordis Desktop Host

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

### 3. 以三个深模块承载遥测投递、投影和桌面应用状态

当前多个 exporter、`FileEvidenceTelemetryOutbox`、最小 `DesktopApplication.snapshot()` 和 Shell state bridge 都偏浅：调用者需要理解映射、游标、重放、顺序与恢复细节。实现把这些复杂性收敛到三个深模块，外部 Interface 只暴露调用者真正需要的能力：

1. **Observation Pipeline**：接收已持久化的权威事实，完成允许列表映射、envelope 原子追加、按目的地取批次、确认与 gap 治理。外部 Interface 不暴露文件路径、cursor 文件或 exporter SDK；远端 OTLP 与桌面回环是两个真实 `ObservationDestination` Adapter，测试使用进程外假接收器穿过同一 Interface。
2. **Desktop Projection**：接收已认证和解码的 `ObservationRecord` 批次，原子地产生版本化 snapshot 与有序 delta，并负责去重、乱序、缺口、新鲜度和 journal 压缩。OTLP Receiver 和 Desktop Application 只知道 `ingest()`、`snapshot()` 与 `subscribe()`，不操作 reducer 内部状态。
3. **Desktop Application**：把 change 选择、snapshot/delta 订阅、关闭偏好和有限桌面动作统一在版本化 Interface 后；Electron Main/Preload 只转发该 Interface，不重新解释领域事实。现有只返回 ready 的 Service 在原位置深化，不建立新的平行 Service。

这些模块可以拥有内部 seam，但不得为了单元测试把 mapper、cursor、journal、reducer 或窗口状态逐个暴露成产品 Interface。持久文件系统属于 local-substitutable 依赖，通过临时目录测试；远端 OTLP 和桌面回环属于跨进程 Adapter，通过进程外 receiver 验证。接口测试覆盖可观察结果，替代对旧浅模块内部状态的重复测试。

备选方案一是为 mapper、store、cursor、retry、projection 和 IPC 各建立公共 Service；这会让调用者编排同一事务并产生浅接口群，因此拒绝。备选方案二是让 Desktop Application 直接读取 Trajectory 或 OpenSpec；这会绕过标准 OTLP seam 并制造本地专用状态协议，因此拒绝。

### 4. 规范观测 envelope 是不可变投递单元

把分散 exporter 中的领域映射收敛为纯映射层。每个已持久化事件生成版本化 `ObservationEnvelope`，至少包含：

- `schemaVersion`、稳定 `envelopeId`、来源 `event.id` 和观测时间；
- 信号类型与固定事件名称；
- 已脱敏、允许列表内的 resource、scope 和 record 属性；
- 可验证的 Workspace、change、Run、父子执行、阶段、Build action、Work、Task、attempt、Host、Validator、continuation、Skill、验证、等待和阻塞关联；
- 用于完整性校验的规范摘要。

Envelope Store 只保存不可变 envelope。目的地 Adapter 将同一 envelope 编码成标准 OTLP/HTTP 请求，可以拥有不同端点、Header、超时和批量策略，但不得再次读取领域 Store 或改变领域属性。这样保证“同一套 OTLP 数据”指相同身份和语义，而不是要求不同 HTTP 请求具有逐字节相同的压缩、批次或传输头。

备选方案是让每个 exporter 分别从领域对象构造 SDK Span/Log/Metric。这是当前分散实现，容易在新增字段或修复映射时产生本地与远端差异，因此替换。

### 5. 使用共享 envelope store 与独立目的地 cursor

Envelope 先以原子写入进入 Workspace 的本地遥测 outbox，再由目的地 worker 独立读取和确认。目的地状态包含稳定 `destinationId`、最后确认 envelope、连续序列、最近尝试、结果分类和积压摘要。

- 远端目的地沿用标准 `OTEL_EXPORTER_OTLP_*` 配置。
- 桌面目的地使用稳定的用户本机身份，不把临时端口或会话 token 作为目的地身份。
- 远端成功、本地失败时只推进远端 cursor；反向亦然。
- 失败诊断有界且不保存响应正文。
- Outbox 使用按时间、数量和字节上限的保留策略；达到上限时记录明确 gap，不静默声称桌面状态完整。
- 禁用或卸载桌面目的地时停止其积压增长，并保留有界诊断；远端目的地不重置。

第一版复用仓库现有原子文件 Store、Journal 和 cursor 模式，不引入共享数据库。未来可以把 Store Provider 替换为 SQLite 或远端队列，但不得改变 per-destination 确认语义。

备选方案一是把一份数据同时直接 `Promise.all` 发往两个端点；进程退出后无法确定各目的地是否确认。备选方案二是让 Electron 接收后再转发 SigNoZ；Electron 关闭会切断团队遥测并使桌面成为单点，因此拒绝。

### 6. Desktop Host 子进程实现受保护的本地 OTLP 接收器

接收器仅绑定 `127.0.0.1`，由操作系统分配可用端口。每次 Desktop Host 就绪生成高熵会话凭据，把版本、Shell/Host 进程身份、端点、凭据引用和就绪时间原子写入用户级 discovery 文件。文件权限按 Windows 当前用户收紧，Runtime launcher 验证文件所有者、协议版本、进程存活和 freshness 后才登记本地目的地。

请求使用标准 OTLP/HTTP 路径和 content type，并通过标准 Header 携带会话凭据。接收器限制方法、content type、压缩、单请求体积、并发数和解析时间；拒绝未授权、畸形或超限请求，不把请求正文写入错误日志。响应只返回协议所需结果和低敏诊断。

Host 停止、重启或桌面退出后 discovery 文件被删除或失效。Runtime 无法连接时保留本地 cursor 并继续远端发送，不把桌面启动失败升级成领域失败。

备选方案是固定端口且无凭据。任何本机进程都能伪造 change 状态或读取错误细节，因此拒绝。Windows named pipe 虽然权限更自然，但不是标准 OTLP/HTTP 端点，首版不采用。

### 7. OTLP 解码后进入确定性 change 投影

Receiver 先验证 OTLP 和 Repoctopus schema version，再把 Span、Log 和 Metric 解码为只读 `ObservationRecord`。Projection Reducer 按 `event.id`、envelope 序列和关联身份确定性地产生：

- Workspace/change 列表和 active/completed/failed/stale 状态；
- 当前 Run、workflow、五阶段、阶段尝试、进入时间和父子执行；
- Build Configure、Plan、Plan Evidence、Execute 与 Check 的状态和时间线；
- 当前 Work、Task、attempt、Host、Validator、Runtime continuation 和最近活动；
- action/augmentation Skill 的 resolved、delivered、consumed 或缺失状态；
- 任务总数、完成数、活动任务和最近转换；Task 完成状态只按权威单调事实投影；
- Evidence 验证、Gate 结果与 Artifact 元数据引用；
- blocker/Human Decision 类别与已上报的下一步动作；
- 流转、执行、质量和遥测四类可解释健康状态及其来源事实；
- 最近接收、最近观测、追平、gap 和新鲜度状态。

Projection 不读取仓库、OpenSpec、Git 或领域 Store，不从文本猜测 Agent、完成度和下一步动作。Metric 仅用于聚合摘要；具有稳定身份的 UI 状态主要来自 Span 与 Log，避免从低基数 Metric 反推实体。

Desktop Host 把已接受记录写入追加式本地 journal，并周期生成原子 snapshot。启动时加载 snapshot 后重放 journal，重复 `event.id` 收敛为 no-op。该 journal 只保存经过遥测允许列表的数据，不复制 Artifact 正文。使用现有文件持久化模式可以避免 Windows 原生 SQLite addon 的构建和 ABI 风险；如果性能证据表明不足，数据库替换走后续 change。

### 8. Renderer 通过类型化 IPC 接收 snapshot 与有序 delta

Electron 启用 `contextIsolation`、renderer sandbox，并关闭 `nodeIntegration`。Preload 只公开版本化的窄接口：

- 获取当前 projection snapshot；
- 订阅指定 snapshot version 之后的有序 delta；
- 选择 Workspace/change；
- 读取和更新关闭偏好；
- 请求显示窗口或完全退出等有界桌面动作。

Renderer 不直接监听端口、不读取 discovery/journal、不访问文件系统或执行任意 IPC channel。订阅建立时，Desktop Host 生成一致 snapshot 与版本，经 Main/Preload 转交后只发送更高序列 delta；发现序列缺口时 Renderer 丢弃局部状态并经相同桥接请求新 snapshot，不轮询。Main 不解释或二次投影业务状态，只校验、关联和转发有界消息。

浏览器 SSE/WebSocket 需要额外 HTTP surface、Origin 防护和端口，不为同进程桌面窗口提供价值，因此选择 IPC。

### 9. 单实例启动与关闭偏好由桌面生命周期适配器管理

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

### 10. Windows 是唯一首发验收平台，代码边界保留可移植性

使用 Electron、TypeScript、React 和 Vite 构建桌面应用，使用 `electron-builder` 生成 Windows x64 安装产物。选择 `electron-builder` 是因为固定 DSH Desktop 已验证同类 thin-shell/Host 资源打包路径，便于采用经过验证的 Windows 基线；依赖仍使用精确版本并纳入许可证、来源、构建脚本和漏洞检查。UI 不采用 Comet 的 Ant Design/Tailwind 组合；首版建立自己的轻量语义组件和设计 token，避免为了少量状态页面引入完整 UI 框架。

操作系统差异被限制在 `DesktopLifecycleAdapter`、`TrayAdapter`、`NotificationAdapter`、`AutoLaunchAdapter` 和 `UpdaterAdapter`。首个 change 只实现和验证 Windows adapter；其他平台 adapter 显式返回 unsupported，而不是依赖 Electron 可以启动就宣称支持。

Renderer 首版采用三层信息架构：全局层选择 Workspace/change 并显示接收与目的地健康；主体层以五阶段 rail 展示当前阶段和历史尝试，并在 Build 展开五个 action；细节层显示当前 Work/Task/attempt/Host/Validator/continuation、Skill 链路、Evidence/Human Decision 和最近事件。四类健康状态分别提供原因和下钻入口，不合成无解释总分。

所有可达状态包括启动中、无数据、稀疏事实、追平、实时、过期、gap、Receiver 错误、Work 停滞、等待人工决定、验证返工、Run 完成和 Run 失败。字段缺失显示“尚未上报”，禁止从文本、Task 数量或接收时间猜测状态；视觉实现与可访问性在业务实现阶段按 UI 设计检查验证。

### 11. DSH 采用遵循选择性源码采用矩阵

对固定 DSH commit 的采用分三类，避免把“参考桌面端”误解为复制整个产品：

- **源码级采用并按 Repoctopus 修改**：Host process 生命周期、backend controller 串行 start/retry/stop、Node-mode 环境、single-instance、Tray、IPC sender/origin 校验和 Shell settings ownership。实现时在 `third_party/dsh-adoption.json` 登记上游文件、固定 commit、本地目标和变更摘要。
- **行为级适配**：窗口先于 Host ready 显示、Host 崩溃恢复、有界优雅退出、Renderer sandbox 和 `electron-builder` Windows 资源打包。Repoctopus 按自己的契约重写，不保留 DSH 的 Web app 假设。
- **明确排除**：DSH Web Host HTTP/WebSocket 代理、完整 DSH profile/plugin/agent/session/workspace 模型、账户/浏览器能力、自动更新系统、打包的 Python/Node/pnpm 运行时和平台安装器链。

上游采用单元必须是可执行行为切片，而不是孤立文件清单。每个切片同时审计实现、应用入口、开发/打包布局和相邻契约测试，并在机器清单中记录行为、来源、成立前提、Repoctopus 差异和补偿测试。若 Repoctopus 改变 DSH 的入口或目录布局，就不能直接继承 `app.getAppPath()` 等路径结论；必须先把差异封装为可测试端口。Electron 二进制解析同样与 lifecycle install script 分开治理，干净环境通过显式准备命令验证惰性下载或缓存，而不登记不存在的安装脚本。

Repoctopus 的 Renderer 是本地 OTLP 投影客户端，不需要 DSH 的共享 Web App 和鉴权反向代理；Desktop Host 也只包含桌面观测 composition，不加载 DSH 产品插件。这样采用的是被验证的进程与生命周期模式，而不是引入另一个产品内核。

### 12. SigNoZ 与本地 Docker Compose 不进入首个验证门槛

自动化测试使用协议 fixture 和进程外 mock OTLP receiver，验证三类信号、身份一致、目的地隔离、重放和隐私。桌面 E2E 在 Windows 启动打包候选，向真实本机 receiver 发送 OTLP，验证 projection、IPC、单实例、关闭和托盘生命周期。

本 change 不创建本地 SigNoZ Compose，也不让真实公司后端成为 CI 或合入前提。后续在可访问环境中把远端 endpoint 指向已部署 SigNoZ，比较固定 event identity、属性与查询结果；发现后端兼容问题时修改 OTLP Adapter，而不是给桌面建立专用旁路。

### 13. 规格、设计与来源冲突是停止条件

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

1. 在最新 `main` 记录 Runtime、遥测与构建基线，并为旧 Dashboard 分支建立 salvage ledger；拒绝整体合并和旧完成度继承。
2. 定义当前唯一的 envelope schema 与 Store，不提供旧 Dashboard schema、journal、Run 或 IPC 的读取器；用当前主规格 fixture 验证五阶段、Build action、Work、Skill 和恢复事实。
3. 将现有 exporter 逐类迁移到纯映射与共享 Envelope Store，用 golden fixture 证明允许列表语义保持一致。
4. 增加多目的地 cursor；先只注册现有远端目的地，验证失败和恢复行为后再启用桌面目的地。
5. 实现 headless Desktop Host 的本机 receiver、认证、投影、journal、App Boot 和协议测试。
6. 在现有 thin Electron Main、Host controller、私有 Node IPC、preload/renderer 和单实例 foundation 上增加启动上下文、Launcher、关闭偏好、托盘与安装配置，并完成 Windows 打包 E2E。
7. 用 Repoctopus 自身的开发 Run 启动桌面应用，发送真实 OTLP，验证本地五阶段、Build 子动作、Skill 状态和四类健康状态；远端使用 mock receiver 验证相同 envelope。
8. 最终发布验证 Work Package 独占正式验证输出：运行完整验证，将本 change 的报告写入 `verification/add-windows-desktop-dashboard/**`，并在全部产品代码提交完成后刷新 `verification/restore-runtime-build-orchestration/verification-report.md` 的 managed-execution 基线；其他 Work Package 不写这些路径。报告明确未连接真实 SigNoZ、未支持平台和未迁移旧 Dashboard 本地数据。

回滚通过普通 revert MR 移除 Desktop Launcher 和本地目的地，不删除领域 Trajectory 或远端 cursor。当前 schema 的本地 projection 可以由保留期内的规范 envelope 重建；旧实验分支的数据不属于迁移输入，也没有兼容承诺。桌面用户数据只能由明确的卸载或清理动作处理，代码回滚默认不自动删除。
