# Proposal

## Why

真实多仓验收在重新规划 Build 时暴露了一个核心恢复缺陷：同一外部 Runner 在 `build.plan` Work 只声明当前只读工作所需能力后，Runtime 接受了 claim 和结构化 Plan submission；随后 `run next` 在识别 Execution Binding capability drift 之前直接断言完整执行能力，抛出 `Execution Binding requires process.execute, repository.write`。该 Run 已有权威 claim 和 submission，不能通过新 attempt 或 reconcile 合法恢复。

这违背 Repoctopus 已采用的 Comet checkpoint 原则：Host/Binding 身份变化应使依赖旧 Binding 的 checkpoint 精确失效并回到 Configure，未知或不兼容结果才停止；恢复路径不得把可分类漂移变成 Store 手改或第二个 Run。

## What Changes

- 把 Execution Binding Host capability 检查改成无异常的漂移分类：能力缺失或摘要变化先归类为 `capability` drift，而不是提前抛错。
- 让 Build Plan、Execute 和 Check 的已提交 Outcome 在接受前统一先执行 Binding drift 判定；命中后保留历史 claim/submission，精确失效依赖旧 Binding 的当前 Work，并派发 `build.configure`。
- 保持 claim 的 Work capability 门禁：Host 仍必须满足当前 Work 自身能力，但 Plan 的只读能力声明不得被误当成现有 Binding 仍然有效。
- 增加真实失败形态、进程重启、重复 `next` 和负例回归，证明同一 Run 可恢复且不会重复 Host 副作用。
- 用修复后的产品恢复保留的 round4 验收 Run，再继续两包纵向 TDD 验收；若 composition compatibility 不允许恢复，则保留正式诊断并启动完全相同的新 Run。

## Capabilities

### Modified Capabilities

- `managed-work-execution`：使 Build Host capability drift 在已提交 Outcome 的 checkpoint 边界可分类、可恢复且保持同一 Run 审计历史。

## Non-Goals

- 不放宽当前 Work 的 capability、write scope 或 side-effect 门禁。
- 不允许 Agent/Runner 直接选择 phase 或跳到 Configure。
- 不通过修改 Run Store、覆盖旧 claim、伪造 Outcome 或创建兼容 fallback 恢复。
- 不改变 Build Strategy 语义，也不因机器能力变化重新请求 Design Human Decision。
- 不把本修复扩展为任意 Host 热迁移、后台 daemon 或多 Runner 调度系统。

## Upstream Reference

采用 Comet 成熟的 Runtime-authoritative checkpoint/rebind 思路：执行 Host 的观察身份与冻结 Binding 不一致时，Runtime 保留旧执行事实并回到显式配置 checkpoint；只有通过新 Binding 后才重新规划。Repoctopus 在自身不可变 Work、外部 Host、OpenSpec 和多仓 Binding 架构中独立实现，不复制 Comet 的单仓状态格式或 SDK。

## Third-Party and License

本 Change 只参考 Comet 的公开行为不变量并在 Repoctopus 架构中独立实现，不复制第三方源码、不新增依赖，许可证边界不变。
