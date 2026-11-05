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

**备选方案：**把完整 Build 领域校验下沉到 `WorkExecutionAuthority`。这会让 Store authority 依赖 Specification、Project Snapshot 和 Build orchestration，破坏领域边界，故拒绝。

### 3. Work-specific 处理器拥有完整接受条件

统一管线只规定顺序和 disposition，各 Build Work 的领域处理器保持明确职责：

- `build.configure`：要求 `execution-binding-candidate`，核对 schema、Strategy identity/digest、仓库集合、checkout/worktree 与 Binding 构造约束；只有能形成当前 Strategy 的合法 `ExecutionBinding` 才可接受。
- `build.plan`：要求 `build-plan-candidate`，构造 Plan/Evidence，校验 Task、write scope、受保护分支、composition、Binding、报告 owner 与风险决策约束。
- `build.execute`：要求 package completion，先校验 package identity、Task revision、接受证据、workspace checkpoint 和当前 Plan invalidation，再执行既有两阶段消费；不得因统一入口而合并或跳过副作用检查点。
- `build.check`：要求 Check candidate/evidence，校验 package completion、测试与 review evidence、当前 head/checkpoint、Plan 和 Strategy 绑定，再形成 Verify 输入。

每个处理器返回确定性的 validation record，包含 validator/profile identity、输入 digest、候选 digest、结论与有界 findings。自由文本和 payload 不进入 Metric label。

**备选方案：**让 `ManagedWorkExecutor` 持有四种领域处理逻辑。它虽然靠近 submission，却会把 Host transport、Build domain 和 lifecycle orchestration 混为一层，故拒绝。

### 4. 拒绝、处理失败与未知执行使用不同状态语义

- **correctable rejection**：candidate 已知且不满足结构或领域契约。调用 `rejectHostSubmission()`，追加有界拒绝事实，清除 pending，保持 `invoking + awaiting-correction`。同一 claim/invocation 接受新的 submission ID。
- **processing error**：candidate 已记录，但 Provider、Store 或 Runtime 处理暂时失败，无法得出接受/拒绝结论。保留 pending submission 和原 invocation，continuation 保持可恢复处理；不得把它写入 rejected history，也不得要求 Host 重做副作用。
- **unknown execution**：只有无法确认 Host 是否执行或是否返回 candidate 时才进入 reconciliation。已有 pending 或 rejected candidate 的 invocation 不得被 reconcile 为 `not-executed`。

相同 submission ID + 相同 candidate digest 是幂等重放，并继续未完成的处理；相同 ID + 不同 digest 是 conflict；纠正必须使用新 submission ID。这与 Comet 的 Outcome identity 语义一致。

### 5. acceptance 与 lifecycle observation 使用可恢复的单向顺序

校验通过后，authority guarded commit 写入 terminal execution facts。`WorkflowRuns.next()` 随后只消费已接受且已验证的结果，提交 Build protocol/lifecycle observation；它不得再次进行会改变接受结论的“第二套验证”。

若进程在 terminal acceptance 后、lifecycle observation 前退出，恢复逻辑从 accepted fact 幂等继续，不重新调用 Host、不新建 Work、不增加 attempt。若进程在 validation 后、terminal commit 前退出，pending submission 在冷启动后重新经过同一处理器，并由 stable digests 防止接受陈旧结果。

Build Execute 保留现有两阶段副作用协议：候选接受只证明 Host completion 合法，workspace checkpoint/提交消费仍按既有 journal 恢复；统一管线不能把外部副作用伪装成单事务。

### 6. Engine、Service、领域与平台边界保持清晰

- **领域模块**定义候选 schema、Build 语义校验和 typed disposition；它们不访问文件系统、Git、OpenSpec CLI 或遥测后端。
- **Cordis Service**中的 `ManagedWorkExecutor`、`WorkflowRuns` 与 acceptance coordinator 编排 submission、快照读取、校验、guarded commit 和恢复；Runtime 是唯一 phase/Work/Outcome authority。
- **Engine/Run Store**只提供 guarded state transition、trajectory 和 checkpoint 持久化，不选择 Work-specific 业务规则。
- **平台适配器**提供 Host、Git、Specification Provider、Project Snapshot 与 OpenTelemetry I/O；它们不能直接写 Run 状态或决定 continuation。

该边界允许同一规则覆盖单仓与多仓、内嵌 Host 与外部 Host，同时避免 Comet SDK 与 Repoctopus Runtime 双权威。

### 7. 用 TDD 锁定 Round 8 缺陷与全矩阵行为

首个 RED 测试精确复现 Round 8：Configure 返回正确 `execution-binding-candidate` kind，但 `strategyDigest` 错误。断言没有 accepted submission、Host/Action Outcome 或 Receipt，原 Work/claim/attempt/checkEpoch/invocation/packet 不变，continuation 为 `awaiting-correction`；新 submission ID 的修正版可被接受并继续 Plan。

随后扩展矩阵：

- Configure、Plan、Execute、Check 的结构拒绝和领域语义拒绝；
- lifecycle validator 拒绝、transition infeasible 与 Runtime processing error；
- 相同 submission 幂等重放、同 ID 异内容冲突、新 ID 纠正；
- terminal commit 前后冷启动；
- 内嵌 Host、外部 CLI 和 reconciliation 入口的一致结果；
- 现有正确候选、Execute 两阶段消费及多仓 Project Snapshot 无回归。

生产级验收使用新的多仓 acceptance Run，不改写 Round 8 Store。Evidence 记录测试命令、候选/状态 digest、恢复点和最终 lifecycle；OpenTelemetry 验证 existing `work.host-completed`、submission rejected/accepted、continuation、validator、phase/work 事件只发生一次且顺序正确。

### 8. 权威冲突是停止条件

若实现期间发现当前项目规格、已批准 Design、Comet 固定版本语义、外部 `work-outcome` 协议或 Run Store 不变量互相冲突，立即停止 Build 并回到 Design/Specification change，不通过兼容分支自行选择。普通实现取舍直接更新本 `design.md`，测试结果进入 Evidence 和验证报告，不新增 implementation notes 或 ADR。

### 9. 迁移前接受入口清单

实现前的生产入口核对如下；本清单是删除旧分支时的穷尽检查，不是保留兼容路径的理由：

- `ManagedWorkExecutor.execute()`、`acceptExternalOutcome()` 与 `reconcile()` 都会在记录 Host submission 后自行调用 `WorkDispatcher.acceptOutcome()`；三处均以 `build.plan` / `build.check` 延迟名单决定成功结果是否立即终态化。
- `ManagedWorkExecutor.rejectInvalidConfigureResult()` 只拒绝 Configure 的错误 result kind；正确 kind 但错误 Strategy digest 会绕过该特判并提前终态化。
- `WorkflowRuns.next()` 的通用失败分支接受 failed submission；Build 成功分支分别在 Configure、Plan、Execute、Check 做领域校验。
- Configure 旧分支只消费已经终态化的 Outcome，再校验 Strategy、Binding 与 Validator；Plan 和 Check 在校验后调用 `acceptOutcome()` 与 `markValidated()`；Execute 兼容 submitted、validated 和旧 outcome 三种输入，并在校验后调用同一对方法。
- `WorkDispatcher.acceptOutcome()` 先生成 Action Receipt，再调用 `WorkExecutionAuthority.bindOutcome()`；`bindOutcome()` 与 `markValidated()` 是两个独立 Store transition，因此旧实现不存在“校验记录与终态绑定”的单一 guarded commit。

迁移完成条件是：Executor 三个 Host 入口只留下 submission 记录；四种 Build Work 只通过统一候选处理入口接受；`bindOutcome()` 的 Build 成功路径不再先于 validation record；上述 Work-kind 延迟名单和 Configure 特判全部消失。

## Risks / Trade-offs

- [统一管线触及多个成熟路径，可能扩大回归面] → 先建立 Round 8 RED，再逐 Work 迁移；每迁移一个处理器就删除对应旧分支并跑定向及全量测试。
- [锁外校验与 guarded commit 之间发生输入漂移] → validation record 绑定全部稳定 digest，commit 内重新核对；漂移时重新观察，绝不接受旧记录。
- [Execute 同时包含 candidate acceptance 与外部副作用恢复，容易误合并边界] → 保留两阶段消费和 journal，新增专门的中断点测试。
- [processing error 被误归类为 Host 错误] → 使用封闭 disposition 类型和独立遥测 reason code；禁止从异常文本推断状态。
- [拒绝历史无限增长] → 沿用现有有界 history；达到上限时 fail closed 并要求人工处理，不静默丢弃事实。
- [新的 Build Work 忘记注册处理器] → registry 对 Build Work kind 穷尽检查，未注册类型在类型检查和 Runtime 都 fail closed。

## Migration Plan

1. 先提交失败测试，证明当前 Configure digest 错误会产生不可纠正终态。
2. 引入 typed disposition 与统一 acceptance coordinator，迁移 Configure，再迁移 Plan、Execute、Check。
3. 删除 `ManagedWorkExecutor` 中 Configure 特判与 Work-kind 延迟名单，确认没有第二条 terminal acceptance 路径。
4. 完成单元、集成、外部 CLI、冷启动、多仓与 OpenTelemetry 验证。
5. 使用新 Run 重跑 Round 8 场景；旧卡住 Run 仅保留为 evidence，不迁移。
6. 若发布前发现回归，整体回退该 change；由于没有 schema migration 或旧 Run 改写，回退不需要数据修复。
