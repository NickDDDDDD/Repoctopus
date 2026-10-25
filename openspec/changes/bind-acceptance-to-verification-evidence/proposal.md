# Proposal

## Why

Repoctopus 已建立 `Open → Design → Build → Verify → Archive` 生命周期，但当前 Build 与 Verify 之间仍存在信任缺口：Provider 从 `tasks.md` 读取 `[x]` 后直接形成 `completed` Task，Runtime 只核对 Task revision 和 Evidence Profile 整体结果，不证明每条 Acceptance 都被当前 Receipt 覆盖。自举 Archive 因而可以在正式 Evidence 仅执行 typecheck 与 architecture 的情况下进入终态，而完整 OpenSpec、单元、E2E、package、tracer 和依赖审计只存在于人工执行历史中。

固定 Comet 0.5.0 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` 已提供合适的成熟边界：Classic 把 checkbox 作为稳定 Task 身份下的完成投影，Native 为从规格推导的每条 Acceptance 建立内容身份、完整 Evidence Trace 和 required Receipt 门禁，并在 Archive 前重新核对独立 Verifier、checks 与 Acceptance 覆盖。Repoctopus 应采用这些不变量，同时保持 OpenSpec 四类规划产物和现有多仓 Evidence Profile 权威。

## What Changes

- 为每条官方 Task Acceptance 建立由规范化文本、Task 身份、Requirement mappings 和来源形成的稳定 `acceptanceId`；checkbox 状态不参与身份摘要。
- 把 `[x]` 明确建模为实现完成声明：Runtime 执行产生的声明记录 Work Outcome 来源，启动前已完成的声明记录为 imported claim；二者都不能替代 Verify Evidence。
- 扩展 Evidence Profile 节点，使共享配置显式声明其覆盖的 Acceptance selector；Verification Input 在任何命令执行前解析并固定完整 coverage plan，缺失、未知、重复或仅由可选节点覆盖的 Acceptance fail-closed。
- 扩展 Evidence Bundle，使用实际、当前、verified Receipt 构造顺序无关 Acceptance Trace；每条 passed Acceptance 至少引用一个满足 coverage plan 的 Receipt，Trace 绑定 Acceptance Set、Profile plan、输入指纹和 Bundle。
- Verify Gate 在事务内重新核对 Acceptance Trace 与不可变 Verification Input；普通 Bundle 通过、手工摘要或 checkbox 全部完成均不得绕过覆盖门禁。
- 完成态 Run 不再产生 `archive.prepare` 等下一动作，CLI、Dashboard 和 Telemetry 只投影权威终态。
- 将 Repoctopus 自身正式 `verify` Profile 扩展为能覆盖当前产品验收的完整检查，并用生产组合 E2E 证明真实 Receipt 到 Gate 的闭环。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `specification-authority`: 从唯一 OpenSpec Tasks 权威导出稳定 Acceptance 身份与完成声明来源。
- `implementation-evidence`: 建立 Profile coverage plan、Acceptance Trace 与 Receipt 完整性门禁。
- `change-lifecycle`: 只有覆盖全部 Acceptance 的 Verify Gate 才能进入 Archive，并修复终态下一动作投影。

## Impact

受影响范围包括 Specification Task contract、Verification Input、Evidence Profile 配置、Evidence Bundle/validation/report/retention、WorkflowRuns Verify Gate、CLI/Runtime projection、Telemetry 和相关迁移测试。新增字段使用版本化 schema 并在读取旧活动 Run 或旧 Bundle 时明确要求迁移，不伪造历史 Acceptance Trace。采用 Comet 的行为模型和测试思想，不复制其产品 shell、Classic/Native 双状态根或源码文件，因此不新增许可证文件与运行时依赖。

