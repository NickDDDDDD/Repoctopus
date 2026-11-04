---
change: recover-build-host-capability-drift
design-doc: openspec/changes/recover-build-host-capability-drift/design.md
base-ref: 33c0b44996a5ac30bee22f47fe7e70f9386def6b
---

# Recover Build Host Capability Drift Build Plan

<!-- comet-task-authority: openspec/changes/recover-build-host-capability-drift/tasks.md -->

## Context

当前 Runtime 同时把能力当作当前 `WorkDescriptor` 的 claim 前置条件和跨 Work 的
`ExecutionBinding` 身份。Configure 因而要求未来 Execute 的完整能力，Plan、Execute 与 Check
又在 Outcome 阶段用本次 Host 能力重建 Binding。真实外部 Host 可以合法领取最小能力 Plan，
但提交结果后会在 Plan validator 之前被旧 Binding 构造器拒绝。本计划把能力所有权收敛到
当前 Work，同时保留 Repoctopus 必需的多仓 Workspace、coordinator Host、claim identity 与
unknown execution 恢复语义。

## Execution contract

本计划是已批准 Design 的执行投影，不建立第二套任务清单。任务文本、完成状态、依赖关系与
稳定 ID 只以 `openspec/changes/recover-build-host-capability-drift/tasks.md` 为权威；每个结果段
完成后通过 Comet task API 更新该文件。实施配置固定为 `autonomous + tdd + thorough`，隔离方式
沿用 Open 阶段批准的 `current`。

行为变更按真实 RED → GREEN → regression 顺序执行。盘点、机械 schema fixture 更新、文档和
最终门禁不伪造 RED。不得通过给测试 Host 补齐能力超集、捕获异常继续、编辑 Store 或把合法
Plan 送回 Configure 使测试转绿。

本 Change 不创建 implementation notes。若实现迫使既定 schema、owner、恢复语义或范围发生
变化，停止 Build 并修订 OpenSpec Design；不改变设计的实现证据写入最终验证报告。

## Key decisions and verified baseline

1. `domains/change-lifecycle/build-protocol.ts:373-467` 当前由
   `executionBindingRequiredCapabilities()` 强制全量能力，并把 capability digest 写入 Binding
   semantic/state identity；这是要移除的旧权威，不是恢复依据。
2. `services/work-dispatcher.ts:42-55,173-176` 已有当前 Work 的 claim 前 capability validator；
   `services/managed-work-executor.ts:314-354` 又在外部入口先执行同一断言。实现要收敛为一次共享
   preflight，不能把 Work requirements 反向解释为 Host 实际能力。
3. `services/managed-work-executor.ts:357-499` 已以 invocation、Host 与 packet identity 接收外部
   Outcome并保留 reconcile 路径；这些事实不因 schema 切换而重建或丢弃。
4. `domains/change-lifecycle/build-protocol.ts:1231-1253,1354-1410` 的 Plan Evidence 仍复制
   `hostCapabilityDigest`；删除该字段后，Plan Evidence 继续绑定 plan、strategy、binding state、
   task set、composition 与 validation，不降低审批身份强度。
5. 现有 `test/managed-change-execution.e2e.test.ts` 覆盖 Configure、Plan、Execute 和 Check，但嵌入式
   Host 通过统一能力超集执行；现有 `test/managed-work-executor.test.ts` 主要证明外部 claim
   preflight。新增 tracer bullet 必须跨越 claim、invocation、submission 和 Runtime Outcome
   processing，才能锁定两侧合同。

## 1. Freeze the conflicting contracts with one vertical RED

<!-- comet-task-ref:0a8c7088-c1e8-4a09-9f7c-33c269824f5e -->

**1.1 Characterization matrix.** 在
`test/build-strategy-binding-domain.test.ts`、`test/build-protocol-domain.test.ts`、
`test/managed-work-executor.test.ts` 与 `test/managed-change-execution.e2e.test.ts` 中把四条历史规则
映射到 owner、输入、持久化事实和失效边界。测试名和断言直接表达冲突，不新增另一份架构文档。
先运行这些测试，保存主线全绿基线。

<!-- comet-task-ref:40d4a113-a339-4b5e-8350-52448f19ea84 -->

**1.2 Public external-Host RED.** 优先在 `test/managed-change-execution.e2e.test.ts` 复用真实应用、
文件 Store 和外部 Host service 协议：Configure 用当前最小能力成功建立 Binding；相同 external
Host ID 仅声明 Plan Work 所需只读能力，领取 Work 并提交合法 candidate。断言 claim、packet、
invocation、submission 已持久化，然后 `run next` 在 candidate validator 前因全量 Binding 能力
构造失败。断言结构化阶段和错误分类，不匹配整段人类文案，也不直接改 Store。

<!-- comet-task-ref:b33d75b1-b5e0-43e9-b174-18653731e251 -->

**1.3 Blind-spot guard.** 让同一 fixture 显式证明：仅运行外部 claim 单测无法触发缺陷，仅运行
嵌入式能力超集 E2E 也无法触发缺陷，只有外部最小能力 Outcome 纵切会失败。该测试成为后续
GREEN 的 tracer bullet，防止两侧单独变绿却重新产生组合冲突。

## 2. Make Work the sole capability authority

<!-- comet-task-ref:5961fcea-c280-417f-9900-3c6e816cf2f3 -->

**2.1 Destructive Binding schema switch.** 在
`domains/change-lifecycle/build-protocol.ts` 将 `ExecutionBinding` 升级为 Design 指定的 schema v3：
用 `coordinatorHostId` 表达协调身份，删除 `host.capabilityDigest`、能力列表参与的 semantic/state
digest、`executionBindingRequiredCapabilities()` 和对应 missing helper。同步删除 Plan Evidence 的
`hostCapabilityDigest`，更新 serializer、fixtures、domain tests、architecture tests 与所有调用者。
旧 schema 活动 Run 在正常反序列化/恢复边界返回结构化 `migration_required`；不双读、不默认填充、
不从旧 digest 猜测 coordinator identity。

<!-- comet-task-ref:e28bb111-aeba-443f-9788-6d8bfe6c75ea -->

**2.2 Configure only its own facts.** 在
`domains/change-lifecycle/build-work.ts` 和 `services/workflow-runs.ts` 让 `build.configure` 的
`WorkDescriptor.capabilities` 只包含读取 Strategy、Specification、Workspace facts 与当前 execution
mode 的协调能力。`createExecutionBinding()` 只验证 strategy、isolation、repository topology、
workspace ownership、local overlay 和 coordinator Host identity，不预测未来 Execute/Check Host
能力。用 domain tests 固定 Configure 缺少当前能力仍在 claim 前失败，而不再要求未来的
`repository.write`/`process.execute`。

<!-- comet-task-ref:cfd4ea4f-d1fb-48d3-bcc6-89ea93e7bed6 -->

**2.3 One pre-claim validator.** 保留 `services/work-dispatcher.ts` 为 capability rule owner；
`ManagedWorkExecutor.claimExternal()` 与内置 dispatcher 必须委托同一纯 validator，且仅使用 Host
显式声明。用 service/architecture tests 证明 Configure、Plan、Execute、Check 都经过同一入口；
缺失能力时 authoritative claim、packet ownership 和 invocation 均未产生。不要新增 capability
registry、调度市场或后台 daemon。

## 3. Accept Outcomes by original claim and recover the original Work

<!-- comet-task-ref:52d11eab-cc19-4341-9721-94a7265daf1e -->

**3.1 Remove capability-based Binding rebuild.** 在 `services/workflow-runs.ts` 删除 Plan、Execute、
Check Outcome processing 中的 `assertBuildHostCapabilities()`、capability-driven
`executionBindingDrift()` 和相应 Configure 回退。Binding revalidation 只比较 Binding-owned facts：
strategy/composition、coordinator Host、repository topology/ownership、isolation 与 local overlay。
原 RED 应直接进入原 Plan validator，形成唯一 Plan revision，且无第二个 Plan 或 Configure Work。

<!-- comet-task-ref:0eeed472-c996-4b9b-9b64-60282c15d9fc -->

**3.2 Shared Outcome acceptance order.** 从 Plan、Execute、Check 三个分支提取最小共享 helper，
顺序固定为：加载 authoritative claim/packet/invocation → 校验 run/work/attempt/checkEpoch/token/
packet/invocation/submission identity → 校验 Binding-owned facts → 分派结果 validator。共享的是同一
身份与失败语义，不把 Plan candidate、package completion 和 Check candidate 的业务 validator
抽象成通用结果。candidate 可纠正错误继续保留同一 claim/attempt/invocation；程序错误 fail closed。

<!-- comet-task-ref:530dc513-95c6-4c56-af8c-f3ee38bb1659 -->

**3.3 Comet-aligned unknown recovery.** 复用
`services/work-execution-authority.ts` 与 `ManagedWorkExecutor.reconcile()` 的既有 invocation事实：
unknown 保持原 Work pending/blocked；可 reconcile Host 返回原 Outcome；只有权威 `not-executed`
结果才允许现有 retry 规则产生下一 attempt。增加 crash/restart tests，证明 unknown 不派发 Configure、
不建新 Work、不重复副作用，且 recovery 始终引用原 invocation。

## 4. Prove the product contract end to end

<!-- comet-task-ref:9ef440e3-3a54-47f9-9340-e418eb12902f -->

**4.1 External Host tracer bullet goes GREEN.** 将第 1 节 fixture 扩展成完整生产序列：Configure
最小能力 → Plan 最小只读能力 → Execute 缺能力 claim 被拒且零持久化 → 兼容 Execute Host 完成
package → Check 最小能力完成。表驱动运行单仓和多仓拓扑；多仓断言 coordinator Host identity、
repository ownership、write scopes 与 workspace checkpoint 仍受约束。

<!-- comet-task-ref:a05a32be-6e54-4ff8-bdd5-91ff023cd280 -->

**4.2 Recovery and idempotency matrix.** 在 claim、invocation、submission、unknown 四个边界重启
应用；覆盖重复 pull、同 Work 并发 claim、相同 submission replay、冲突 submission、unknown
reconcile 与 authoritative not-executed retry。每个 case 断言唯一 claim/invocation/accepted
Outcome，重复调用只返回相同 continuation 或 revision conflict。

<!-- comet-task-ref:a113e6dc-1e46-4abb-a94a-2cf9da74352f -->

**4.3 Observable classifications.** 在 `services/work-execution-authority.ts`、
`platform/telemetry/opentelemetry/mapping.ts`、`domains/telemetry/observation-contract.ts` 及 Dashboard
projection 的既有目录中复用 canonical trajectory facts，明确区分 claim capability rejection、
executor blocked、unknown/reconcile 和真正 Binding drift。更新 mapping、metric coverage、Desktop
projection 与生成参考文档测试；精确 Host/Work/claim identity 仅用于 Event/Span 下钻，Metric labels
只使用有界分类。最小能力的合法 Plan/Execute 不得增加 Binding drift 或 Configure retry 指标。

## 5. Verification and delivery

<!-- comet-task-ref:3cdbf292-6c52-45b3-847b-2a8ac24a18c3 -->

**5.1 Layered gates.** 先跑最小相关测试，再跑完整门禁。所有失败先判断是否由本 Change 引入；
不得通过放宽 claim、Outcome identity、TDD Evidence、architecture 或 generated checks 解决。

```powershell
npm test -- --run test/build-strategy-binding-domain.test.ts test/build-protocol-domain.test.ts test/build-work.test.ts test/managed-work-executor.test.ts test/work-execution-recovery.test.ts test/managed-change-execution.e2e.test.ts test/telemetry-mapping.test.ts test/telemetry-metric-coverage.test.ts
npm run typecheck
npm run lint
npm run check:generated
npm run check:architecture
npm run check:provenance
npm run spec:validate
npm run verify
```

定向搜索必须证明生产代码不再读取 `ExecutionBinding.host.capabilityDigest`、
`hostCapabilityDigest` 或执行跨 Work capability Binding rebuild。strict OpenSpec 对本 Change 必须
通过；若全库验证命中已确认的主线既有问题，单独复现于 `origin/main` 并在报告中隔离证据，不能
把它静默记为通过。

<!-- comet-task-ref:8d4294ba-4368-4fcf-9840-99a8c335b820 -->

**5.2 Fresh round4 acceptance.** 保留旧 round4 Store、trajectory 和错误输出不变，作为旧 schema
正式失败 fixture。用修复后的打包产品和相同两包 TDD 多仓拓扑启动全新 Run，完成 Configure、
Plan、Execute blocked/accepted 与 Check；不恢复、重放或手术修改旧 Run。

<!-- comet-task-ref:71cbf4a9-a53c-43a3-b1ea-994682579485 -->

**5.3 Documentation and report.** 更新运行时文档与生成的 telemetry reference，说明 Work
capability、ExecutionBinding 与 unknown recovery 的唯一 owner。正式验证报告记录最终 commit、
命令、退出码、关键 claim/invocation/submission/telemetry receipts 和 round4 新旧 Run 边界。
删除临时日志、一次性 JSON、scratch receiver 数据与本次可安全清理的审计产物，提交并立即 push；
最终要求工作树干净且分支与远端同步。

## Out of scope

- 不实现 Action 级不同 coordinator Host、Host 调度市场或常驻 daemon；这些会改变 coordination
  policy，必须独立 Change。
- 不改变 Build Strategy 的 execution/TDD/review/isolation 选择，也不重做 Skill composition。
- 不为预发布旧 Binding schema 建双读、adapter、自动猜测或 Store migration。
- 不把 candidate correction 与 unknown execution 合并；前者修订同一已知结果，后者尚未知道
  外部副作用是否发生。
- 不借本修复重构所有 Build validator；只共享 claim/Outcome 身份与恢复顺序，保留各 Work 的业务
  规则。

## Risks, assumptions, and stop conditions

- **Verified assumption:** 当前外部 claim 已在持久化前调用 Work capability preflight；测试必须
  证明收敛后仍保持零 claim/packet/invocation 副作用。
- **Verified assumption:** invocation 与 submission identity 已由 Work Execution Authority 持久化；
  schema 切换必须复用而非另建 recovery Store。
- **Risk:** schema v3 会让预发布旧 Run 不可继续。缓解方式是显式 `migration_required` 与 fresh Run，
  不是兼容层。
- **Risk:** 删除 capability digest 时误删 coordinator Host identity，会放宽多仓协调边界。所有
  Plan/Execute/Check 测试必须分别断言 Host ID 与 repository ownership。
- **Risk:** 共享 helper 可能把三个 Work 的业务 validator 错误统一。helper 只拥有身份校验和
  Binding-owned revalidation；结果 schema/业务校验仍留在各分支。
- **STOP:** 若 coordinator Host 不能从现有 claim/invocation 和 Binding facts 唯一重建，停止并
  修订 Design，不从 capability digest 推断。
- **STOP:** 若旧 schema 无法在正常读取边界识别而必须扫描/改写用户 Store，停止并建立独立迁移
  Change。
- **STOP:** 若 round4 失败只能通过编辑旧 Store 才能复现，保留现有 fixture，改用相同输入的新
  Run，不把 Store 手术纳入产品方案。

## Plan review

| Dimension    | Score | Evidence in this plan                                                                                                         |
| ------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| Completeness | 5/5   | Sections 1-5 cover RED, schema, all Outcome paths, recovery, telemetry, docs and cleanup.                                     |
| Feasibility  | 5/5   | Section 1 creates the real external-Host tracer bullet before horizontal changes; existing claim/reconcile owners are reused. |
| Scope        | 5/5   | Out of scope removes daemon, scheduler, compatibility and unrelated validator refactors.                                      |
| Testability  | 5/5   | Sections 1, 4 and 5 name boundary cases, persistence assertions, commands and done criteria.                                  |
| Risk         | 5/5   | Risks and stop conditions cover schema blast radius, Host identity, wrong abstraction and fixture integrity.                  |
| Assumptions  | 5/5   | Load-bearing assumptions were checked against current source and have explicit invalidation/stop rules.                       |
