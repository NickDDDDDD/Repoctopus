# Proposal

## Why

现有 Runtime 已把 Host submission、rejected submission 与 accepted Outcome 建模为不同事实，但各 Build Work 仍通过分散的条件决定何时终态化 Outcome。`build.configure` 因而能在只通过 result kind 检查后提前绑定终态 Outcome，随后才被 Strategy digest 语义校验拒绝，导致原 claim 和 invocation 永久失去合法纠正入口。

## What Changes

- 采用固定 Comet 0.5.1 的成熟不变量：Host candidate 在同一受管 acceptance boundary 内依次通过协议、结构、领域、Validator 与 transition feasibility 校验后，才可绑定为终态 Outcome。
- 将 Configure、Plan、Execute 与 Check 的候选处理统一为一个提交处置协议，移除按 Work kind 分散决定是否提前接受 Outcome 的字符串特判。
- 可纠正拒绝保留原 `workId`、claim、attempt、`checkEpoch`、packet、Host invocation 与冻结输入，追加不可变 rejected submission，并允许新的 submission identity 在同一 invocation 下修正。
- processing error、未知执行结果与可纠正 candidate rejection 保持不同恢复语义；不得把确定的错误候选投影为 reconciliation、Binding drift 或新的 Work attempt。
- 以 TDD 补齐结构错误、语义错误、Validator 拒绝、processing error、幂等/冲突、进程重启及内嵌/外部 Host 一致性的领域、Service 和生产 CLI 黑盒回归矩阵。
- 保留当前 Round 8 卡住的 Run 作为只读缺陷证据；修复后以新的验收 Run 重跑，不为预发布 Run 增加一次性迁移或 Store 手术。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。`managed-work-execution` 已经要求所有结构、领域和 Validator 拒绝在终态 Outcome 前进入可纠正 submission 协议；本 change 修复实现与既有规格不一致，因此通过 `.openspec.yaml` 的 `skip_specs: true` 明确不创建重复 delta spec。

## Impact

- 主要影响 `services/managed-work-executor`、`services/work-execution-authority`、`services/workflow-runs`、Work result validator/dispatcher 边界和相应领域类型。
- 外部 `work-outcome` 协议的身份字段与 CLI 形态保持不变；正确候选的用户可见行为不变，错误候选从永久冲突修正为结构化 `awaiting-correction`。
- 不改变 Open → Design → Build → Verify → Archive 五阶段、Build Strategy、ExecutionBinding、OpenSpec Tasks 权威或现有 telemetry 事件语义。
- Comet 0.5.1 仅作为行为参考；不复制新增第三方源码，不改变 MIT 许可证或现有 provenance 边界。
- 本次交付覆盖完整原子 acceptance 修复与验证；后续若新增 Work result 类型，必须注册到同一 validator 边界，不再扩展 Work-kind 特判。

## 非目标

- 不放宽 result schema、领域 Validator、Skill consumption、能力、Workspace 或生命周期 Guard。
- 不自动修改 Host candidate，不重放可能有副作用的 Host 调用，不为 candidate correction 创建新 Work 或新 attempt。
- 不兼容修复前已经错误终态化的预发布 Run，不新增 generation、daemon 或第二套 Outcome 权威。
