---
change: stabilize-cross-platform-verification
design-doc: openspec/changes/stabilize-cross-platform-verification/design.md
base-ref: 2c885b75b2edf76b64be86941acb594ed2a152b6
---

# 跨平台验证稳定性实施计划

<!-- comet-task-authority: openspec/changes/stabilize-cross-platform-verification/tasks.md -->

## 目标与边界

本计划修复 PR #66 在 GitHub Linux 干净 checkout 中暴露的三类平台边界错误，同时保持生产 `ExecutionWorkspaceBinding` 对当前宿主真实绝对路径的严格校验。Windows Desktop discovery 只修正 Windows 路径语义，不扩展正式桌面平台；POSIX recovered termination 只在确认退出后报告成功，不改变领域或 Cordis 接口。

Build 使用 `autonomous + tdd + thorough`。测试路径夹具、Windows 路径契约和 POSIX 终止确认分别保存聚焦 RED/GREEN 证据；本地 Windows `npm run verify` 与 PR #66 的 GitHub Linux `verify` 共同构成交付门禁。

## Review Focus

- 路径工厂必须产生当前宿主的绝对路径，但不得访问真实 checkout 或改变 repository identity、相对拓扑、branch、HEAD 与摘要脱敏断言。
- Windows override 中的 `.`、`..` 和混合分隔符必须由 `path.win32` 规范化；相对 override 和相对 `LOCALAPPDATA` 必须继续 fail closed。
- POSIX `SIGKILL` 成功发送不等于进程已退出；确认超时、权限错误或 identity 仍匹配时不得返回 `terminated`。
- Windows `taskkill.exe /t /f` 路径及其结果分类不得被 POSIX 轮询改动。
- 本地绿色不得替代远端干净 checkout；PR 检查必须绑定精确推送 HEAD，失败时不得合入。

## 1. 建立宿主绝对路径测试工厂

<!-- comet-task-ref:ea6fec2c-a4f3-4707-ab89-769878a746d9 -->

新增 `test/helpers/host-path.ts`，导出 `hostAbsolutePath(...segments: string[]): string`，仅使用 `node:path.resolve()` 与 `node:path.join()` 构造确定性的当前宿主绝对路径，不创建目录。先扩展 `test/build-protocol-domain.test.ts` 与 `test/build-strategy-binding-domain.test.ts`，断言 `path.isAbsolute()` 为真且序列化摘要仍不泄露 checkout path；随后让这两个文件统一消费该工厂。

RED：现有固定 Windows 路径在非 Windows 宿主被生产校验拒绝。GREEN：`npx vitest run test/build-protocol-domain.test.ts test/build-strategy-binding-domain.test.ts` 退出 0，Binding 生产代码不变。

## 2. 迁移跨平台 Execution Binding 夹具

<!-- comet-task-ref:66fdae3e-2cc7-44d8-a711-f692b979aa81 -->

在 `test/change-lifecycle-domain.test.ts`、`test/runtime.test.ts`、`test/execution-workspace.test.ts`、`test/authorized-protected-branch-rebind.test.ts` 与 `test/build-orchestration-verification.test.ts` 中，仅把代表本机 checkout 的固定 `C:\\...` / `C:/...` 值替换为 `hostAbsolutePath()`。保留有意验证非法路径、Windows 文本协议或脱敏正则的字面量；多仓父子层级通过工厂参数表达，避免字符串拼接产生宿主错误分隔符。

逐文件运行 Vitest；验收重点是 repository ID、remote identity、worktree identity、branch、HEAD、拓扑与 drift classification 的既有断言完全保持。失败时回退具体夹具，不放宽 `createExecutionWorkspaceBinding()`。

## 3. 固定 Windows discovery 的 RED 契约

<!-- comet-task-ref:c500e361-c794-462a-a256-7d0fd42c8d1b -->

扩展 `test/desktop-receiver-discovery.test.ts`：覆盖 `REPOCTOPUS_DESKTOP_DISCOVERY_ROOT` 的 Win32 规范化、默认 `LOCALAPPDATA\\Repoctopus\\discovery`、相对 override 拒绝和相对 `LOCALAPPDATA` 拒绝。断言使用 `path.win32` 构造期望值，使测试表达 Windows 契约而非 CI 宿主语义。

先在现有实现上运行该文件，保存 Linux 语义下 `node:path` 错判 Windows 绝对路径的 RED；Windows 上若既有正例已通过，则新增规范化断言必须先证明当前实现与明确契约之间的缺口，不能伪造失败。

## 4. 用 `path.win32` 实现 discovery root

<!-- comet-task-ref:85e0f1e4-0652-4e4b-b325-47d193164c56 -->

修改 `app/desktop/host/receiver-discovery.ts` 的 `resolveDesktopReceiverDiscoveryRoot()`：override 使用 `path.win32.isAbsolute()` 与 `path.win32.resolve()`；默认根使用 `path.win32.isAbsolute()` 与 `path.win32.join()`。不改 `DesktopReceiverDiscovery` 的 Windows-only 发布约束，不声明 Linux/macOS Desktop 支持。

运行 `npx vitest run test/desktop-receiver-discovery.test.ts` 确认全部正例、规范化与拒绝分支转绿，并检查构造器既有文件名和安全策略断言未回归。

## 5. 建立 POSIX 有界终止确认的 RED

<!-- comet-task-ref:66d6b6dc-2cc1-4008-a1c1-c22dd67bf0ef -->

扩展 `test/service-recovery.test.ts`，并在需要隔离平台适配器时新增 `test/terminate-process-tree.test.ts`。通过可控的进程/探测边界覆盖两种结果：发送终止后在截止前确认进程组消失应返回 `terminated`；截止前持续存在、权限未知或仍匹配时必须返回 `unknown`。测试使用条件等待和固定短上限，不使用任意长 sleep。

先运行相关 Vitest 保存 RED，确认失败来自当前实现“发送信号即返回成功”，而不是测试进程泄漏；测试 finally 必须清理自己创建的子进程。

## 6. 实现保守的 POSIX 终止结果

<!-- comet-task-ref:8ed392c6-4553-4232-8041-a50ba47d8892 -->

修改 `platform/process/terminate-process-tree.ts`：保留 identity/ownership 前置检查和 Windows `taskkill.exe /pid /t /f` 分支；POSIX 向进程组发送 `SIGKILL` 后，以单调截止时间和短间隔轮询现有进程组探测，只有明确得到不存在才返回 `terminated`，超时、权限不确定或仍存活返回 `unknown`。轮询 helper 保持模块私有，不把 PID、信号或等待策略泄露到领域层。

先运行任务 5 的聚焦测试确认 GREEN，再运行 `npx vitest run test/service-recovery.test.ts`；Windows 路径测试应证明 `taskkill` 调用与分类未变化。若发现 zombie 仍可被 `kill(pid, 0)` 观察，采用现有 ownership inspection 的状态判断，不把额外 sleep 当作产品修复。

## 7. 受影响面与静态质量验证

<!-- comet-task-ref:96a93066-24e0-4c52-8e4b-4a945a89e407 -->

联合运行所有被修改 Vitest 文件，然后运行 `npm run typecheck`、`npm run lint`、`npm run spec:validate` 与 `git diff --check`。核对现有 `product-distribution`、`desktop-observability-dashboard`、`feedback-collection`、`managed-work-execution` 规格已经覆盖行为，因此不创建 delta spec；任何公共行为变化都必须先回到 Design，而不是在 Build 静默扩大范围。

接受：相关测试和四项静态/规格检查退出 0，diff 不包含临时日志、测试进程文件或本机绝对路径。

## 8. 本地 Windows 完整验证

<!-- comet-task-ref:2fe415c6-5063-430e-9cc6-6342dce705d2 -->

在当前 Windows worktree 运行 `npm run verify`，记录精确 HEAD、总测试文件/测试数、跳过项、命令退出码和持续时间，随后运行 `node scripts/build.mjs --check` 证明生成物与输入一致。失败时先重跑最小责任测试并修复，再重新执行完整验证；不得通过删除门禁或削弱断言取得绿色。

本任务只生成验证事实，正式报告在 Verify 阶段写入；临时 stdout/stderr 文件完成诊断后删除。

## 9. 推送并验证 GitHub Linux 门禁

<!-- comet-task-ref:48e16b0c-ae66-4764-a19d-1f0d2ebe95ec -->

提交本 change 的实现与规范产物并立即推送公开分支 `comet/stabilize-cli-distribution-gate`。使用 GitHub 检查 PR #66 的 `verify` 是否针对精确新 HEAD 运行并成功；保存 run/job URL 与结论。远端失败时读取失败日志、回到对应聚焦 RED/GREEN 循环并再次执行任务 7-8，不把旧 HEAD 或本地结果冒充远端证据。

接受：本地与远端 `verify` 都绑定同一提交并退出成功，PR 才具备后续 Archive 与合入条件；branch protection 配置状态与 workflow 成功分别报告。

## 完成顺序

任务 1-2 先消除测试夹具的宿主耦合；任务 3-4 与 5-6 各自保持真实 TDD 循环；任务 7-9 依次收敛本地、完整 Windows 和 GitHub Linux 证据。全部 9 项只在实际证据成立后勾选同一 `tasks.md`，Verify 负责唯一最终集成审查与正式报告。
