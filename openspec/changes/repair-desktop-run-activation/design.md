# Design

## Context

现有 Desktop Dashboard 已包含 Electron Main、Desktop Host、Receiver、Projection、Renderer、单实例锁、托盘和 Windows NSIS 打包。Runtime 侧也注册了 `DesktopLauncher`，但它是一个无生产调用者的浅边界：`WorkflowRuns.startChange()` 完成 Run 初始化后直接返回；Launcher 只接受一个环境变量中的 executable，并在 `spawn()` 返回后立即宣称 started。当前测试只证明插件存在和“没有环境变量时 unavailable”，没有从公共 Run 入口断言桌面激活。

固定 DSH Desktop 参考把开发应用路径解析、Electron readiness、单实例和失败恢复作为相邻行为切片测试。Repoctopus 保留自己的 Change Run、OTLP 和多仓模型，但应采用同样的生产入口纵切原则：登记能力不等于使用能力，启动成功也不能由同步函数返回伪造。

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
3. Windows 安装器登记的 `repoctopus` 应用协议入口。

解析只返回类型化目标和有界来源类别，不把绝对路径写入 Run、诊断或遥测。源码目标缺少依赖或桌面构建产物时返回 `development-artifact-missing`，并给出不含本机路径的修复命令。`npm run build` 将同时生成 CLI 与 Desktop runtime artifact，保证正常自举构建后可启动；发布安装包继续使用独立 `package:desktop`。

Windows 安装包登记版本化 `repoctopus://activate/<encoded-context>` 协议。Electron Main 使用与现有 `--repoctopus-launch` 相同的解析、上限和 schema 校验，再交给 single-instance owner；协议不是第二套业务上下文。显式 executable override 继续使用参数形式，便于测试和受控部署。

### 3. 激活结果必须等待操作系统接受请求

`DesktopLauncher.activate()` 改为异步。进程 adapter 只有在 child `spawn` 事件后返回 requested；`error`、超时或无 handler 分别映射为有界 unavailable reason。Launcher 不等待窗口永久存活，也不把 Desktop Host ready 变成 Change Run Gate；Receiver discovery 和 Observation Delivery 继续独立表达本地遥测是否 ready。

返回契约区分：

- `started`: 启动请求面向尚未发现的桌面实例；
- `activated`: 已发现实例或单实例转交目标已接受上下文；
- `unavailable`: Windows 支持环境缺少有效目标或请求失败；
- `unsupported`: 当前平台不在正式支持矩阵。

即使结果不可用，Run 创建结果仍成功。调用方收到 warning，Trajectory 记录结果类别，远端 OTLP 继续独立投递。

### 4. 诊断与遥测只记录稳定类别

`WorkflowRuns` 把 Launcher 结果追加到原 `RuntimeResult.diagnostics`：成功使用 info，不可用或不支持使用 warning。诊断 code 固定为 `desktop.activation.started|activated|unavailable|unsupported`，message 不含 executable、命令行、token、绝对路径或 URL payload。

Trajectory/Observation 只记录 Workspace/change/Run 关联、目标类别、结果、reason enum 和时间。Metric label 不包含路径、错误正文或自由文本。Launcher 请求发生在 Run 权威事实持久化之后；遥测失败不能反向改变 activation 或 Run。

### 5. 测试必须穿过生产入口

测试分四层：

1. red characterization 证明旧实现中 `run start` 不调用 Launcher，且环境变量是唯一解析路径；
2. 纯解析/进程 adapter 测试覆盖 override、源码目标、安装协议、异步 spawn error、超时和不支持平台；
3. `bootProjectComposition → run.change.start → WorkflowRuns` 集成测试捕获精确上下文、诊断和 Run 非阻断语义；
4. Windows E2E 覆盖首次启动、第二实例上下文转交、窗口聚焦、无 handler warning、进程清理及同一 Run 的 OTLP 接收。

Catalog membership 和直接 `new DesktopLauncher()` 的测试只能作为补充，不能满足生产验收。

## Migration Plan

1. 先增加失败的生产入口测试和目标解析契约。
2. 重构 Launcher 为异步深模块，并给 Project composition 注入 Product Root 身份。
3. 在 `WorkflowRuns.startChange()` 接入 activation 与 diagnostics，再增加 Trajectory/OTLP 映射。
4. 增加安装协议和源码构建产物，完成 Windows 首次/二次启动 E2E。
5. 删除“仅环境变量才可启动”的正常路径假设，更新文档和验证报告。

回滚以 Git commit 为边界。若安装协议在 Windows 上不能可靠传递有界上下文，停止发布协议部分，保留源码直接启动和明确 unavailable 诊断，不回退到静默或命令字符串拼接。

## Risks / Trade-offs

- **Run start 触发 GUI 副作用**：这是已接受产品行为；只限 change start/start-or-resume，status、doctor 和参数错误保持无副作用。
- **构建 CLI 时同时构建 Desktop 增加耗时**：换取源码自举的确定性。桌面依赖下载仍由显式安装/prepare 管理，不在每次 Run 临时构建。
- **操作系统协议只证明请求被接受**：Receiver readiness 由现有 discovery/telemetry 独立呈现，不把 UI 可用性伪装成 Run Gate。
- **已有实例与首次启动存在竞态**：Electron single-instance lock 是唯一 Shell owner；重复请求只交付上下文，不能创建第二个有效 Host/Receiver。

## Assumptions and STOP Conditions

- **VERIFIED — 生产断链**：当前仓库没有 `desktopLauncher.activate()` 生产调用点，`run start` 直接返回 Change Run 结果。
- **VERIFIED — 自举根可用**：CLI App Boot 已持有稳定 Product Root，可通过 composition identity 注入 Launcher，而无需读取 Workspace 内任意路径。
- **VERIFIED — 单实例协议可复用**：Electron Main 已解析有界启动参数并把第二实例上下文交给现有 Shell。
- **ASSUMPTION — NSIS 协议登记可在首个正式支持的 Windows 10/11 x64 环境稳定工作**：必须以干净安装 E2E 证明，不能只检查 builder 配置。
- **STOP — 激活需要 shell 字符串拼接**：若实现只能通过未转义命令字符串启动 URL 或 executable，停止并改用参数数组或受支持 OS API。
- **STOP — 激活污染领域状态**：若接入要求把 GUI readiness 变成 phase Gate、Run status 或 Engine dependency，停止并保持应用级 best-effort 边界。
