# Proposal

## Why

一次全新多仓验收在 Workspace 仍位于目标分支时成功创建了 Change Run，直到 Open Host Outcome 已被接受后，Specification Provider 才以“source 与 target 相同”失败。Runtime 随后把确定性输入错误投影为 Provider 不可用和 `reconcile`，而重新启动又尝试把新 Work 写入旧 Run，导致合法恢复入口不存在；这会让团队在最早阶段被一个本可创建前拒绝的 Run 卡死。

## What Changes

- 在创建任何 Change Run、Work、Skill binding、Desktop activation 或遥测成功事实之前，验证 Workspace checkout 已附着到分支、source 与 target 不同，并且分支事实与冻结的 project snapshot/Workspace Repository 一致。
- 把工作区绑定纳入稳定启动身份：等价启动幂等返回原 Run；不同分支或 project snapshot 的再次启动返回结构化 binding conflict，不生成新 Work、不改写旧 checkpoint。
- 区分确定性输入无效、Provider 确认无效和观察基础设施不可用；只有无法判断外部结果时使用 reconciliation，分支约束失败不得伪装成 `open-observation-unavailable`。
- 让 Open Outcome 已接受后的临时 Provider 故障在原 Outcome、attempt 和 invocation 上重新观察，不重放 Host；确定性规格无效仍通过唯一 Open repair Work 恢复。
- 为启动前拒绝、绑定冲突、Provider 暂时不可用和恢复结果记录有界 trajectory/OTLP 分类，使验收能够证明没有创建幽灵 Run 或重复 Host 调用。
- 增加生产 CLI/服务边界回归：目标分支启动必须在 Run Store 落盘前失败；正确分支启动成功；等价重试幂等；绑定漂移返回冲突；临时 Provider 故障恢复时复用原执行身份。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：补充 Change Run 创建前的工作区绑定前置校验、稳定启动身份、错误分类与同 checkpoint 恢复语义。
- `development-telemetry`：补充启动拒绝、绑定冲突和 Provider 重观察的可审计低基数事实。

## Impact

- 主要影响 `services/workflow-runs.ts` 的 `startChange`、Open Provider 观察与 resume 路径，以及 `domains/runtime/workflow-runs.ts` 的稳定启动身份检查。
- 需要在 Project/Git inspection 边界复用现有规范化 branch facts，不把 checkout 绝对路径写入可移植 Run identity 或遥测。
- CLI 仍由 Agent/Runner 发起，Runner 仍负责创建或切换 branch/worktree；Runtime 只负责在创建 Run 前拒绝不合法绑定，不接管 Git checkout。
- 本次直接交付上述垂直切片；OpenSpec Store 首次注册缺少初始化引导、CLI adapter 选择易用性和 Host consumed-layer 文案作为后续独立 Change，不混入本次 Runtime 原子性修复。
- 参考 Comet `0.5.1` 的 workspace preparation、固定 binding、revision/CAS 与 unknown-outcome 恢复原则；不引入 Comet 运行时依赖、不复制其单仓目录或分支创建职责，MIT 许可证记录保持现有第三方审计边界。
