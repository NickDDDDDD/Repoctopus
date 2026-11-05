---
comet_change: stabilize-cross-platform-verification
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 `proposal.md` 的 Why。当前 PR 在 Windows 本地完整验证通过，但 GitHub Linux 干净 checkout 暴露三类平台边界错误：测试夹具使用固定 Windows 路径、Windows-only discovery 依赖宿主 `node:path`、POSIX recovered termination 没有确认退出。现有规格已经定义期望行为，本 change 不改变需求或 Runtime 状态机。

## Goals / Non-Goals

**Goals:**

- 让纯领域测试在 Windows 与 Linux 使用各自真实的宿主绝对路径，同时保持 Execution Binding 的生产校验严格。
- 让 Windows Desktop discovery 的路径计算不依赖运行测试的宿主平台。
- 让 POSIX recovered termination 只有在有界确认后才返回确定成功。
- 让本地 Windows 与 GitHub Linux 使用同一 `npm run verify` 权威并得到一致结论。

**Non-Goals:**

- 不把 Linux 或 macOS Desktop 提升为正式支持平台。
- 不放宽 Execution Binding，使其在当前宿主接受另一平台的伪绝对路径。
- 不改变 Engine、Cordis Service、lifecycle Work、Run Store、OpenTelemetry schema 或公共 CLI。
- 不扩大 GitHub branch protection 或 required-check 的平台配置范围。

## Decisions

### 1. 测试数据服从生产路径语义

涉及 `ExecutionWorkspaceBinding` 的测试使用一个最小测试路径工厂，通过 `path.resolve()` 和 `path.join()` 构造当前宿主的绝对路径。生产 `createExecutionWorkspaceBinding()` 继续使用宿主 `path.isAbsolute()`，因为 Binding 表达当前 Runner 的真实本机 checkout，而不是可移植的远端路径描述。

备选方案是让生产领域函数同时接受 Windows 和 POSIX 绝对路径。该方案会允许 Linux Runner 接受实际不可访问的 Windows checkout，削弱本地 Binding 真实性，因此不采用。

### 2. Windows 契约显式使用 `path.win32`

`resolveDesktopReceiverDiscoveryRoot()` 描述的是 Windows `LOCALAPPDATA` 与覆盖路径契约，因此使用 `path.win32.isAbsolute()`、`path.win32.resolve()` 和 `path.win32.join()`。这使纯函数在 Linux CI 中仍能验证 Windows 语义，但不启动 Desktop，也不声明 Linux Desktop 支持。

备选方案是只在 Windows runner 执行该测试。它会隐藏纯路径逻辑对宿主平台的意外依赖，因此不采用。

### 3. POSIX 终止结果必须经过有界确认

平台进程适配器在向已核验 identity 的 POSIX 进程组发送 `SIGKILL` 后，以 `kill(-pgid, 0)` 轮询整个进程组直到确认 `ESRCH` 或达到固定上限。leader PID 的 creation identity 只用于发送破坏性信号前的授权，不能在发送后代替 process-group liveness；即使 leader 已退出，只要 descendant 仍使进程组存在就返回保守的 `unknown`。只有整个进程组确认不存在才返回 `terminated`，调用方不得提前释放以该进程树为所有者的恢复语义。

该逻辑留在 `platform/process` 适配器中，领域和 Cordis Service 只消费稳定结果，不感知信号、PID 或轮询。备选方案是仅让测试等待；这会掩盖产品 API “已终止”的虚假确定性，因此不采用。

验证同时使用两层证据：确定性 fake-timer 测试精确构造“leader 已消失但 group 仍存在”的竞态；Linux 集成测试借鉴 Comet `test/platform/process/owned-command-termination.test.ts` 的真实 detached parent/descendant fixture，证明成功结果不会留下仍存活后代。单纯 mock 不能替代真实内核 process-group 行为，单纯集成测试也难以稳定复现 leader 与 descendant 的退出次序。

### 4. 验证证据分层

- 相关 Vitest 用例提供快速 RED/GREEN 回归证据。
- Windows 本地执行完整 `npm run verify`，证明首发平台没有回归。
- GitHub PR 的 Linux `verify` 检查证明干净 checkout 与平台中立测试可执行。
- GitHub 检查结果仍与服务端 required-check 配置分开描述。

本 change 不增加遥测字段；现有验证报告记录命令、退出状态和外部 GitHub 检查链接，不把绝对路径、进程 identity 或日志正文写入 OpenTelemetry。

### 5. 验证报告身份排除宿主传输元数据

托管执行报告需要在 Windows 与 Linux 对同一 npm 包复现相同内容身份。CI 使用 `actions/checkout` 的完整历史，使报告中的 tested implementation commit 可以通过 ancestry 校验；浅克隆不能被解释为报告过期。

包内容身份绑定条目路径、类型、文件字节长度与 SHA-256，以及链接目标，但排除 npm 从宿主文件系统派生的 tar mode、mtime、uid/gid、header 顺序和压缩器细节。tar mode 仍需被解析并校验格式，只是不进入跨平台内容摘要。内容身份 domain 升级为 v2，避免 v1 与新规则产生歧义。

## Risks / Trade-offs

- [风险] 批量替换路径夹具时改变测试所表达的仓库拓扑 → 使用统一路径工厂只替换根路径表示，保留 repository ID、branch、HEAD 和相对层级断言。
- [风险] POSIX zombie/reap 时序使单次 `kill(pid, 0)` 仍报告存在 → 使用条件轮询和固定截止时间，不使用任意长 sleep，也不把超时解释为成功。
- [风险] leader 比 descendant 更早退出造成虚假成功 → 终止前用 leader identity 授权，终止后只用 process-group absence 证明整棵树退出。
- [风险] mock 与真实 POSIX 行为不一致 → 同时保留精确竞态单测和 Comet 式真实父子进程集成测试，finally 路径强制清理所有 PID。
- [风险] npm archive mode 随宿主变化导致报告摘要漂移 → mode 只作格式校验，内容身份保留路径、类型、字节和链接目标约束。
- [风险] `path.win32` 修复被误解为跨平台 Desktop 支持 → 测试和文档明确这是从任意 CI 宿主验证 Windows 路径契约，正式支持范围保持 Windows x64。
- [取舍] 完整 GitHub 验证耗时约数分钟 → 相关测试先快速运行，只有本地全量转绿后才推送触发远端权威检查。

## Migration Plan

1. 先以 Linux CI 失败日志和新增/调整后的跨平台断言保留失败基线。
2. 分别修复测试路径工厂、Windows discovery 路径适配和 POSIX 终止确认。
3. 运行相关测试、完整本地验证并推送当前 PR 分支。
4. 仅在 GitHub Linux `verify` 对新 HEAD 转绿后合入 PR #66。

变更不涉及持久数据或 schema 迁移。若远端验证仍失败，保留 PR 与 change，回退本 change 的实现提交即可；不得绕过失败检查合入。
