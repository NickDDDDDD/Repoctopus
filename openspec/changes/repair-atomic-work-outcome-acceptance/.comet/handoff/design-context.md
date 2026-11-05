# Comet Design Handoff

- Change: repair-atomic-work-outcome-acceptance
- Phase: design
- Mode: compact
- Context hash: 024119658210f7edd1f86ce0f836939cec10f5e9d264cb1d7eb228711d3a0876

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/repair-atomic-work-outcome-acceptance/proposal.md

- Source: openspec/changes/repair-atomic-work-outcome-acceptance/proposal.md
- Lines: 1-38
- SHA256: 938ddcb862e9be60e61e3e328b39645c63b68966331a76465a5d0151ae09b549

```md
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

```

## openspec/changes/repair-atomic-work-outcome-acceptance/design.md

- Source: openspec/changes/repair-atomic-work-outcome-acceptance/design.md
- Lines: 1-174
- SHA256: 41ac4eae1ae2250792809ea6c343678be666110a0b39afe0cd3d4a72b484a86b

[TRUNCATED]

```md
---
comet_change: repair-atomic-work-outcome-acceptance
role: technical-design
canonical_spec: openspec
---

# Design

## Context

动机见 `proposal.md`。当前受管 Work 执行链已经区分 Host submission、rejected submission 和 accepted Outcome，但“候选何时可以成为终态 Outcome”仍由两个 Service 分散决定：

- `ManagedWorkExecutor` 负责调用 Host、记录 submission，并通过 Work kind 白名单决定是否立即调用 `WorkDispatcher.acceptOutcome()`；
- `WorkflowRuns` 在后续 `next()` 中解析 Build candidate，执行 Strategy/Binding、Plan、package completion 或 Check evidence 的领域校验，再推进生命周期；
- `WorkExecutionAuthority` 能原子地记录 pending、rejected 或 accepted submission，却不知道当前 Work 的完整领域接受条件。

这使正确 result kind 但错误 `strategyDigest` 的 `execution-binding-candidate` 先进入终态 Outcome，随后才被 `WorkflowRuns` 拒绝。终态 Outcome 不可变，修正版 submission 因而与旧 Outcome 冲突。已有 `repair-build-plan-validation-retry` 的设计已要求“先校验、后终态化”，但实现只覆盖 Plan 主路径；后来 Configure、Binding 和 capability drift 的演进再次暴露了这个未统一的边界。

Comet 0.5.1 的成熟语义是：Runtime 在接受 Outcome 的同一权威边界内完成 contract、schema、step validator 与 transition feasibility 检查；拒绝只记录 rejected Outcome，Action、claim 和 attempt 保持可纠正。Repoctopus 不直接引入 Comet Runtime SDK，因为本产品还要保留多仓 Project Snapshot、Cordis Service、外部 Host、Action Receipt 与可恢复的两阶段副作用；本设计复用的是它的原子接受不变量和 Outcome identity 规则。

当前项目规格 `managed-work-execution` 已覆盖本次行为，因此本 change 使用 `skip_specs`，不创建重复的 delta spec。

## Goals / Non-Goals

**Goals:**

- 为 `build.configure`、`build.plan`、`build.execute` 和 `build.check` 建立唯一的候选处理入口；新增 Build Work 不得通过修改延迟接受名单接入。
- 在任何 accepted Host submission、Action Outcome 或 Receipt 成为终态事实前，完成身份、协议、结构、领域语义、lifecycle Validator 和转换可行性检查。
- 可纠正拒绝保持同一 Work、claim、attempt、checkEpoch、invocation、packet、冻结输入及 Host delegation，只要求新的 submission identity。
- 区分候选错误、Runtime 处理错误和执行结果未知；三者分别进入 correction、可恢复处理和 reconciliation，不互相伪装。
- 内嵌 Host、外部 `work-outcome`、冷启动恢复和幂等重放共享同一处理顺序。
- 保持现有多仓状态、Evidence、Action Receipt 和 OpenTelemetry 语义可验证、可追踪。

**Non-Goals:**

- 不改变 Open、Design、Verify、Archive 的阶段定义，也不增加新的 Work、attempt 或 lifecycle generation。
- 不放宽 Work identity、capability、schema、Strategy、Binding、Plan、Evidence 或 transition guard。
- 不自动修补 Host candidate，不自动重放可能有副作用的 Host 调用。
- 不迁移预发布旧 Run，不修改 Store 绕过保护；Round 8 的卡住 Run仅作为回归证据，修复后使用新 Run 重验。
- 不复制 Comet 源码或引入 Comet Runtime 依赖。

## Decisions

### 1. 使用统一的候选处理管线，而不是 Work-kind 延迟名单

所有成功的受管 Build Host submission 都先停在 `submitted`，再进入由 Runtime 调用的统一处理管线：

```text
Host submission
  -> identity / protocol validation
  -> result schema validation
  -> Work-specific domain validation
  -> lifecycle validator + transition feasibility
  -> disposition
       accepted           -> bind accepted submission / Outcome / Receipt
       correctable        -> reject submission / awaiting-correction
       processing-error   -> retain pending submission / retry processing
```

`ManagedWorkExecutor` 只负责执行或接收 Host payload、验证传输层约束、记录 submission 与执行事实，然后调用同一个候选处理入口。它不再用 `['build.plan', 'build.check']` 或 Configure 特判决定哪些 Work 可以晚接受。

候选处理入口以权威 `WorkDescriptor.kind` 解析对应处理器。Configure、Plan、Execute、Check 都必须显式注册；未知的 Build Work fail closed。处理器返回封闭的 typed disposition，而不是通过抛出的字符串错误推断 correction 或 processing。

**备选方案：**继续为 Configure 增加 digest 特判。改动最小，但下一次新增字段或 Work 仍会重复“先终态、后校验”的缺陷，因此拒绝。

### 2. 采用 Comet 的原子接受不变量，但适配 Repoctopus 的事务边界

Comet 可以在单个 Runtime mutation 中完成 validator 与 transition；Repoctopus 的领域观察可能读取 Specification Provider、Project Snapshot 或平台事实，不能把外部 I/O 放入 Run Store 锁内。因此这里的“原子”定义为：**完整的确定性校验完成前，不写入任何 terminal Outcome；最终 terminal 绑定由一次 guarded commit 完成，并重新核对校验所绑定的全部稳定 digest。**

处理分为两段：

1. 锁外构造不可变的 validation input，读取所需快照并生成 validation result；
2. `WorkExecutionAuthority` 在 guarded commit 内重新核对 `runId + workId + intentId + attempt + checkEpoch + invocationId + submissionId + candidateDigest + stable input digests`，随后一次性绑定 accepted submission、Host Outcome、Action Outcome、Receipt 和 validation fact。

如果锁外校验期间任一稳定输入变化，commit 返回可分类的 stale-validation，不接受旧候选；Runtime 重新观察而不是使用过期结果。外部系统写入或 Host 副作用不在 guarded commit 中发生。

独立 thorough review 进一步收紧这一边界：validation record 采用 schema v2，同时绑定**领域校验开始前捕获的** Run `stateVersion`、完整 lifecycle digest、Project Snapshot digest、Work-specific validation input digest 与待应用 transition digest。领域校验不能以完成后新读到的 Run 作为 CAS 基线。terminal acceptance 前必须再次观察 Specification Task、workspace head、Evidence fingerprint 等外部事实并与 validation input 精确比较；随后 guarded commit 重新核对 Run/lifecycle/Project Snapshot、pending submission、candidate、Action Outcome 和 Receipt 的完整身份。任何一项漂移都保留 pending candidate 并返回 typed stale-validation。后续 observation 仍按既有 drift/invalidation 协议重新观察，不能假装跨 Store 与 Git 存在单事务。

Action Outcome identity 由不随 CAS 重试变化的 Work + submission + candidate identity 确定性派生，不能包含 `stateVersion` 等易变校验元数据。若进程在 Action Receipt 持久化后、Run guarded commit 前退出，即使 stale-validation 使 Run 版本递增，重试仍会请求同一个 Outcome/Receipt identity，Action Store 返回原 Receipt，再尝试唯一的 Run 绑定；不得生成新的随机 Outcome 并遗留第二条终态链。


```

Full source: openspec/changes/repair-atomic-work-outcome-acceptance/design.md

## openspec/changes/repair-atomic-work-outcome-acceptance/tasks.md

- Source: openspec/changes/repair-atomic-work-outcome-acceptance/tasks.md
- Lines: 1-54
- SHA256: f9cb1a031c23d350a48fdaa2382180d8bebbb380d64332caa7bed598fa52c691

```md
# Tasks

## 1. 锁定缺陷与接受边界

- [x] 1.1 在 `managed-change-execution.e2e` 增加 Round 8 回归：`build.configure` 返回正确 result kind 但错误 `strategyDigest`，并验证当前实现会错误终态化；运行 `npx vitest run test/managed-change-execution.e2e.test.ts` 可观察到新增断言先失败。 <!-- comet-task:f1487e82-4388-447a-8b35-6a00092072f8 -->
- [x] 1.2 在 authority/executor 单元测试中固化 terminal acceptance 前不得出现 accepted submission、Host Outcome、Action Outcome 或 Receipt 的不变量；运行 `npx vitest run test/work-execution-submission.test.ts test/managed-work-executor.test.ts` 验证 RED 覆盖完整。 <!-- comet-task:52f937f1-5299-4c08-95a2-42177bb5f078 -->
- [x] 1.3 记录 Configure、Plan、Execute、Check 现有接受入口和旧特判清单到 `design.md`，并运行 `rg -n "acceptOutcome|rejectInvalidConfigureResult|build\.plan.*build\.check" services` 确认没有遗漏的生产入口。 <!-- comet-task:267276ab-5fb7-4dca-9a0e-cbea05bf669c -->

## 2. 建立统一候选处理协议

- [x] 2.1 在领域层定义封闭的 accepted、correctable rejection、processing error disposition 及稳定 validation record；运行 `npm run typecheck` 验证所有分支穷尽处理。 <!-- comet-task:ab441f6d-96e8-4eb6-94d8-0bf4a3a8474c -->
- [x] 2.2 为 Build Work 建立按权威 `WorkDescriptor.kind` 解析的处理器注册表，未注册 Build Work fail closed；运行对应领域单元测试验证四种 Work 均已注册且未知 kind 被拒绝。 <!-- comet-task:d7cda0b9-7959-4739-a422-e8d432c3bd3f -->
- [x] 2.3 实现统一 acceptance coordinator，按身份/协议、schema、领域、lifecycle validator、transition feasibility 的顺序处理 pending submission；运行 coordinator 单元测试验证任一前置失败都不会调用 terminal bind。 <!-- comet-task:02ecb5ed-c02b-40fe-9e64-747ee14673df -->
- [x] 2.4 扩展 `WorkExecutionAuthority` 的 guarded terminal commit，使其重新核对 Work、claim、attempt、checkEpoch、invocation、submission、candidate 与稳定输入 digest；运行 `npx vitest run test/work-execution-submission.test.ts` 验证漂移 fail closed、合法记录一次性绑定。 <!-- comet-task:23e3a1ff-fffb-49bd-a80e-19bd7ddf1dd9 -->
- [x] 2.5 将 processing error 与 correctable rejection 分离：前者保留 pending，后者进入 `awaiting-correction` 并追加有界历史；运行 submission/recovery 单元测试验证两者状态、history 与 continuation 不混用。 <!-- comet-task:10b26d88-387a-4408-85ce-258ef456698a -->
- [x] 2.6 验证相同 submission ID + 相同 digest 幂等、同 ID + 不同 digest 冲突、新 ID 可纠正；运行 `npx vitest run test/work-execution-submission.test.ts test/work-execution-recovery.test.ts` 通过。 <!-- comet-task:b903de32-95dd-499e-962a-d4cff603d0f9 -->

## 3. 交付 Configure 垂直切片

- [x] 3.1 实现 Configure 处理器，对 `execution-binding-candidate` 的 schema、Strategy identity/digest、仓库集合和 Binding 构造约束做完整校验；运行 Configure 领域测试覆盖结构错误与语义错误。 <!-- comet-task:0a5a1863-1c9d-4bc3-afd4-e03157f1c3a1 -->
- [x] 3.2 将内嵌与外部 Configure submission 接到统一 coordinator，删除 `rejectInvalidConfigureResult()` 和 Configure 的早期 `acceptOutcome()`；运行 `rg -n "rejectInvalidConfigureResult" services` 无结果且 executor 单元测试通过。 <!-- comet-task:2d837b06-5f0c-4c0e-93a8-c546e8e11b52 -->
- [x] 3.3 让 Round 8 错 digest 候选返回结构化 `awaiting-correction`，保持同一 Work/claim/attempt/checkEpoch/invocation/packet；运行新增 E2E 验证全部 identity 未变化。 <!-- comet-task:a4824a9d-3ab9-48a3-ac74-9091f20643d1 -->
- [x] 3.4 使用新 submission ID 提交修正版 Configure candidate，并验证它被接受后只创建一个 Binding、一个 Plan Work；运行 `npx vitest run test/managed-change-execution.e2e.test.ts` 通过。 <!-- comet-task:85d81440-31df-4e60-aa6e-b1c27edb4b14 -->
- [x] 3.5 覆盖 terminal commit 前中断和接受后、lifecycle observation 前中断的冷启动恢复；运行 `npx vitest run test/work-execution-recovery.test.ts test/managed-change-execution.e2e.test.ts` 验证不重调 Host、不新增 Work/attempt。 <!-- comet-task:3ca04124-3601-493f-8978-8dd5f3cdbc52 -->

## 4. 统一其余 Build Work

- [x] 4.1 将 Plan 的 candidate 构造、Plan Evidence、领域校验与 lifecycle validator 接到统一处理器，并删除 executor 的 Plan 延迟名单分支；运行 Plan rejection/correction 与受保护分支 E2E 通过。 <!-- comet-task:36fc536f-cbb7-4fe2-afa6-784a48a4649a -->
- [x] 4.2 将 Execute package completion 接到统一处理器，同时保留 workspace checkpoint 和外部副作用 journal 的两阶段消费；运行 Execute 中断点与恢复测试验证不会重复提交或重复 Host 副作用。 <!-- comet-task:604296b0-f4c2-45bb-8897-19cbaf5d4f6e -->
- [x] 4.3 将 Check candidate/evidence 接到统一处理器，并删除 executor 的 Check 延迟名单分支；运行 Check rejection/correction 与 Verify 输入测试通过。 <!-- comet-task:10d9ff1b-2853-4ce9-ba69-43fe8b5f1693 -->
- [x] 4.4 对 Configure、Plan、Execute、Check 增加 schema、语义、validator、transition infeasible 矩阵测试；运行相关 Build protocol 与 managed execution 测试，验证所有拒绝均发生在 terminal acceptance 前。 <!-- comet-task:0f8560bc-e38f-47e5-b680-920305c3f88a -->
- [x] 4.5 删除所有按 Work kind 决定“立即/延迟 accept”的生产条件，改为注册表穷尽检查；运行 `rg -n "build\.plan.*build\.check|build\.check.*build\.plan" services/managed-work-executor.ts` 无旧名单结果并通过 `npm run typecheck`。 <!-- comet-task:346693b7-c742-455b-acd0-32fcd0a3b38a -->

## 5. 入口、恢复与遥测一致性

- [x] 5.1 让内嵌 Host、外部 `work-outcome` 和已知 candidate 的恢复入口共享同一 coordinator；运行外部 CLI 与 managed execution E2E 验证 disposition、diagnostic 和 identity 一致。 <!-- comet-task:d4cd08b5-1622-4d46-af30-d119df92d3d0 -->
- [x] 5.2 验证 pending/rejected candidate 不会进入 `not-executed` reconciliation，只有未知执行结果使用 reconciliation；运行 `npx vitest run test/work-execution-recovery.test.ts` 通过。 <!-- comet-task:8e1feeef-c6fb-434c-8351-4145260e64cb -->
- [x] 5.3 为 accepted、rejected、processing error、validator 和 continuation 补齐一次性 OpenTelemetry 断言，禁止 payload/自由文本成为 label；运行 `npx vitest run test/telemetry-mapping.test.ts` 通过。 <!-- comet-task:e49aeb06-6b69-41a7-ab16-e9a2d0d0e9ce -->
- [x] 5.4 验证多仓 Project Snapshot、Strategy、Binding、Plan 和 workspace checkpoint digest 在恢复前后保持绑定；运行多仓 managed execution E2E 通过。 <!-- comet-task:b6480ce8-12b7-49fb-a14a-bae722d75d9b -->
- [x] 5.5 更新正式 Runtime/Host 协议文档，说明统一接受顺序、纠正 identity 与 processing/reconciliation 区别；运行 `npm run check:managed-execution-report` 和文档内命令验证通过。 <!-- comet-task:83f2fd84-791f-404a-ae5d-48e55d753c5a -->

## 6. 综合验收

- [x] 6.1 运行定向回归 `npx vitest run test/work-execution-submission.test.ts test/managed-work-executor.test.ts test/work-execution-recovery.test.ts test/managed-change-execution.e2e.test.ts test/telemetry-mapping.test.ts` 并记录 Evidence。 <!-- comet-task:c351caf8-aefe-468a-8c3d-eeefd7e36e93 -->
- [x] 6.2 运行 `npm run typecheck && npm run lint && npm run check:architecture && npm run check:provenance`，确认领域、Service、Engine 与平台适配器边界无违规。 <!-- comet-task:2763104c-fc1d-4ee9-b831-8f54e69496f7 -->
- [x] 6.3 运行 `npm run verify`，确认全量测试、生成物、品牌、架构、来源、OpenSpec 与报告检查全部通过。 <!-- comet-task:657897f5-6ef0-47f0-9d71-764748fc6679 -->
- [x] 6.4 使用新的多仓 acceptance Run 重放 Round 8 场景，验证错误 Configure candidate 可在同一 invocation 纠正并继续至 Archive；保存 Run/Work/submission/Evidence/phase 遥测，旧卡住 Run 保持未修改。 <!-- comet-task:4fa9a8d2-91fc-44cf-a0c9-a1de20ecb525 -->
- [x] 6.5 对照 Comet 0.5.1 固定源码复核 Outcome identity、拒绝与恢复语义，并运行 `npm run check:upstream`；若权威资料冲突则停止交付并回到 Design。 <!-- comet-task:ef8a4b65-0a61-47c4-8253-f17a83b3ed61 -->
- [x] 6.6 完成独立 thorough review，修复高优先级 finding 后重新运行受影响测试，并将最终结论写入正式验证报告。 <!-- comet-task:2d22d4cc-6da9-45d6-9c03-127b3df9a852 -->

## Workflow follow-up

- 在正式验证和人工批准完成后归档该 change。
- 合入并发布分支后，从干净 checkout 验证归档结果和新的多仓 acceptance Run。

```

## openspec/changes/repair-atomic-work-outcome-acceptance/.openspec.yaml

- Source: openspec/changes/repair-atomic-work-outcome-acceptance/.openspec.yaml
- Lines: 1-3
- SHA256: 33aa04d9a957ff55fa34f28d70076b6c9fe609779912961844af9ee5b854ea65

```md
schema: spec-driven
created: 2026-11-05
skip_specs: true

```
