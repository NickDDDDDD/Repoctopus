# Comet Design Handoff

- Change: stabilize-cross-platform-verification
- Phase: design
- Mode: compact
- Context hash: e0528c19ba08f2aab10458b3bd1d67e72a9194486d40e1628751a5afef24e684

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-cross-platform-verification/proposal.md

- Source: openspec/changes/stabilize-cross-platform-verification/proposal.md
- Lines: 1-30
- SHA256: 360f69c39cce56dede2abb60aefa90d2bb720034a7aa65c43ba95a8e7854eaec

```md
# Proposal

## Why

PR #66 首次在 GitHub Linux 干净 checkout 中执行完整验证时暴露 39 个失败：部分测试夹具把 Windows 路径误当作跨平台绝对路径，Windows Desktop discovery 使用了宿主路径语义，POSIX 恢复终止在进程真正退出前就报告成功。当前实现因此尚未满足已经归档的 `product-distribution`、`desktop-observability-dashboard`、`feedback-collection` 与 `managed-work-execution` 需求。

## What Changes

- 将涉及 Execution Binding 的纯领域测试夹具改为使用当前宿主生成的绝对路径，保留生产校验只接受当前宿主真实绝对路径的边界。
- 让 Windows Desktop discovery 明确使用 `path.win32` 解析 `LOCALAPPDATA` 和显式覆盖路径，不因 CI 宿主为 Linux 而改变 Windows 契约。
- 让 POSIX 恢复终止在有界时间内确认进程组退出后才报告 `terminated`，未知或未退出状态保持保守结果。
- 增加最小回归测试，并以本地 Windows 验证和 GitHub Linux `verify` 检查共同证明修复。
- 不改变 CLI、配置 schema、OpenSpec 需求、Repoctopus Runtime 状态机或桌面正式支持平台。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本次是实现与测试可移植性修复；既有规格已经要求干净 checkout 完整验证、Windows Desktop 路径边界、自有进程树安全终止和本地 Execution Binding。

## Impact

- 受影响代码：Execution Binding 测试夹具、Desktop receiver discovery 路径解析、POSIX 进程树终止确认。
- 受影响验证：GitHub Linux `npm run verify`、本地 Windows 相关测试与完整验证。
- 不新增第三方依赖或第三方源码，不产生额外许可证影响。
- 本次可交付切片仅让现有 PR 的跨平台验证契约真实转绿；Linux/macOS Desktop 正式支持、CI 矩阵扩展和 Runtime 功能增强均不在范围内。

```

## openspec/changes/stabilize-cross-platform-verification/design.md

- Source: openspec/changes/stabilize-cross-platform-verification/design.md
- Lines: 1-66
- SHA256: f606f7699816345d2a3e9c4afd5e47af9d91915e887525edaa3b27f2667e4df7

```md
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

平台进程适配器在向已核验 identity 的 POSIX 进程组发送 `SIGKILL` 后，轮询进程组/进程所有权直到确认退出或达到固定上限。确认退出返回 `terminated`；超时、权限不足或仍匹配时返回保守的 `unknown`，调用方不得提前释放以该进程为所有者的恢复语义。

该逻辑留在 `platform/process` 适配器中，领域和 Cordis Service 只消费稳定结果，不感知信号、PID 或轮询。备选方案是仅让测试等待；这会掩盖产品 API “已终止”的虚假确定性，因此不采用。

### 4. 验证证据分层

- 相关 Vitest 用例提供快速 RED/GREEN 回归证据。
- Windows 本地执行完整 `npm run verify`，证明首发平台没有回归。
- GitHub PR 的 Linux `verify` 检查证明干净 checkout 与平台中立测试可执行。
- GitHub 检查结果仍与服务端 required-check 配置分开描述。

本 change 不增加遥测字段；现有验证报告记录命令、退出状态和外部 GitHub 检查链接，不把绝对路径、进程 identity 或日志正文写入 OpenTelemetry。

## Risks / Trade-offs

- [风险] 批量替换路径夹具时改变测试所表达的仓库拓扑 → 使用统一路径工厂只替换根路径表示，保留 repository ID、branch、HEAD 和相对层级断言。
- [风险] POSIX zombie/reap 时序使单次 `kill(pid, 0)` 仍报告存在 → 使用条件轮询和固定截止时间，不使用任意长 sleep，也不把超时解释为成功。
- [风险] `path.win32` 修复被误解为跨平台 Desktop 支持 → 测试和文档明确这是从任意 CI 宿主验证 Windows 路径契约，正式支持范围保持 Windows x64。
- [取舍] 完整 GitHub 验证耗时约数分钟 → 相关测试先快速运行，只有本地全量转绿后才推送触发远端权威检查。

## Migration Plan

1. 先以 Linux CI 失败日志和新增/调整后的跨平台断言保留失败基线。
2. 分别修复测试路径工厂、Windows discovery 路径适配和 POSIX 终止确认。
3. 运行相关测试、完整本地验证并推送当前 PR 分支。
4. 仅在 GitHub Linux `verify` 对新 HEAD 转绿后合入 PR #66。

变更不涉及持久数据或 schema 迁移。若远端验证仍失败，保留 PR 与 change，回退本 change 的实现提交即可；不得绕过失败检查合入。

```

## openspec/changes/stabilize-cross-platform-verification/tasks.md

- Source: openspec/changes/stabilize-cross-platform-verification/tasks.md
- Lines: 1-27
- SHA256: f359d68dec121b0fcfd26507397427884a825e9fd50ca6ca2145d03246fbfff0

```md
# Tasks

## 1. 平台中立的 Execution Binding 测试夹具

- [ ] 1.1 增加统一的宿主绝对路径测试工厂，并用 `vitest run test/build-protocol-domain.test.ts test/build-strategy-binding-domain.test.ts` 验证其在当前宿主生成 `path.isAbsolute() === true` 的路径且不改变语义摘要断言 <!-- comet-task:ea6fec2c-a4f3-4707-ab89-769878a746d9 -->
- [ ] 1.2 将 lifecycle、runtime、workspace、protected-branch 与 orchestration 测试中的固定 Windows checkout 替换为同一工厂，并用对应 Vitest 文件验证 repository ID、拓扑、branch、HEAD 与漂移分类断言保持不变 <!-- comet-task:66fdae3e-2cc7-44d8-a711-f692b979aa81 -->

## 2. Windows Desktop discovery 路径语义

- [ ] 2.1 以现有 Windows 路径用例作为回归基线，补充 override 规范化与非绝对路径拒绝断言，并确认未修实现会在非 Windows `node:path` 语义下失败 <!-- comet-task:c500e361-c794-462a-a256-7d0fd42c8d1b -->
- [ ] 2.2 将 discovery root 计算限定为 `path.win32`，并用 `vitest run test/desktop-receiver-discovery.test.ts` 验证 `LOCALAPPDATA`、override 和拒绝分支 <!-- comet-task:85e0f1e4-0652-4e4b-b325-47d193164c56 -->

## 3. POSIX recovered termination 确认

- [ ] 3.1 为 POSIX 终止增加有界确认测试，覆盖确认退出与截止时间内仍存活两种结果，并用相关 Vitest 用例保存 RED 证据 <!-- comet-task:66d6b6dc-2cc1-4008-a1c1-c22dd67bf0ef -->
- [ ] 3.2 在 `platform/process` 实现条件轮询，使 `terminated` 只在确认退出后返回，超时保持保守结果；用进程树与 managed service recovery 测试验证 GREEN 且不改变 Windows `taskkill` 路径 <!-- comet-task:8ed392c6-4553-4232-8041-a50ba47d8892 -->

## 4. 集成验证与 PR 门禁

- [ ] 4.1 运行受影响测试集合、`npm run typecheck`、`npm run lint` 与 `npm run spec:validate`，确认本 change 与既有规格一致 <!-- comet-task:96a93066-24e0-4c52-8e4b-4a945a89e407 -->
- [ ] 4.2 运行本地 Windows `npm run verify`，记录完整测试数量、跳过项与退出状态到正式验证报告 <!-- comet-task:2fe415c6-5063-430e-9cc6-6342dce705d2 -->
- [ ] 4.3 推送当前公开分支并确认 PR #66 的 GitHub Linux `verify` 对精确新 HEAD 成功；检查仍失败时保留 change 开放并按失败证据修复，不绕过门禁合入 <!-- comet-task:48e16b0c-ae66-4764-a19d-1f0d2ebe95ec -->

## Workflow follow-up

- Verify 通过并完成独立审查后归档本 change。
- PR #66 远端检查转绿后再合入 `main`，随后从最新 `main` 启动全新模拟多仓验收。

```

## openspec/changes/stabilize-cross-platform-verification/.openspec.yaml

- Source: openspec/changes/stabilize-cross-platform-verification/.openspec.yaml
- Lines: 1-3
- SHA256: 33aa04d9a957ff55fa34f28d70076b6c9fe609779912961844af9ee5b854ea65

```md
schema: spec-driven
created: 2026-11-05
skip_specs: true

```
