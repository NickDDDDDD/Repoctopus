# Design

## Context

当前 `SpecificationTask.acceptanceCriteria` 只是字符串数组，`VerificationInput` 只固定 Task revision 和 Evidence Profile，`EvidenceBundle` 只包含节点 checks。Task checkbox、Work Outcome、Acceptance 和 Receipt 之间没有可验证的闭包。`repoctopus.yaml` 的正式 `verify` Profile 也只包含 typecheck 与 architecture，因此领域状态虽然内部自洽，却不能回答“哪条验收由哪份当前证据证明”。

Comet 的可采用机制分为两层：Classic 使用稳定 Task ID 与 expected revision 更新 checkbox，明确其他 plan checkbox 只是投影；Native 从规范内容生成 Acceptance content identity，构造拒绝未知、重复和缺失项的 Acceptance Trace，并要求 pass 至少具有当前 required-check Receipt。Repoctopus 已有内容寻址 Receipt、不可变 Verification Input 和事务内 Gate，适合在现有模型上增加这一闭包，无需建立第二套 tracker。

## Goals / Non-Goals

### Goals

- OpenSpec `tasks.md` 继续是唯一 Task 与 Acceptance 权威。
- checkbox 只表达 completion claim，不单独授权 Verify 或 Archive。
- 在执行 Evidence 前即可证明 Profile 对全部 Acceptance 有明确覆盖计划。
- 在接受 Gate 前证明每条 Acceptance 都引用了实际产生、当前且 verified 的 Receipt。
- 覆盖声明、执行结果和终态投影均可内容寻址、恢复和审计。

### Non-Goals

- 不创建第二套 spec、ticket、plan 或 implementation notes。
- 不要求每条 Acceptance 都由自动化命令证明；后续 Contributor 可提供静态检查或可信人工证据，但必须产生正式 Receipt。
- 不从测试名称、日志文本或 Agent 摘要猜测语义覆盖。
- 不在本 Change 重构 Archive 文件事务或规格发布隔离；该工作由后续独立 Change 完成。

## Decisions

### 1. Acceptance 使用内容身份

Provider 把每条 Task Acceptance 投影为：

```ts
interface SpecificationAcceptanceCriterion {
  acceptanceId: `acceptance-${string}`;
  taskId: string;
  taskRevision: `sha256:${string}`;
  text: string;
  requirementRefs: string[];
  source: string;
}
```

`acceptanceId` 对规范化后的 `taskId + text + requirementRefs + source` 做带 domain tag 的 canonical SHA-256；checkbox、顺序无关的格式差异和运行状态不参与。Task 文字、Acceptance、Requirement mapping 或来源语义变化会形成新身份并使旧 Verification Input 失效。

### 2. Completion Claim 与验证事实分离

`SpecificationTask.status` 保留用于调度，但增加 `completion`：pending 为 null；Runtime 接受 Work Outcome 后记录 `runtime-work` 来源；启动时从已勾选文档导入则记录 `imported-claim`。导入声明允许避免重复实现，却不得制造 Work Receipt，也不得满足 Acceptance Trace。

Provider 继续只通过 expected taskRevision 的 `completeTask()` 更新 checkbox。Runtime 不从其他 Markdown、Git 提交消息或 Agent 文本推断完成。

### 3. Profile 声明覆盖 selector

Evidence 节点增加 `covers` 字段，selector 支持：

- 精确 `acceptance-<sha256>`；
- `task:<taskId>`；
- `requirement:<capability#requirement>`；
- `*`，表示该节点按团队配置承担当前 Change 的全部 Acceptance。

`*` 是显式共享策略，不是 Runtime 猜测。只有 required 节点可以承担阻断性覆盖。Profile 编译拒绝空 selector、重复 selector 和非法格式；Verification Input 把 selector 解析为有序 `{acceptanceId, nodeIds}` coverage plan，并拒绝未覆盖 Acceptance、未知精确 ID、未知 Task/Requirement selector。

### 4. Bundle 保存实际 Acceptance Trace

Evidence 执行完成后，根据 coverage plan 和实际 Receipt 构造 Trace。一个 Acceptance 只有在 coverage plan 中绑定的全部 required 节点都产生 `verified + fresh/reused + passed` Receipt 时才是 passed；所有匹配 Receipt 都以 `receiptId` 引用。这样一个 Acceptance 可以组合 typecheck、运行时 E2E 与安全审计，而其中任一节点失败、incomplete、superseded 或仅 observed 时，该 Acceptance 都不得 passed。

Trace 记录 Acceptance Set Hash、Verification Input digest、总数、covered/passed/failed/missing 数量和有序 entries。Bundle digest 包含 Trace；verification report 只投影同一 Trace，不维护影子结论。

### 5. Gate 重新绑定不可变输入

EvidenceCoordinator 从当前 Change Run 的 `VerificationInput` 取得 Acceptance 与 coverage plan，并传给 EvidenceService。`projectEvidenceGate()` 只有在原节点聚合结果满足且 Trace 与 input digest/set hash 完全匹配、全部 Acceptance passed 时返回 satisfied。WorkflowRuns 在 RunStore 锁内继续核对 run/action/state/profile/fingerprint/composition，同时增加 Acceptance Trace identity。

独立执行的 Evidence Profile 可以没有 lifecycle Acceptance context；它仍产生普通 Bundle，但不能被 Change Verify Work 接受。

### 6. 终态投影先短路

`lifecycleNextActions()` 和 CLI `nextActions()` 首先检查 `status`。`completed`、`failed` 与 `migration_required` 不产生执行命令；blocked/waiting 只公开对应恢复或决定。该规则由领域投影测试和进程外 CLI 测试固定。

### 7. 自举 Profile 使用真实完整命令

Repoctopus 的 `verify` Profile 改为执行 `npm run verify`，并分别执行 package E2E、tracer E2E 与生产依赖审计；节点通过显式 `covers: ['*']` 承担本仓 Change Acceptance。命令之间按依赖顺序运行，避免多个完整构建并发争用 `dist`。这使正式 Evidence 与项目 Tasks 中声明的发布验证一致。

## Alternatives Considered

### 把每个 `[x]` 当作 Evidence

拒绝。checkbox 没有执行身份、输入指纹、Receipt 或新鲜度，只能表达声明。

### 让所有 required 节点自动覆盖全部 Acceptance

拒绝。typecheck 或 lint 不能自动证明运行时、UI 或安全行为；覆盖必须由共享 Profile 显式声明。

### 在 tasks.md 增加另一套 Evidence 账本

拒绝。会把 OpenSpec Tasks 变成运行结果存储并与 Evidence Bundle 冲突。Tasks 只声明验收，运行结果保存在 Evidence 生命周期。

### 直接复制 Comet Native verification 文档格式

拒绝。Repoctopus 已有通用 Receipt/Bundle/Artifact 模型和可替换 Specification Provider，只采用内容身份、完整 Trace 和 fail-closed 规则。

## Migration and Compatibility

- 新创建 Verification Input 使用 schema v2；旧活动 v1 Change Run 在恢复时进入 `migration_required`，不得用空 Trace 自动升级。
- Evidence Bundle 升级为 schema v2；历史 Bundle 保持只读，可用于审计但不能满足新 Change Verify Gate。
- 独立 Evidence 命令仍可执行没有 Acceptance context 的 Profile；其 Bundle 明确标记 `acceptanceTrace: null`。
- 已归档 Change、Publication Receipt 和历史验证报告不重写。

## Risks / Trade-offs

- `covers: ['*']` 仍依赖团队对 Profile 的正确声明；通过 code review、共享配置摘要和生产自举测试降低风险。
- Acceptance 文本变化会使身份变化并要求重新验证，这是预期的 fail-closed 行为。
- 完整自举 Profile 更慢，但 Verify 是正式门禁而不是快速编辑反馈；快速反馈可以使用另一非终态 Profile。
- 多仓项目可能由不同仓节点覆盖不同 Acceptance；coverage plan 必须保留 repository/node 身份，不能压平为单一命令。

## Verification

- 领域测试覆盖 Acceptance ID 稳定性、语义变化、selector 解析、未知/重复/缺失覆盖和 Trace canonical digest。
- Evidence tests 覆盖 verified/observed、fresh/reused/superseded、required/optional、失败/阻断和 Bundle round-trip。
- lifecycle tests 证明全部 checkbox 已勾选但 Acceptance Trace 缺失仍无法进入 Archive，imported claim 可跳过重复 Build 但不能跳过 Verify。
- 生产组合 E2E 使用真实 EvidenceService、文件 Store、RunStore 和 CLI，从 Change Verify Work 执行完整 profile 并接受 Trace；不得 mock Gate 或 Bundle。
- CLI 测试证明 completed Run 的内部与外部 `nextActions` 均为空。
- 最终运行 `npm run verify`、package E2E、tracer E2E、生产依赖审计、OpenSpec strict、架构和来源检查。
