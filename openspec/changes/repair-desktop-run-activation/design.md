# Design

## Context

现有 Desktop Dashboard 已包含 Electron Main、Desktop Host、Receiver、Projection、Renderer、单实例锁、托盘和 Windows NSIS 打包。Runtime 侧也注册了 `DesktopLauncher`，但它是一个无生产调用者的浅边界：`WorkflowRuns.startChange()` 完成 Run 初始化后直接返回；Launcher 只接受一个环境变量中的 executable，并在 `spawn()` 返回后立即宣称 started。当前测试只证明插件存在和“没有环境变量时 unavailable”，没有从公共 Run 入口断言桌面激活。

固定 DSH Desktop 参考把协议登记、开发应用路径解析、Electron readiness、单实例和失败恢复作为相邻行为切片测试：打包配置登记 `dsh://`，应用只接受 `dsh://open`，Windows/Linux 由冷启动 `argv` 或 `second-instance` 交付，macOS 由 `open-url` 交付。Repoctopus 保留自己的 Change Run、OTLP 和多仓模型，并在同一模式上增加受校验的 `{ workspaceId, changeId, runId }`；登记能力不等于使用能力，启动成功也不能由同步函数返回伪造。

## Goals

- 每次 Windows Change Run start/start-or-resume 都向唯一桌面实例交付当前 Run 上下文。
- 源码自举和已安装产品都不要求用户手工设置 executable 环境变量。
- 桌面不可用不影响 Run 权威状态，但调用方和遥测可以准确看到原因类别。
- 以生产入口测试而不是 catalog membership 证明能力闭合。

## Non-Goals

- 不让 Desktop 控制或推进 Change 生命周期。
- 不把 Electron、安装器或操作系统 API 引入 Engine/领域层。
- 不自动部署 SigNoZ，不查询远端后端，不增加轮询或 daemon。
- 不为 macOS、Linux 或 Windows ARM64 宣称正式支持。
- 不兼容旧的未发布 Launcher schema；产品仍处于自举阶段，直接替换错误边界。

## Decisions

### 1. `WorkflowRuns.startChange` 是激活 owner

Desktop activation 是“Change Run 已经存在”的应用级副作用，因此由 `WorkflowRuns.startChange()` 在 `startOrResume`、Skill binding 和初始 Work receipt 成功后调用。此时 `workspaceId`、`changeId` 与稳定 `runId` 都已由 Runtime 确认。

Launcher 不进入 `WorkflowRunCoordinator` 和纯领域状态转换；它不能决定 phase、Work 或 Run 成败。CLI 只渲染 `RuntimeDiagnostic`，避免其他 Host 或未来 API 绕过激活。普通无 change 的 foundation Run、只读 status/doctor 和参数错误不激活桌面。

### 2. 启动目标解析是 Launcher 内部的深模块

Launcher 接受 Product Root、平台、环境和可替换的 process adapter，按固定顺序解析 `DesktopLaunchTarget`：

1. 测试或运维显式提供的 executable override；
2. 源码自举 Product Root 下固定 Electron executable 与 `dist/desktop/main.js`；
3. Windows 安装器登记在标准 `App Paths` 中的 `Repoctopus.exe` 绝对路径。

解析只返回类型化目标和有界来源类别，不把绝对路径写入 Run、诊断或遥测。源码目标缺少依赖或桌面构建产物时返回 `development-artifact-missing`，并给出不含本机路径的修复命令。`npm run build` 将同时生成 CLI 与 Desktop runtime artifact，保证正常自举构建后可启动；发布安装包继续使用独立 `package:desktop`。

Windows 安装包登记版本化 `repoctopus://activate/<encoded-context>` 协议，并在当前安装 scope 的标准 `Software\Microsoft\Windows\CurrentVersion\App Paths\Repoctopus.exe` 默认值登记完整 executable 路径。Electron Main 使用与现有 `--repoctopus-launch` 相同的解析、上限和 schema 校验，再交给 single-instance owner；协议不是第二套业务上下文。显式 executable override 继续使用参数形式，便于测试和受控部署。

安装态调用通过绝对 `SystemRoot\System32\reg.exe` 只读取受控 `App Paths` 默认值；解析结果必须是可访问的绝对路径、basename 精确为 `Repoctopus.exe`，并与协议 handler 共存。Launcher 随后直接以 `spawn(executable, [validatedUri])` 发起冷启动或第二实例，不解析 handler 命令字符串，不使用裸 executable、当前目录、`PATH`、Explorer、`cmd /c start`、PowerShell 命令插值或任意 shell wrapper。缺失、相对、错误 basename、不可访问或协议 handler 缺失均返回 bounded unavailable。

这复用 DSH/Electron 的接收端语义，但不照搬 DSH 的无 payload `dsh://open`：DSH 由浏览器点击触发系统关联，只需聚焦窗口；Repoctopus 的短生命周期 Runtime 需要主动定位产品并传输有界上下文，因此使用 Microsoft 推荐的 `App Paths` 定位 executable，再让既有 Electron argv/`second-instance` seam 完成转交。

**Alternatives considered:** 继续只接受环境变量会把产品正常路径变成机器私有配置；让 CLI 直接依赖 Electron 会污染公共入口；解析任意 Workspace 路径会扩大信任面；解析 registry handler 命令字符串会引入引号和参数语义；Explorer 已被真实安装 E2E 证明不会可靠分派该 URI；shell wrapper 扩大注入面；新增第二套 IPC 会与已有 single-instance 和 discovery 重复。以上方案均不采用。

### 3. Launcher 只依赖注入的实例探测 seam

`DesktopLauncher` 只消费一个窄的 `DesktopInstanceProbe` interface，不构造或导入 `app/desktop/host` 实现。Project composition 在应用边界把基于 receiver discovery 的 adapter 注入 Launcher；测试用 adapter 穿过相同 seam。这样 Launcher Service 仍可独立验证，Desktop Host 的文件、ACL、进程身份与端口所有权策略保留在平台 adapter 内。

Receiver 的 `/health` producer 与 discovery fallback consumer 共用 `app/desktop/shared` 中的版本化 health contract、serializer/parser 和字节上限。解析器拒绝未知字段、未知版本、非正整数 pid、错误 content type 和超限响应；producer 不再手写重复常量。该 shared 模块只描述协议数据，不依赖 HTTP server、discovery、Service 或 Electron。

有效实例存在时，操作系统接受请求后 Launcher 结果为 `activated`；不存在时为 `started`。该分类只描述请求前实例状态与请求被接受，不声称窗口或 Host 已 ready。

**Alternatives considered:** 让 Service 直接 `new DesktopReceiverDiscovery()` 会反转 service → app/host 依赖；把 discovery 整体移入 Service 会把平台安全策略泄漏进 Launcher；producer/consumer 分别维护字符串与 shape 会让单边升级静默退化。故采用注入 seam 与中立 shared contract。

### 4. 激活结果必须等待操作系统接受请求

`DesktopLauncher.activate()` 改为异步。进程 adapter 只有在 child `spawn` 事件后返回 requested；`error`、超时或无 handler 分别映射为有界 unavailable reason。Launcher 不等待窗口永久存活，也不把 Desktop Host ready 变成 Change Run Gate；Receiver discovery 和 Observation Delivery 继续独立表达本地遥测是否 ready。

返回契约区分：

- `started`: 启动请求面向尚未发现的桌面实例；
- `activated`: 已发现实例或单实例转交目标已接受上下文；
- `unavailable`: Windows 支持环境缺少有效目标或请求失败；
- `unsupported`: 当前平台不在正式支持矩阵。

`started` 与 `activated` 都表示请求已被操作系统接受；前者表示请求前没有有效 discovery，后者表示请求前已有通过安全校验的实例。它们都不表示 Renderer 已绘制、窗口已聚焦或 Host 已 ready。即使结果不可用，Run 创建结果仍成功。调用方收到 warning，Trajectory 记录结果类别，远端 OTLP 继续独立投递。

**Alternatives considered:** 等待窗口或 Host ready 会把本地 UI 变成 Change Run Gate；只返回单一 `requested` 虽然简单，却丢失已有实例转交这一项有用、可验证的运行事实；仅监听 child `exit` 无法区分正常的第二实例退出和启动失败。因此采用“安全 discovery 前置分类 + OS 接受确认”的有界语义。

### 5. 诊断与遥测只记录稳定类别

`WorkflowRuns` 把 Launcher 结果追加到原 `RuntimeResult.diagnostics`：成功使用 info，不可用或不支持使用 warning。诊断 code 固定为 `desktop.activation.started|activated|unavailable|unsupported`，message 不含 executable、命令行、token、绝对路径或 URL payload。

Trajectory/Observation 只记录 Workspace/change/Run 关联、目标类别、结果、reason enum 和时间。Metric label 不包含路径、错误正文或自由文本。Launcher 请求发生在 Run 权威事实持久化之后；遥测失败不能反向改变 activation 或 Run。

激活事实由 Runtime 通过 Run Store 的幂等辅助事实接口追加，事件 ID 从 Run 与一次激活意图稳定派生；它不是 phase transition，不改变 lifecycle phase、Work 或 Gate。Observation Delivery 继续只消费持久化 Trajectory，禁止 Launcher 直接向 OTLP 发送第二份事件。

**Alternatives considered:** 直接从 Launcher 发 OTLP 会绕过 outbox、重放与本地/远端同源保证；把 activation 写进生命周期 transition 会让 UI 副作用污染领域状态；只返回 CLI warning 又无法支持事后工作流健康度审计。故采用持久化辅助事实。

### 6. 测试必须穿过生产入口

测试分四层：

1. red characterization 证明旧实现中 `run start` 不调用 Launcher，且环境变量是唯一解析路径；
2. 纯解析/进程 adapter 测试覆盖 override、源码目标、安装协议、异步 spawn error、超时和不支持平台；
3. `bootProjectComposition → run.change.start → WorkflowRuns` 集成测试捕获精确上下文、诊断和 Run 非阻断语义；
4. Windows 安装 E2E 验证安装器真实写入协议 handler 与 `App Paths`，先经 Launcher 的安装态解析冷启动产品，再用第二个上下文直接启动同一登记 executable，证明 cold `argv`、`second-instance`、single-instance owner 和 Change 选择；测试不得注入 executable override 或伪造 registry 查询；
5. 进程级 public CLI case 在隔离且可恢复的 handler 状态下证明无 handler 时返回 `desktop.activation.unavailable`，同时权威 Run 创建成功且远端 OTLP 继续投递。

Catalog membership 和直接 `new DesktopLauncher()` 的测试只能作为补充，不能满足生产验收。

**Alternatives considered:** 只测 Launcher 会重演本次“模块正确但生产入口断链”；只做 Windows 打包 E2E 定位成本过高且无法覆盖全部失败枚举。因此保留由纯模块、composition 纵切和安装态 E2E 组成的测试金字塔。

### 7. 已持久化 Host Outcome 使用稳定内容幂等重放

`ManagedWorkExecutor.acceptExternalOutcome()` 可能在 `markHostCompleted` 已提交、但 Skill/Delegation fact、Action Outcome 或 Validator 尚未完成时被新进程重放。Runtime 先核对 invocation、Host 与 packet identity，再把输入构造成 proposed Outcome；若 checkpoint 已有 Outcome，则比较除 Runtime 生成的 `completedAt` 之外的全部稳定字段。稳定内容完全相同就复用原对象和原时间、不再次写 `work.host-completed`，继续后续 fact 与 Validator；status、summary、consumed layers、result、findings 或 delegation receipts 任一漂移都 fail closed。

该等价规则只用于同一 invocation 的恢复，不把不同 attempt、epoch、packet 或 Host 合并，也不承诺任意自由文本规范化。它补足现有“Outcome 后 Validator 前中断”要求，而不是建立第二套 completion authority。

**Alternatives considered:** 把 `completedAt` 纳入比较会让每次合法恢复都冲突；无条件接受 checkpoint 中的 Outcome 会隐藏调用方提交漂移；再次写 Host completion 会重复 Trajectory。故只忽略 Runtime 自己生成的时间字段，并对其余内容做 canonical equality。

## Migration Plan

1. 先定义目标解析契约与 URL/argument context schema，使首个 Work Package 能在自身写入边界内独立 green。
2. 抽取 shared receiver health contract 和 `DesktopInstanceProbe` interface，由 composition 注入 discovery adapter；Launcher 不再依赖 Desktop Host 实现。
3. 重构 Launcher 为异步深模块，给 Project composition 注入 Product Root 身份，并只通过绝对 `reg.exe` 读取受控 `App Paths`，再直接启动校验后的已安装 executable。
4. 在已经存在可替换 Launcher seam 后编写 red production-entry characterization，并在同一个 runtime-integration Work Package 内接通 `WorkflowRuns.startChange()`、diagnostics 与 Trajectory/OTLP 映射。
5. 增加协议与 `App Paths` 安装登记和源码构建产物，让 Windows E2E 穿过真实安装发现、冷/热启动与 single-instance owner，并用 public CLI 证明无登记时 Run/远端 OTLP 继续。
6. 固定并验证已持久化外部 Host Outcome 的稳定内容重放语义。
7. 删除“仅环境变量才可启动”的正常路径假设，更新文档和验证报告。

Build Plan 不得把只有跨越 `WorkflowRuns` 生产入口后才能 green 的测试放入仅授权 Launcher/Shared 文件的前置包。任务编号表达规格追踪身份，不表达执行顺序；`Blocked by` 才是 Runtime 生成 Work Package 的权威依赖。

回滚以 Git commit 为边界。若安装协议在 Windows 上不能可靠传递有界上下文，停止发布协议部分，保留源码直接启动和明确 unavailable 诊断，不回退到静默、裸 executable 或命令字符串拼接。若 Host Outcome 稳定等价规则被证明过宽，只回滚该比较与复用提交并恢复严格冲突；不得删除既有 checkpoint/Outcome，也不得通过重放 Host 副作用“修复”历史状态。

## Risks / Trade-offs

- **Run start 触发 GUI 副作用**：这是已接受产品行为；只限 change start/start-or-resume，status、doctor 和参数错误保持无副作用。
- **构建 CLI 时同时构建 Desktop 增加耗时**：换取源码自举的确定性。桌面依赖下载仍由显式安装/prepare 管理，不在每次 Run 临时构建。
- **操作系统协议只证明请求被接受**：Receiver readiness 由现有 discovery/telemetry 独立呈现，不把 UI 可用性伪装成 Run Gate。
- **已有实例与首次启动存在竞态**：Electron single-instance lock 是唯一 Shell owner；重复请求只交付上下文，不能创建第二个有效 Host/Receiver。
- **Windows 安装 E2E 会触碰当前用户 registry**：测试必须先快照协议 key 与 `App Paths\Repoctopus.exe`、只操作精确测试范围并在 finally 字节级恢复；发现无法证明可恢复时 fail closed，不能删除未知用户配置。
- **Outcome 等价比较遗漏未来字段**：canonical comparison 默认包含所有字段，未来新增稳定字段会自动参与冲突判断；只有显式列出的 Runtime 时间字段可忽略。

## Assumptions and STOP Conditions

- **VERIFIED — 生产断链**：当前仓库没有 `desktopLauncher.activate()` 生产调用点，`run start` 直接返回 Change Run 结果。
- **VERIFIED — 自举根可用**：CLI App Boot 已持有稳定 Product Root，可通过 composition identity 注入 Launcher，而无需读取 Workspace 内任意路径。
- **VERIFIED — 单实例协议可复用**：Electron Main 已解析有界启动参数并把第二实例上下文交给现有 Shell。
- **VERIFIED — DSH/Electron 接收模型**：固定 DSH 提交与当前 `master` 均登记 `dsh://`，并用冷启动/`second-instance`/`open-url` 激活单实例；Electron 官方文档确认 Windows 将 Deep Link 放入冷启动 `argv` 或 `second-instance` command line。
- **ASSUMPTION — NSIS 协议与 App Paths 登记可在首个正式支持的 Windows 10/11 x64 环境稳定工作**：必须以干净安装 E2E 证明，不能只检查 builder 配置。
- **STOP — 激活需要 shell 字符串拼接**：若实现只能通过未转义命令字符串启动 URL 或 executable，停止并改用参数数组或受支持 OS API。
- **STOP — 激活污染领域状态**：若接入要求把 GUI readiness 变成 phase Gate、Run status 或 Engine dependency，停止并保持应用级 best-effort 边界。
- **STOP — 安装 E2E 绕过发现**：若测试通过 override、硬编码安装路径或伪造 registry 查询直接找到 `Repoctopus.exe`，停止并改为真实 `App Paths` 与协议登记验证。
- **STOP — Outcome 重放需要再次调用 Host**：若恢复无法在原 invocation 与持久 Outcome 上继续，停止并进入 reconcile，不能重放未知外部副作用。
