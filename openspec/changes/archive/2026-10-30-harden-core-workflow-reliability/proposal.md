# Proposal

## Why

连续的全流程自举暴露出三类会破坏工作流可信度的核心缺陷：中断恢复会用已被当前 Work 合法修改的内容重组执行包，Open Gate 会把 Provider 明确跳过的工件误判为缺失，Provider 的 `info` 诊断会被错误升级为 `error`。这些问题使真实成功的工作被阻塞、状态与遥测互相矛盾，必须在团队使用前统一修正权威事实边界。

## What Changes

- **BREAKING**：为受管 Work 引入不可变、内容寻址的私有执行包存储；Run checkpoint 继续只持久化 packet identity，恢复、Host reconcile 和 Outcome 消费必须读取并验证原 packet，不再从可变项目状态重组旧 attempt。
- **BREAKING**：扩展 Specification Provider 的规范化工件状态，区分 `ready`、`skipped` 与 `missing`；Provider 明确且可验证的 `skipped` 是已满足状态，Workflow Gate 不再硬编码“必须存在四个文件”。
- **BREAKING**：完整保留 Provider 的 `info`、`warning`、`error` 诊断严重级别，并建立“有效校验不得包含 error”的领域不变量；未知严重级别继续 fail closed。
- 为 packet 恢复、Provider 工件满足方式和诊断归一化增加低基数遥测与真实重启/严格校验验收，确保 Dashboard 和事后审计能区分恢复、跳过、缺失及 Provider 契约冲突。
- 不兼容读取旧的仅 identity 执行 checkpoint；预发布旧 Run 明确返回 migration required，不增加双读、generation 或静默重组兼容层。
- 本次只借鉴 Comet 0.5.1 的 reserve/execute/commit、observe-before-repair 和未知结果不重放原则，不引入 Comet SDK、状态目录或源码，因此不新增第三方许可证义务。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `managed-work-execution`: 让已领取 Work 的完整冻结 packet 成为可恢复内容，并用同一 packet 约束 Host、Outcome 与断点恢复。
- `specification-authority`: 让 Provider 通过稳定领域契约表达工件满足状态和完整诊断严重级别，消除 Workflow 对 OpenSpec 输出的二次猜测。
- `change-lifecycle`: 让 Open/Design Gate 消费 Provider 的规范化满足事实，并在真实中断恢复中保持同一 Work attempt。

## Impact

- 影响 `domains/work-execution`、`domains/specification`、Run checkpoint schema、planning approval 与生命周期 Gate。
- 新增 WorkExecutionPacket 内容存储端口及文件实现，并调整 dispatcher、managed executor、recovery、应用组合与清理策略。
- 调整 OpenSpec Provider 对 `status --json` 和 `validate --json` 的归一化，以及相关 fixture、单元测试、重启纵切测试和遥测断言。
- 旧预发布活动 Run 若没有完整 packet 内容，恢复时会得到明确迁移诊断；不会伪造成功、重放 Host 或修改 Store 绕过。
- 不改变 OpenSpec 四份规划产物、Store 多仓模型、Runtime-authoritative 状态推进或现有 Skill 组合边界。
