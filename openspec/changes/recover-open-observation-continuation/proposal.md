# Proposal

## Why

全新多仓验收在 Open Host Outcome 已接受后复现了一个真实恢复断点：第一层 OpenSpec inspection 与 strict validation 均成功，Runtime 已把 `change.intake` Work 标记为 `validated`；随后第二层 published branch / planning approval observation 因 GitHub 短暂连接超时返回 `open-observation-unavailable`。网络恢复后，`run next` 只识别 `outcome` 为可重新验证状态，面对 `validated + reobserve` 反而提示再次执行 Open Work，使原 Work、Outcome 与 invocation 落入不可达状态。

现有回归没有覆盖这个窗口。它只在第一层 `specification.inspect` 失败，此时 Work 仍为 `outcome`，下一次 pull 可以再次进入 `validateOpenWork`；因此测试通过并不能证明“validation 已接受、planning observation 才失败”的恢复路径可达。

同一验收还证明通用 `run resume` 不能作为替代入口：Open Work 正常写入并提交规格后，仓库 HEAD 相对 Run 启动快照发生变化，resume 把该内容变化直接提升为全局 `reconciliationRequired`，要求恢复旧仓库或重启 Run。这样 Runtime 自己授权的正常工作也会阻断当前 continuation。

## What Changes

- 让 Open 推进以持久化 Work execution checkpoint 为权威：`outcome` 进入 Outcome validation，`validated` 直接进入 Open gate observation；不得从 phase/current Work 标签猜测应重放 Host。
- 让第二层 published branch / planning observation 暂时失败后，下一次受保护 `run next` 在同一 Work、attempt、checkEpoch、Outcome 与 invocation 上重新观察；成功后继续创建唯一 Open Human Decision。
- 保持 `run resume` 只恢复事务并投影当前 continuation，不把内容级 HEAD/worktree 变化自动升级为全局 reconciliation；真正的仓库 identity、branch、remote、path 或 topology 漂移仍 fail closed。
- 将 Project snapshot 差异分为 `same | content | identity`。内容变化继续由当前阶段的 planning、binding、Evidence 或 closure authority 精确重验；identity 变化才设置全局 `reconciliationRequired`。
- 修正 CLI/Service 的下一步投影：内容变化可以保留 `reobserve`/当前 Work；identity 漂移才要求人工 reconciliation 或重新开始。
- 增加两阶段 Open observation、resume content drift、真实 identity drift、重复 pull/CAS 和遥测回归，证明 Host 不重放、repair Work 不误建、人工审批不重复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：补充已验证 Open Work 的第二层 observation checkpoint、可达 reobserve 与幂等推进语义。
- `runtime-foundation`：把恢复时的仓库内容变化与身份/拓扑变化分级，避免通用 resume 覆盖当前阶段的精确恢复权威。
- `development-telemetry`：为 Open reobserve 阶段与 Project drift class 提供有界、可重放的观测分类。

## Impact

- 主要影响 `services/workflow-runs.ts` 的 Open continuation 路由、`domains/runtime/workflow-runs.ts` 的 resume 决策、`domains/project/snapshot.ts` 的 reconciliation 分类，以及 CLI next-action 投影。
- 不修改旧 Run Store、不引入兼容 migration、不重放已接受 Host Outcome；当前验收 Run 保留为只读缺陷证据，修复后用新的 Change identity 重跑。
- 不解决本轮同时发现的 OpenSpec Store 首次初始化、失败后重复项目审批、CLI 诊断过于笼统、adapter 默认值与 consumed-layer 文案问题；这些保留为后续独立项，避免扩大核心恢复修复。
- 参考 Comet `0.5.1` 的成熟边界：Run view 由持久化 Action status 选择 continuation，resume 读取同一 Run 并返回当前 Action，只有未知外部执行才进入 reconcile。Repoctopus 采用这些状态权威与身份分离原则，但保留自己的多仓 Project snapshot、OpenSpec Provider、Cordis composition 与五阶段生命周期，不引入 Comet SDK 运行时依赖。

