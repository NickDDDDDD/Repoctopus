# Proposal

## Why

真实多仓验收在 Build Plan 正确拒绝受保护分支后暴露了一个阻塞恢复缺陷：Runner 按 Runtime 的结构化 finding 为精确 write scopes 准备并公开合法 source branch，但进程重启后调用 `run resume` 时，通用 project reconciliation 把这些预期 branch 变化重新分类为未知 identity drift，并永久设置 `reconciliationRequired`。同一修正通过 `run next` 可以进入 Binding revalidation，通过 `run resume` 却要求恢复旧 checkout 或启动第二个 Run。

这违背现有规范中“同一 Run 建立新 Binding revision、精确失效旧 Plan”的要求，也破坏了 Comet 成熟恢复模型的关键原则：被 lifecycle 明确要求的 workspace 修正应通过显式 rebind/checkpoint 恢复；只有未知漂移才 fail closed。

## What Changes

- 建立单一、领域化的 protected-branch correction classifier，从 rejected Plan candidate、旧 Execution Binding、protected policy 和前后 project snapshots 证明一次 branch 修正是否被当前 lifecycle 精确授权。
- 让 `run next` 与 `run resume` 复用同一 classifier；命中时在同一 Run 派发既有 `build.configure` revalidation，而不是进入通用 reconciliation。
- 允许 Runtime 仅在相同证据仍成立时清除由该缺陷写入的 `reconciliationRequired`，保留拒绝结果、Design approval、Build Strategy、Tasks 和审计轨迹。
- 为进程重启、重复 resume、部分修正及未知 branch/path/remote/topology 漂移增加生产回归，并增加低基数 telemetry 事实。
- 更新 Runtime 恢复文档，明确 Runner 负责 Git 副作用，Runtime 只验证并重绑定。

## Capabilities

### Modified Capabilities

- `managed-work-execution`：使受保护分支修正后的 `resume` 与 `next` 具有相同的同一 Run Binding revalidation 语义。

## Non-Goals

- Runtime 不自动创建、切换或推送 branch/worktree。
- 不放宽 protected branch policy，也不接受任意 branch drift。
- 不把 path、remote、topology、repository add/remove 或无关仓 branch 变化归类为合法修正。
- 不新建 Change Run，不编辑 Store 绕过门禁，也不增加旧版本双读或长期兼容层。

## Upstream Reference

参考 Comet 0.5.1 及其后续公开恢复语义：workspace isolation/binding 是权威身份，预期的人工 workspace 修正通过显式 rebind 恢复既有 workflow/checkpoint，未知漂移继续阻断。Repoctopus 不复制 Comet 的单仓实现，而是在自身多仓、延迟 write-scope 和不可变 Work 模型中用 rejected Plan 证据限定可重绑定仓集合。

## Third-Party and License

本 Change 仅参考 Comet 的公开行为与恢复边界，在 Repoctopus 架构中独立实现，不复制第三方源码或新增依赖。
