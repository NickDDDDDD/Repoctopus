# Comet Design Handoff

- Change: stabilize-runtime-continuation
- Phase: design
- Mode: compact
- Context hash: 3d58e9422d5c386d47aa8e3af8d98c1fe9739175208abc7081fa9f2f55316cad

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/stabilize-runtime-continuation/proposal.md

- Source: openspec/changes/stabilize-runtime-continuation/proposal.md
- Lines: 1-38
- SHA256: d383717cb933c58926d6fc9d399cd73f2c9fd4c6212f9d7c2209d5f07956c94e

```md
# Proposal

## Why

Repoctopus 当前把规划语义、批准授权、Runtime 组合、Build 执行进度和发布来源的变化过度汇聚到同一 planning snapshot；结果是无关变化也可能触发重复人工批准、整段 Build Protocol 重建或不精确 continuation。核心 Runtime 在交给团队使用前，需要以 Comet 已验证的稳定身份、精确 checkpoint、显式 reconciliation 和增量失效原则收敛为可重复恢复的单一权威。

## What Changes

- 将规划决定、批准授权、Runtime composition、Build configuration/plan、执行 checkpoint 和 publication provenance 分成具有明确依赖关系的稳定身份，禁止跨层漂移互相冒充。
- 让 Runtime 按变化影响范围选择 `continue | reconcile | invalidate | migration_required`，并从唯一 Change Run checkpoint 返回精确 continuation；相同输入的重复调用不得重建 Work、Build Protocol 或 Human Decision。
- 将 Build 返工改为依赖感知的增量失效：保留仍匹配当前配置、计划、Work Package 和 Evidence 输入的事实，只重建受影响节点及其依赖后继。
- 将 composition 变化交给显式兼容性/adoption 判定；兼容变化恢复当前 Work，不兼容变化进入 `migration_required`，不得伪装为 planning approval 漂移。
- 规范化 Git remote/branch publication identity，使仅发布来源变化只刷新发布证明，不使规划语义批准失效；Archive 副作用开始后的未知结果继续走 reconciliation。
- 增加基于 Comet 0.5.1 与当前 HEAD 行为不变量改写的生产黑盒、崩溃恢复、并发重放和差分测试，覆盖重复审批、Task completion、相同配置、部分计划失效、composition 漂移与 publication identity 大小写差异。
- 为失效范围、保留事实、checkpoint 恢复、reconciliation 和重复调用抑制补齐低基数 Trajectory/OTLP 事实，支持后续审计 Runtime 稳定性。
- **BREAKING**：一次性替换尚未正式发布的 planning/runtime checkpoint 身份与粗粒度失效语义；旧开发 Run 保留只读审计价值，但不增加双读、generation、静默迁移或 Store 手改兼容路径。

本次垂直切片交付 Runtime 身份分层、增量失效、精确恢复及其生产验收；不新增 lifecycle phase、Dashboard、Skill、执行模式、daemon、Webhook 或 post-merge automation。后续切片才处理非核心产品能力和界面呈现。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`：将 later-phase 规划恢复和 Build 返工从全量重建改为基于稳定身份与依赖范围的精确 continuation。
- `specification-authority`：收窄 planning semantic digest 与 approval authority 的职责，隔离 composition、执行进度和 publication provenance。
- `managed-work-execution`：明确重复调用、崩溃恢复和输入局部变化时的原 checkpoint 复用、增量退役与 reconciliation 契约。
- `plugin-composition`：为活动 Run 定义显式的 compatible adoption 与 incompatible migration 边界，禁止借规划批准处理组合变化。
- `development-telemetry`：记录失效范围、保留身份、恢复来源与重复调度抑制的可复算观测事实。

## Impact

- 影响 Change Run aggregate/checkpoint、planning approval、Specification Planning、Build Protocol reducer、composition compatibility、WorkflowRuns continuation 与对应 Store schema。
- 影响 Runtime CLI/公共 projection、Trajectory 与 OTLP mapping，但不改变 OpenSpec 四类工件权威或 Cordis 多仓组合边界。
- 参考 Comet 0.5.1 固定发布源码及当前 HEAD 的恢复契约与测试思想；不复制其产品命名、项目状态格式、Skill 体系或 Classic/Native 工件布局，因此不新增第三方运行时依赖。若实施中实质复制源码，必须在既有第三方来源清单中登记固定 commit、原路径、目标路径、摘要和许可证。

```

## openspec/changes/stabilize-runtime-continuation/design.md

- Source: openspec/changes/stabilize-runtime-continuation/design.md
- Lines: 1-162
- SHA256: 877d846be0eaeb4e276af7457a4dd133e3babd32488db6f199b1530e6def1725

[TRUNCATED]

```md
---
comet_change: stabilize-runtime-continuation
role: technical-design
canonical_spec: openspec
---

# Design

## Context

参见 [proposal.md](./proposal.md) 的 Why。当前实现已经具备唯一 Change Run、`workId + checkEpoch` execution 判定、不可变 packet、CAS/Journaling、Build Protocol reducer 和 OpenSpec planning manifest，但身份边界仍有三处耦合：

1. `PlanningSnapshot.digest` 已排除 publication OID，却仍包含完整 composition、project config 和未规范化的 branch/remote identity；Runtime composition 或无关配置变化因此可以使 Specification approval 失效。
2. `planning-authority-invalidated` transition 原子性正确，但无条件清空 Tasks、Build Protocol、Verification 与 Archive 输入，绕过了 Build reducer 已有的 Package completion 保留能力。
3. recovery 能拒绝不匹配的 `workId/checkEpoch`，但上层 observation 仍可能先重建 proposal、Plan 或 invalidation，导致 checkpoint 与人机协议逻辑重复。

Comet 0.5.1 的 Classic Runtime 提供了可验证的参考不变量：Task revision 忽略 checkbox、Task 使用稳定 ID、checkpoint 绑定 task revision/stage、stale checkpoint 返回显式 reconcile 而不是重跑；其 Runtime checkpoint 恢复通过 CAS、归属和固定材料校验拒绝漂移。当前 HEAD 继续保持由持久 state revision 派生单一 continuation 的原则。本 Change 采用这些行为原则，但不复制 Comet 的产品状态格式、Classic/Native 工件、Skill 或命令面。

当前产品尚未正式发布，因此本次可破坏性替换预发布 checkpoint schema；旧 Run 不建立执行兼容层。

## Goals / Non-Goals

**Goals:**

- 一个变化只由拥有该身份的权威分类，并只失效依赖该身份的状态。
- 相同 checkpoint 的所有入口都返回相同逻辑 continuation，不重复请求批准、派发 Work 或执行副作用。
- Design 返工后可以在新批准下重新验证并采用仍兼容的 Build Configuration、Plan 和 Package completion。
- 未知外部结果始终先 reconcile；确定性未执行才 retry。
- Trajectory/OTLP 足以复算失效放大率、重复审批率和 checkpoint 恢复质量。

**Non-Goals:**

- 不增加 lifecycle phase、repair lifecycle、generation、后台 Runner、Webhook 或 post-merge 等待。
- 不增加新的 Build mode、Skill、Dashboard UI 或团队配置能力。
- 不引入 Comet SDK/Runtime 依赖，不复制其目录布局或以 Comet 状态作为 Repoctopus 产品权威。
- 不兼容执行旧预发布 Run，不用双读、Store 手改或最新文件重组旧 packet。

## Decisions

### 1. 用分层身份与显式依赖矩阵替代聚合 planning snapshot 的跨域授权

Change Run v2 保存下列相互独立、内容寻址的身份。依赖关系由固定类型字段和领域 reducer 显式声明，不建设可配置的通用图引擎：

| 身份                            | 由谁产生                 | 只授权什么                                                                                                    |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `PlanningSemanticIdentity`      | Specification Planning   | 四类 OpenSpec 工件、Provider/schema、capabilities、规划语义 metadata、规范化 target branch 与 planning policy |
| `ApprovalAuthorityIdentity`     | Human Decision           | 对一个 planning semantic identity 的 Open/Design 决定                                                         |
| `CompositionIdentity`           | Cordis App Boot          | 实际 Provider/Contributor/definition/code/config 组合                                                         |
| `BuildConfigurationIdentity`    | Build Configure          | workspace intent、拓扑、Host 能力和批准执行策略                                                               |
| `BuildPlanIdentity`             | Build Plan reducer       | configuration、planning semantic identity、Task IDs 与 Work Package DAG                                       |
| `ExecutionCheckpointIdentity`   | Work execution           | Work/package、attempt、epoch、packet、invocation 与显式输入依赖                                               |
| `VerificationInputIdentity`     | Verify authority         | 当前 planning、Plan、实现、仓库和 Evidence 输入                                                               |
| `PublicationProvenanceIdentity` | Project/Delivery adapter | stable repository ID、规范化 remote/base/head 与 published OID                                                |

`PlanningSnapshot` 不再持有完整 composition digest、完整 project config digest 或 source OID。项目配置由领域投影为 `planningPolicyDigest`；只有会改变规格含义、验证策略或关闭行为的字段进入 planning identity。完整 project/composition snapshot 仍在 Run 中独立保存和审计。

Remote identity 由 Git/平台 adapter 规范化：stable repository ID 优先；URI scheme/host、分隔符、尾部 `.git` 和平台明确大小写规则由 adapter 处理。无法证明等价时保留不同 identity 并返回 publication reconciliation，不把不确定性归为 planning drift。

**替代方案：继续在一个 snapshot digest 中排除更多字段。** 拒绝。字段黑名单会随着新能力继续泄漏；按授权职责建模才能让新增字段默认不跨域生效。

### 2. Lifecycle reducer 使用固定的 Dependency-aware Invalidation Closure

不建立脱离生产 transition 的通用 planner。每个受保护的 lifecycle observation 由对应 reducer 显式决定 `classification`、`disposition`、successor Action 和低基数 reason code；reducer 只调用纯函数 `runtimeInvalidationScope()`，按代码和测试固定的 identity dependency matrix 计算 retained/invalidated identity 集合。这样分类与推进权仍属于同一个 CAS transition，不会出现“planner 测试通过、生产路径却没有调用”的第二套权威。

`runtimeInvalidationScope()` 不读取文件、Git、Cordis 或网络，不创建 Human Decision，也不直接写 Run。`WorkflowRuns` 在锁外收集带 identity 的 observations，lifecycle reducer 在一次 `RunStore.commitGuarded()` 内按 expected revision 验证 observation、计算依赖闭包并提交 transition。陈旧 observation 只返回 revision conflict。

Build Protocol 增加 `suspended-for-design` 状态和 invalidation ledger。返回 Design 时，旧 Build 状态保留为同一 Run 内不可执行的候选，而不是被删除。新 Design approval 后，受保护 reducer 逐层重新验证：

1. configuration 输入仍相同则保留，否则回 Configure；
2. Plan 对新 planning/Task identity 仍完整则保留，否则回 Plan；
3. Package identity、依赖和输入仍相同则保留 completion；
4. Plan Evidence、Check 与 Verification 只在其完整输入仍匹配时保留。

无法证明安全最小范围时使用 definition 声明的保守失效或 Human Decision，并记录原因；不得静默假设兼容。

**替代方案一：建设通用 identity graph/规则引擎。** 拒绝。当前身份种类有限且属于核心安全不变量；可配置图会引入解析、迁移和错误配置面，偏离 Comet 的显式状态与 revision 模式。

**替代方案二：Design 回退继续删除 Build Protocol，再从 trajectory 推断可保留事实。** 拒绝。Trajectory 是审计历史，不应成为第二个当前状态 reducer；删除后重建也会再次引入重复批准和歧义 continuation。

### 3. Continuation 只从已提交 checkpoint 产生

```

Full source: openspec/changes/stabilize-runtime-continuation/design.md

## openspec/changes/stabilize-runtime-continuation/tasks.md

- Source: openspec/changes/stabilize-runtime-continuation/tasks.md
- Lines: 1-79
- SHA256: 7ef041ffae16bad8840b713245f8a67ac8b8cb40f9cac96e666f7a340e67c924

```md
# Tasks

## 1. 锁定缺陷与新状态契约

- [x] 1.1 增加 planning snapshot 因 composition、完整 project config 和 remote 表示差异而误失效的回归测试，并用 `npx vitest run test/specification-planning-approval.test.ts test/specification-planning-service.test.ts` 证明测试在旧实现下失败 <!-- comet-task:300bb461-3de3-4765-bb81-0408d0c20a89 -->
- [x] 1.2 增加 planning invalidation 全量清空 Build Protocol、重复创建批准和重复派发 Work 的生产服务回归测试，并用对应 `workflow-runs`/change lifecycle 测试证明旧行为被捕获 <!-- comet-task:2c460e82-0b53-4c9e-8b99-bfd4282d1a7c -->
- [x] 1.3 定义版本化 Runtime identity basis、固定类型依赖矩阵和 schema validator，并用单元测试覆盖错误 owner、未知依赖组合、缺失输入和非 SHA-256 identity 拒绝 <!-- comet-task:668ccfb2-6f89-4b9e-83c0-c927c687c713 -->
- [x] 1.4 定义 Change Run v2 checkpoint 与 suspended Build Protocol 状态，使用序列化 round-trip 和 state invariant 测试证明 current phase/Work 仍是唯一执行权威 <!-- comet-task:0ed0c3ad-b64d-405c-b308-9da9a79bb1dc -->
- [x] 1.5 更新 `docs/runtime-state.md` 的身份分层、预发布破坏性边界和旧 Run 只读规则，并用 `npm run format:check` 验证文档格式 <!-- comet-task:270a001b-4815-453b-bf59-3953ac43f598 -->

## 2. 拆分 Specification Planning 与发布身份

- [x] 2.1 先为 planning semantic、approval authority、validation observation 和 publication provenance 独立身份编写构造器测试，覆盖 checkbox/OID/composition 不改变语义而工件/metadata/target branch 改变语义 <!-- comet-task:782227c7-2126-4b86-9bfc-2756a4dabe09 -->
- [x] 2.2 实现 `PlanningSemanticIdentity` 与 planning policy 配置投影，移除完整 composition/project config/source OID 对 approval semantic identity 的影响，并通过 2.1 测试 <!-- comet-task:86905b09-fbaf-481f-8a1a-c2f0fc969718 -->
- [x] 2.3 实现 stable repository ID 优先的 remote/base/head 规范化和 platform adapter 保守等价规则，并用 GitHub 大小写、`.git`、分隔符及未知平台不确定性测试验证 <!-- comet-task:9f07488e-0652-4e74-baa8-dfa977526200 -->
- [x] 2.4 重构 Planning approval request/record/store 使用 semantic 与 authority identity，保证相同 proposal 的请求和决定重放幂等，并运行 approval domain tests <!-- comet-task:4da89c4d-cbdb-4afe-bad3-1e7ada1ecd05 -->
- [x] 2.5 重构 Specification Planning `observeAuthority` 返回分层 observation 和 `semantic | approval-authority | publication | unknown` 结果，不在只读观察中刷新请求，并运行 service contract tests <!-- comet-task:a5fe4dd3-21f5-4d08-894c-d5c691203a6b -->
- [x] 2.6 更新 `docs/specification.md` 说明各身份 owner 与 publication-only 更新路径，并运行 `npm run spec:validate` <!-- comet-task:f59b55c9-e6dd-436b-b98e-b21e58bf7b9d -->

## 3. 实现依赖感知失效 Planner

- [x] 3.1 先建立显式 identity dependency 失效矩阵测试，覆盖 semantic、approval、composition、Build input、verification、publication 与 unknown 分类的 retained/invalidated 集合 <!-- comet-task:6eb6ebe3-22fc-42f6-95e9-6edf17c23e5d -->
- [x] 3.2 实现纯领域 Invalidation Planner 和确定性 reason codes，证明相同输入得到规范化相同输出且不访问 I/O <!-- comet-task:c72de8ac-d78b-4fe8-aaad-ffc7ef7b2ec4 -->
- [x] 3.3 扩展 Build Protocol reducer 支持 `suspended-for-design`、invalidation ledger 和不可调度候选状态，并用 reducer tests 验证 Design 中不能领取旧 Build Work <!-- comet-task:86f0970c-cc7f-49e1-a241-143c41a96587 -->
- [x] 3.4 实现新 Design approval 后 Configuration → Plan → Package completion → Evidence 的逐层兼容重验，使用局部 Task/Plan 变化测试证明只失效依赖后继 <!-- comet-task:84791012-882d-4f71-bd2a-13be3c917c92 -->
- [x] 3.5 将 planning-authority recovery 改为一次 CAS 提交 Design Work、epoch、execution retirement 和 planner 结果，不再无条件删除 Build Protocol，并运行 transition tests <!-- comet-task:b9e6486b-e7e3-4867-af72-33484ff1b4d4 -->
- [x] 3.6 为无法证明最小范围的情况实现保守 invalidation/Human Decision 路径，并验证不会静默保留 completion 或重开全部 Task <!-- comet-task:308f4d40-d472-47da-8f0b-1ce5e8272ed1 -->
- [x] 3.7 更新 `docs/self-hosting.md` 说明 Design 返工、suspended Build 与重新采用流程，并用 `npm run format:check` 验证 <!-- comet-task:84b060d5-8cb8-4f58-87e0-5aac150f8a93 -->

## 4. 收敛单一 Continuation 与 checkpoint 恢复

- [x] 4.1 先增加相同 revision 上 `next/resume`、批准、Outcome 和 transition 重放的幂等测试，断言 Work/request/invalidation/副作用各只出现一次 <!-- comet-task:f61ce630-8614-4eb9-a26e-9e0d56130983 -->
- [x] 4.2 实现共享 continuation projector，使 CLI、Runtime、Dashboard 投影只消费已提交 Run checkpoint，并用 projection parity tests 验证结果一致 <!-- comet-task:3353f049-d017-4091-80d0-564615115065 -->
- [x] 4.3 为 Human Decision、Build Configuration proposal、Plan candidate、submission 和 invalidation 引入稳定 idempotency key 与 payload conflict 检查，并运行重放测试 <!-- comet-task:6cc3e6aa-2255-4fd5-aef9-b9cffa075a99 -->
- [x] 4.4 实现 observation 后/CAS 前及 CAS 后/响应前的恢复逻辑，使用 fault injection 验证孤立内容无执行权且已提交 transition 不重复 <!-- comet-task:0b75b0e4-18f9-461a-b211-e4c10e401bd0 -->
- [x] 4.5 实现 unknown invocation reconciliation 状态机，覆盖匹配 Outcome、确定性未执行和仍未知三种结果，并验证未知结果不自动 retry <!-- comet-task:c6041416-5cbf-49fc-adc1-dad3746e9762 -->
- [x] 4.6 统一 lifecycle current Work 与 execution checkpoint 的兼容判定，使无关 publication 变化保留 checkpoint、受保护输入漂移原子退役，并运行 work execution recovery tests <!-- comet-task:84532c93-f1ea-44c9-997e-f20a3b2596fc -->
- [x] 4.7 更新公共 CLI JSON continuation schema/诊断和 `docs/runtime-state.md` 示例，并用 CLI contract tests 与 `npm run typecheck` 验证 <!-- comet-task:99d409c0-aa58-4451-b4a4-2928f77516af -->

## 5. 分离 Composition adoption 与 Planning approval

- [x] 5.1 先增加 `same | compatible-adoption | migration_required` 矩阵测试，覆盖未使用 Contributor、已 claim packet、definition 直接前驱和不完整 adoption <!-- comet-task:959d4d53-5fca-4529-b9e0-20211d7a3339 -->
- [x] 5.2 实现按 current checkpoint dependency closure 的 composition compatibility authority，替换全局 Skill snapshot 漂移即阻断/返 Design 的路径，并通过 5.1 测试 <!-- comet-task:82f323d4-fad3-4ea7-86d3-aea22b108232 -->
- [x] 5.3 实现精确旧新 code/config/definition identity adoption catalog 与一次性 CAS 事实，拒绝通配、多前驱和用新内容重组旧 packet <!-- comet-task:c88950ab-88a5-4383-864f-ce1c6090e738 -->
- [x] 5.4 让不兼容组合原地进入 `migration_required` 且保持 status/doctor 只读可用，并验证不会创建 Design approval 或第二个 Run <!-- comet-task:4eef3cad-bfc1-4946-929f-a0e1b1ee861c -->
- [x] 5.5 更新 `docs/plugin-architecture.md` 或现有 composition 文档记录 adoption 边界和 Provider 语义变化的职责分工，并运行 `npm run check:architecture` <!-- comet-task:4c90e986-4fff-4b77-8d3a-a37feb70f8f9 -->

## 6. 补齐 Trajectory 与 OTLP 稳定性证据

- [x] 6.1 为 planner result、retained/invalidated counts、checkpoint recovery、dispatch suppression 和 reconciliation 定义版本化领域事实，并用 schema/allowlist tests 验证无路径、正文或自由错误泄漏 <!-- comet-task:9e08d44a-30ec-4797-b448-109629e8885d -->
- [x] 6.2 将新事实映射到规范 OTLP Trace/Event，限制 Metric labels 为有界 authority/classification/scope/result/continuation，并运行 telemetry mapping cardinality tests <!-- comet-task:24d0e706-da6b-45ea-8d0a-a5dec0a554b2 -->
- [x] 6.3 实现重复批准率、Protocol 重建率、精确失效率、completion 保留率、checkpoint 恢复与 duplicate dispatch suppression 指标，并用持久事件复算测试验证 <!-- comet-task:8ab84e75-0362-47c0-8e13-2c4e5485dd76 -->
- [x] 6.4 扩展 OTLP test receiver 纵切验收，证明本地 Desktop 与远端目的地消费同一 envelope 且失败不回滚 Run <!-- comet-task:739daf07-a69a-4a8e-a6b5-c13dd06e835a -->
- [x] 6.5 更新 `docs/telemetry.md` 的稳定性指标、解释边界和 SigNoz 查询维度，并运行 `npm run format:check` <!-- comet-task:e21c0e16-466f-4aab-8b50-a38ae543ff87 -->

## 7. 生产纵切与多仓恢复验收

- [x] 7.1 将 typed identity basis、Planner、Planning、Build、Recovery、Composition 和 Telemetry 通过 Cordis production composition 接通，并用公共 CLI 启动 fresh Run 验证无测试旁路 <!-- comet-task:67020eb2-6b7e-4f05-81f5-e445fd0a64d1 -->
- [x] 7.2 建立 adapted Comet parity fixtures，验证 checkbox 不改 revision、stable ID 恢复、stale checkpoint reconcile、唯一 continuation、CAS 漂移拒绝和 unknown 不 retry <!-- comet-task:92167e9d-1821-4485-a2b6-2b4b6d968108 -->
- [x] 7.3 运行单仓与多仓黑盒：Design 修改一个仓的 Task/Plan 后只重做受影响 Work Package，其他仓 completion/证据保持有效且 repository binding 不漂移 <!-- comet-task:959dc25a-fc35-4985-afc7-a1bed0dd1e48 -->
- [x] 7.4 运行 Open、Design、Build Configure/Plan/Execute/Check、Verify、Archive 前置的中断恢复矩阵，交叉核对 Run、Trajectory、packet、受保护文件和 OTLP receiver <!-- comet-task:0f7fb55a-f510-4fb8-a2d2-d3dc7954aafe -->
- [x] 7.5 运行并发 Runner/CAS 测试，证明相同 checkpoint 只产生一个 claim、一个 Human Decision、一个 invalidation 和一个外部副作用 intent <!-- comet-task:ebfb5802-4c21-4b6f-8f72-54fe5aaf0a49 -->
- [x] 7.6 通过生产 CLI 验证 composition compatible adoption 不重复批准、不兼容升级进入 `migration_required`、publication-only 更新不返回 Design <!-- comet-task:d786c49e-70ff-4dc0-a65e-135b53fd427c -->
- [x] 7.7 若实施实质复制 Comet 源码则更新第三方来源清单、固定 commit/路径/摘要/许可证并运行 `npm run check:provenance`；若仅行为重建则记录审计结论并验证清单无需新增快照 <!-- comet-task:1949872e-230f-4046-a120-1a21df0e907b -->

## 8. 删除旧语义并完成验证

- [x] 8.1 删除旧 PlanningSnapshot 聚合授权、全量 Build Protocol 清空、跨域 composition→planning drift 和重复 proposal 构造分支，并用 `rg` 与 architecture tests 证明无生产引用 <!-- comet-task:5a8f9678-370e-42cd-a863-24dace56a676 -->
- [x] 8.2 删除或重写依赖旧预发布 schema/全量失效的 fixtures，不增加 generation、双读、fallback adapter 或 Store 修复命令，并运行 migration/read-only tests <!-- comet-task:d9b7f7ec-5be0-43e8-9f72-ca4485aa8fa1 -->
- [x] 8.3 更新 `docs/specification.md`、`docs/runtime-state.md`、`docs/self-hosting.md`、`docs/telemetry.md` 的最终公共行为，使用文档中的命令执行一次可复现验收 <!-- comet-task:08a88783-5f1b-47cf-aad6-c35ae9a32cb5 -->
- [x] 8.4 运行 `npm run typecheck && npm run lint && npm test`，修复所有 Runtime、领域和服务回归 <!-- comet-task:7843b6f1-2c1b-4f0c-98a5-bf5fc9bfb593 -->
- [x] 8.5 运行 `npm run verify` 与 `npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate stabilize-runtime-continuation --strict`，保存正式 Verification Evidence 并确认无临时日志/调试文件残留 <!-- comet-task:5411ed42-b3c3-4595-a9ec-9c3a3c54d77c -->
- [x] 8.6 由独立 reviewer 对 identity owner、失效范围、unknown side-effect、CAS 原子性、多仓 binding 和遥测基数做高风险复核，解决全部阻断 finding 后才允许 Archive <!-- comet-task:99fe553e-8039-4503-bc20-5a680f622d7f -->

## Workflow follow-up

- 在 Open 与 Design 的正式 Human Decision 均通过后才进入 Build。
- Verify 通过并具备完整 Evidence 后，通过 Comet controller 执行 Archive；不要为本次 Runtime 自举创建 Repoctopus Run。
- Archive 后检查分支、提交、PR 与远端状态，并清理仅用于本次审计的固定 Comet 临时源码目录。

```

## openspec/changes/stabilize-runtime-continuation/.openspec.yaml

- Source: openspec/changes/stabilize-runtime-continuation/.openspec.yaml
- Lines: 1-4
- SHA256: dc6f4741968abfb0a9dacf7d64270b68e1dfee87dd63e5ad4e447d8bfd8a901e

```md
schema: spec-driven
created: 2026-11-01
goal: 以 Comet 0.5.1/HEAD 的成熟 Runtime 不变量为行为基线，修复 Repoctopus 的重复审批、全量 Build
  Protocol 重建和不精确 continuation，使核心 Runtime 达到首个稳定版本门槛

```

## openspec/changes/stabilize-runtime-continuation/specs/change-lifecycle/spec.md

- Source: openspec/changes/stabilize-runtime-continuation/specs/change-lifecycle/spec.md
- Lines: 1-86
- SHA256: 0031eb83f34218b818e944d39b8a028b280b6a3f7ca9c16ba5dbb31237b2e509

[TRUNCATED]

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: 生命周期回退保留审计历史

Design revision、规划语义漂移、Verify 失败、实现输入漂移和 Archive 前置验证失效 MUST 在同一 Run 中通过追加 invalidation、递增 `checkEpoch` 与定义声明的回退转换处理；Runtime MUST 按稳定身份依赖关系只失效不再授权当前输入的批准、Work、Build 节点与 Evidence，并保留仍匹配的 Task completion、Build Configuration、Plan、Package completion、Outcome、Evidence 和 Receipt。普通回退不得创建替代 Run；外部或规格关闭副作用开始后的 Archive 不得回滚，只能 reconcile。

#### Scenario: Verify 发现实现失败

- **WHEN** 完整 verification input 下的阻断 Gate 不满足
- **THEN** 同一 Run 记录失败 Evidence、递增 epoch 并回到 Build 或进入 Build blocked，旧 Gate 不可用于后续修复输入

#### Scenario: Build 中修改规划语义

- **WHEN** Tasks 文字、结构、需求映射或其他规划产物语义变化
- **THEN** Runtime 在原 Run 中使旧 Design approval 和受影响 Work 失效、递增 epoch 并返回 Design，同时保留仍由新语义授权的下游事实

#### Scenario: 局部变化不影响已完成工作包

- **WHEN** Runtime 能证明变化只影响当前 Plan 的一个 Work Package 及其依赖后继
- **THEN** invalidation 只退役该范围的 execution 与 Evidence，其他匹配当前稳定身份的 Package completion 继续有效

### Requirement: 规划授权失效必须原子恢复 Design checkpoint

当 Build、Verify 或尚未发生不可逆副作用的 Archive 观察到当前 Specification Provider 的规划语义或 trusted Design approval 不再授权 lifecycle 的 planning identity 时，Runtime MUST 通过带 `semantic | approval-authority` 分类的受保护 transition 原子回到 Design，并在同一次 Run 提交中设置新的 `specification.plan` Work、递增 `checkEpoch`、退役不匹配的 execution checkpoint，且按依赖关系保留或失效 Tasks、Build Configuration、Plan、Package completion、Verification、Archive 与 Closure 输入。Runtime MUST NOT 将 composition、执行进度或仅 publication provenance 的变化误分类为 planning invalidation，也不得留下无 current Work 的 Design 中间态、复用无效 approval、创建第二个 Run 或要求手改 Store。

#### Scenario: Verify 收尾提交改变规划语义

- **WHEN** Change 已进入 Archive，但 Verify 收尾提交改变 Proposal、Design、Delta Specs、Tasks 语义或 Change metadata
- **THEN** 下一个受保护 Runtime pull 在任何关闭或发布副作用前一次提交 Design phase、新 `specification.plan` Work、新 epoch 与精确下游失效事实

#### Scenario: 当前 approval 不再有效但语义摘要相同

- **WHEN** Archive preflight 能读取相同 planning semantic digest，但无法证明与该 Run 绑定的 trusted Design approval 仍有效
- **THEN** Runtime fail closed 并回到新的 Design approval Work，不把 lifecycle 中的 planning identity 单独视为发布授权

#### Scenario: 重复观察相同失效

- **WHEN** 进程在恢复提交后退出，另一个 Runner 对同一 revision 再次观察相同规划失效
- **THEN** Runtime 返回已经存在的 Design checkpoint 或明确 revision conflict，不创建第二个 Work、第二次 invalidation 或重复副作用

#### Scenario: 陈旧 Runner 提交失效观察

- **WHEN** planning invalidation observation 的 `expectedRevision/fromPhase` 不再匹配 CAS 内读取的当前 Run
- **THEN** Runtime 拒绝该陈旧观察并要求调用方重读当前 Action，不覆盖较新的 phase、Work 或批准结果

#### Scenario: composition 变化但规划语义不变

- **WHEN** 当前 composition identity 与 Run 记录不同，但 Specification Provider 返回相同 planning semantic identity
- **THEN** Runtime 先走 composition compatibility 或 migration 判定，不刷新 Design approval，也不清空 Build Protocol

#### Scenario: 仅 publication provenance 改变

- **WHEN** source branch 的规范化 remote identity 或已发布 OID 改变，但规划语义、目标分支与批准 proposal 均未改变
- **THEN** Runtime 只刷新 publication provenance 或 Archive 输入，不返回 Design

## ADDED Requirements

### Requirement: Runtime 失效必须使用稳定身份依赖图

Change Run MUST 分别记录 planning semantics、approval authority、composition、Build Configuration、Build Plan、Work Package、execution checkpoint、verification input 与 publication provenance 的稳定身份及依赖；变化只能失效直接依赖该身份且无法证明兼容的事实，禁止用单一聚合摘要触发无差别重建。

#### Scenario: Build Plan 局部修订

- **WHEN** 新 Plan revision 保留某个 Work Package 的稳定 identity、依赖、输入和 Validator profile
- **THEN** Runtime 保留该 Package completion 及其匹配 Evidence，只为变化包及依赖后继创建新 Work

#### Scenario: 无法证明兼容范围

- **WHEN** Runtime 缺少计算安全最小失效范围所需的身份或依赖事实
- **THEN** Runtime fail closed 为受限 Human Decision、reconcile 或 definition 声明的保守失效，并记录未能保留的原因

### Requirement: 等价输入的 continuation 必须幂等

相同 Run revision、current Work、attempt、`checkEpoch` 与输入身份上的重复 `next`、`resume`、批准提交、Outcome 重放或恢复 MUST 返回同一逻辑 continuation 或明确的 revision conflict；Runtime 不得重建 Work、Build Configuration proposal、Build Plan、Human Decision request、invalidation 或外部副作用。

#### Scenario: 相同配置重复进入 Build Configure

- **WHEN** Runner 在 Build Configuration proposal 已提交后断开并以相同 checkpoint 恢复

```

Full source: openspec/changes/stabilize-runtime-continuation/specs/change-lifecycle/spec.md

## openspec/changes/stabilize-runtime-continuation/specs/development-telemetry/spec.md

- Source: openspec/changes/stabilize-runtime-continuation/specs/development-telemetry/spec.md
- Lines: 1-55
- SHA256: 8985579a2f9bdfc136ad43b363c5558825908a8b0c5a308249d1c65df75a41fc

```md
# Spec Delta

## ADDED Requirements

### Requirement: 增量失效必须形成可复算观测事实

Runtime MUST 在本地提交增量失效后记录变化权威、变化类别、受影响 identity kind、保留/退役节点数量、失效范围是否精确、fallback 原因和 resulting continuation；Trace/Event MAY 携带允许列表内的旧新 identity 关联，Metric labels MUST 仅使用有界 authority、classification、scope、result 与 continuation kind。

#### Scenario: 局部 Plan revision 保留完成事实

- **WHEN** Build 或 Verify finding 只失效部分 Work Packages 并保留其余 completions
- **THEN** Trajectory 与 OTLP 记录受影响/保留数量、精确范围结果和旧新 Plan 关联，使团队可以复算返工放大率

#### Scenario: 无法计算最小范围

- **WHEN** Runtime 因缺少依赖身份而采用保守失效或 Human Decision
- **THEN** 事件记录 `scope=conservative` 与有界 reason code，不输出自由文本、Task 内容、路径或 digest 作为 Metric label

#### Scenario: composition 变化不触发 planning invalidation

- **WHEN** Runtime 接受 compatible composition adoption 且 planning semantic identity 不变
- **THEN** OTLP 关联 adoption 与恢复 continuation，不产生 planning invalidation 或 Design approval refresh 事件

### Requirement: Continuation 去重必须可观测

Runtime MUST 为相同 checkpoint 上的 continuation request、idempotent replay、revision conflict、dispatch suppressed 和 reconciliation 记录持久化可关联事实，使团队能区分正常恢复、重复调度缺陷和未知副作用；Metric labels MUST 使用有界 request kind、outcome、phase、Work kind 与 recovery classification。

#### Scenario: 重复 next 返回原 checkpoint

- **WHEN** 相同 Run revision 和 current Work 上的 `run next` 重放没有产生新事实
- **THEN** 遥测记录 `dispatch-suppressed` 或 idempotent replay，并关联原 Work/attempt，但不生成第二个 Work started Span

#### Scenario: 响应丢失后的 transition 重放

- **WHEN** 调用方重放已经成功提交的 transition 命令
- **THEN** 事件表示从 checkpoint 恢复既有 continuation，phase transition、invalidation 与 Human Decision requested 计数均不重复

#### Scenario: 未知外部结果进入 reconciliation

- **WHEN** Runtime 不能确定原 invocation 是否跨过副作用边界
- **THEN** Trajectory 与 OTLP 记录 `reconcile` continuation 和原 invocation 关联，不记录 retry 或新 Host invocation 成功

### Requirement: Runtime 稳定性指标必须来自审计事实

Telemetry Provider MUST 从持久事件派生重复批准率、Build Protocol 重建率、精确/保守失效率、保留 completion 比率、checkpoint 恢复结果、reconciliation 数量和重复派发抑制数量；这些 Metric 不得根据最终 phase、目录扫描、Dashboard 交互或日志文本推断。

#### Scenario: 团队评估 Runtime 稳定性

- **WHEN** 多个 Change 完成、返工或中断恢复
- **THEN** 后端可按有界 phase、authority、classification 和 result 聚合稳定性指标，并从 Trace/Event 回到具体审计链解释异常

#### Scenario: 缺少必要审计事实

- **WHEN** 某个旧 Run 没有计算指标所需的版本化事件
- **THEN** Provider 标记数据不可用，不从现有文件或终态猜测成功、失效或重复次数

```

## openspec/changes/stabilize-runtime-continuation/specs/managed-work-execution/spec.md

- Source: openspec/changes/stabilize-runtime-continuation/specs/managed-work-execution/spec.md
- Lines: 1-55
- SHA256: 26bde4c5149ffdea0e3e6f4be208eff018bc42c68abf23a8e8d5b6ee5d73b682

```md
# Spec Delta

## ADDED Requirements

### Requirement: Execution checkpoint 兼容性必须按依赖身份判定

Runtime MUST 以 current Work、attempt、`checkEpoch`、packet、Host invocation 及该 Work 声明的输入依赖逐项判断 execution checkpoint 是否仍可续行；未被变化身份依赖的 checkpoint MUST 保留，直接依赖不兼容身份的 checkpoint MUST 原子退役。Runtime 不得以全局 planning 或 composition 摘要不同为由无差别丢弃执行事实。

#### Scenario: 当前 Work 输入完全相同

- **WHEN** Runner 恢复时 current Work、attempt、epoch、packet 和全部声明输入身份均与 checkpoint 相同
- **THEN** Runtime 返回原 execution continuation，不创建新的 ActionIntent、packet、claim 或 Host invocation

#### Scenario: 变化不属于当前 Work 依赖

- **WHEN** Run 中某个 publication 或其他旁路身份变化，但当前 Work 的显式输入依赖均未变化
- **THEN** Runtime 保留原 execution checkpoint 并继续真实断点

#### Scenario: 当前 Work 的受保护输入不兼容

- **WHEN** 当前 Work 依赖的 Provider、definition、packet 或 repository binding 无法证明与 checkpoint 兼容
- **THEN** Runtime 原子退役当前投影并返回 `reconcile` 或 `migration_required`，不得从最新文件重组 packet 后重放 Host

### Requirement: 未知外部结果必须优先 reconciliation

当 Host、工具、Git、平台或 Specification 副作用可能已经开始但结果未知时，Runtime MUST 保留原 invocation、幂等键、attempt、packet 与输入身份并返回有界 `reconcile` continuation；只有取得确定性未执行证明后才可创建新 attempt，取得匹配 Receipt 或 Outcome 后必须从原 checkpoint 继续。

#### Scenario: Host 响应在提交后丢失

- **WHEN** Runtime 已记录 invocation，但无法确定 Host 是否完成了具有副作用的操作
- **THEN** 下一次 pull 返回原 invocation 的 reconciliation，不重新调用 Host

#### Scenario: reconciliation 发现匹配 Outcome

- **WHEN** Reconciler 找到绑定原 invocation、packet、attempt 和输入身份的持久 Outcome 或 Receipt
- **THEN** Runtime 幂等接纳该事实并从 Validator 或 transition 继续，不创建新的执行身份

#### Scenario: reconciliation 证明未执行

- **WHEN** 权威适配器能确定性证明原 invocation 未跨过副作用边界
- **THEN** Runtime 按 definition retry policy 创建更高 attempt，并保留原 attempt 的审计事实

### Requirement: 恢复不得重建已存在的人机协议

Human Decision request、Build Configuration proposal、Build Plan candidate rejection 和可纠正 Host submission MUST 作为原 checkpoint 的稳定协议事实恢复；重复 `next`、进程重启或 Runner 交接不得仅因重新观察当前文件而生成另一份 proposal/request 或改变其 hash。

#### Scenario: 等待 Build Configuration 决定时恢复

- **WHEN** Run 已持久化 Build Configuration proposal 和 Human Decision request，但尚未收到用户决定
- **THEN** 新 Runner 展示同一 request、proposal hash 和 choices，不重新进入 Configure Host Work

#### Scenario: 可纠正 submission 被拒绝后恢复

- **WHEN** 当前 invocation 已有 rejected submission 且冻结输入仍匹配
- **THEN** Runtime 保留原 claim/attempt/invocation 并等待新的 submission identity，不重新执行 Agent

```

## openspec/changes/stabilize-runtime-continuation/specs/plugin-composition/spec.md

- Source: openspec/changes/stabilize-runtime-continuation/specs/plugin-composition/spec.md
- Lines: 1-57
- SHA256: cb1e4b873d7ee42bea07fadfe2c88722ccf71fa87d12d90d040077d1dc97dc3c

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: 每次运行绑定实际插件组合

Repoctopus MUST 为规范化 composition 与全部活动 Provider、Contributor 记录稳定标识、版本、配置摘要和代码摘要，并把 composition identity 绑定到 Run、Checkpoint、Evidence、Action Receipt、Delivery Snapshot、Trajectory 与允许列表遥测属性。Runtime MUST 在写操作前根据受影响角色和状态契约判定 `same | compatible-adoption | migration_required`；compatible adoption 必须记录旧新身份及适用 checkpoint，不得刷新 Specification approval 或重建无关 Runtime 状态。

#### Scenario: 恢复时组合完全相同

- **WHEN** 当前 composition identity 与 Run 保存的身份相同
- **THEN** 写操作继续按原 checkpoint 状态契约执行，不追加 adoption 或 invalidation

#### Scenario: 组合发生兼容变化

- **WHEN** 当前组合变化被所有受影响状态契约明确声明为兼容，且 adoption 精确匹配旧新实现身份
- **THEN** Runtime 在同一 Run 记录 `composition.changed` 与 adoption 后恢复原 current Work 或其声明的兼容 successor，不刷新 Planning approval

#### Scenario: 组合发生不兼容变化

- **WHEN** Engine、RunStore、Lifecycle、Evidence Gate、Provider 或 Action Adapter 的变化无法证明兼容当前 Run
- **THEN** 只读查询仍可使用，写操作进入 `migration_required` 且不静默推进、不伪造 planning drift

#### Scenario: 未使用组件发生变化

- **WHEN** 安装目录中的组件未进入当前 composition 或当前 checkpoint 的依赖闭包
- **THEN** 该变化不改变活动 Run 的 continuation，也不触发 adoption、migration 或人工批准

## ADDED Requirements

### Requirement: Composition adoption 必须精确且有界

兼容 adoption MUST 精确声明旧 implementation/code/config identity、新 identity、受影响角色、允许恢复的 lifecycle definition/checkpoint 范围和 successor Work 规则；通配版本、仅比较自由名称、跨多个未知前驱或以当前最新内容重组旧 packet 的 adoption MUST 被拒绝。

#### Scenario: 唯一直接前驱可兼容采用

- **WHEN** 新 Runtime 声明当前活动 Run 的精确旧 composition identity 为唯一可采用前驱，且 current Work 输入契约未改变
- **THEN** Runtime 记录一次 adoption 并从原 checkpoint 继续

#### Scenario: adoption 声明不完整

- **WHEN** adoption 缺少旧代码摘要、配置摘要、definition identity 或受影响 checkpoint 范围
- **THEN** Runtime 返回 `migration_required`，不得把相同组件名称视为兼容证明

### Requirement: Composition compatibility 与规划授权保持正交

Composition compatibility authority MUST 只决定当前 Runtime 实现能否安全解释并继续既有 Run facts；Specification Planning authority MUST 只决定当前规划语义与 Human Decision 是否授权 lifecycle。任一权威不得通过修改另一方摘要、创建另一方请求或选择目标 phase 来规避自身失败。

#### Scenario: 兼容升级后规划语义相同

- **WHEN** composition adoption 成功且 Provider 返回与现有 approval 匹配的 planning semantic identity
- **THEN** Runtime 保留原 approval 和 planning identity，从兼容 checkpoint 继续

#### Scenario: composition 不兼容但规划仍有效

- **WHEN** planning semantic identity 与 approval 均有效，但 composition 无兼容 adoption
- **THEN** Runtime 进入 `migration_required`，不返回 Design，也不请求用户重新批准相同规格

```

## openspec/changes/stabilize-runtime-continuation/specs/specification-authority/spec.md

- Source: openspec/changes/stabilize-runtime-continuation/specs/specification-authority/spec.md
- Lines: 1-87
- SHA256: 6006b58218201de98e8e05f6a594e9b2dd04ef3b5632892a73591906ee554894

[TRUNCATED]

```md
# Spec Delta

## MODIFIED Requirements

### Requirement: 规划批准独立于 Change MR

Repoctopus MUST 在没有 Change MR 的情况下，通过当前 Specification Provider 校验 Proposal、Design、Delta Specs 和 Tasks，并使用结构化 Human Decision 记录批准、要求修改或拒绝；批准 MUST 绑定 change、Provider/schema、规范化规划语义身份、受影响能力和规范化目标分支身份。Change 分支 MUST 已公开并把 publication provenance 作为独立发布事实记录；composition、Build configuration/plan、执行进度、实现提交和 source remote/OID 不得进入 approval semantic identity，也不得单独使批准失效。

#### Scenario: 规划产物通过校验并获得批准

- **WHEN** 四类规划产物均由当前 Provider 声明为完成，Change 分支已公开且可信用户批准对应语义身份
- **THEN** Change Run 记录 Design approval Evidence，并允许进入 Build

#### Scenario: Provider 校验失败

- **WHEN** 任一规划产物缺失、无效或与当前 Provider 状态不一致
- **THEN** Runtime 不创建批准请求或进入 Build，并返回 Provider 的可定位诊断

#### Scenario: 没有可信人工交互通道

- **WHEN** Runtime 无法确认规划决定来自可信用户交互上下文
- **THEN** Runtime 保持 `design/waiting`，Agent、Runner、commit 和 MR 状态不得代替用户批准

#### Scenario: 批准后规划分支发生变化

- **WHEN** 四类产物语义、受影响能力、Provider/schema 或规范化目标分支身份与已批准事实不同
- **THEN** Runtime 使旧批准失效、返回 Design 并要求重新校验和人工决定

#### Scenario: Task 只更新完成 checkbox

- **WHEN** 已批准 Tasks 的稳定 ID、文字、结构、依赖、验收和需求映射未变，只有有效 Work 完成导致 checkbox 状态变化
- **THEN** Provider 的规划语义身份保持不变，Runtime 不要求重新批准 Design

#### Scenario: Change 分支只增加非规划提交

- **WHEN** Change 分支远端 OID 因实现、测试或合法收尾提交变化，但规划语义身份与目标分支不变
- **THEN** Runtime 更新 publication provenance，既有 Design approval 不仅因 OID 变化而失效

#### Scenario: 规划批准后尚未完成实现

- **WHEN** Change 已获得 Design approval 但 Verify 和 Archive 尚未完成
- **THEN** Runtime 不创建最终 Change MR，也不把 Design approval 解释为验证、远端副作用授权或规格关闭

### Requirement: Later phase 必须只读观察并在副作用前收敛规划授权

Build、Verify 和 Archive 中的 planning authority 检查 MUST 通过 Specification Planning 权威模块的只读接口分别观察当前 Provider planning semantic identity、strict validation、approval identity 与 publication provenance，不得由编排层拼装 Store 内部规则或在 lifecycle transition 前创建/刷新 Human Decision。仅 semantic 或 approval-authority 不再授权 lifecycle 时才可返回受限分类并原子恢复 Design；composition、执行进度和仅 publication provenance 的变化 MUST 交由各自权威处理。Status、Dashboard 和其他查询 MUST 保持只读。

#### Scenario: Build pull 发现语义变化

- **WHEN** Build pull 观察到 Provider semantic identity 与 lifecycle planning identity 不同
- **THEN** Runtime 不先改 approval Store，而是原子回到带当前 Work 的 Design；后续 Design gate 再生成绑定新身份的批准请求

#### Scenario: Archive preflight 发现 approval 失效

- **WHEN** Archive 尚未执行关闭或发布副作用，当前 Design approval 缺失、被拒绝、等待新决定或与 planning semantic identity 不匹配
- **THEN** Runtime 返回 `planning-revision-required` 和 Design checkpoint，且 Specification、Git 与平台发布 adapter 均未被调用

#### Scenario: 查询发现不一致

- **WHEN** status 或 Dashboard 读取到 approval 与 lifecycle 不一致
- **THEN** 查询报告可定位 freshness/diagnostic，但不修改 phase、approval 或 current Work；下一次受保护 Runtime pull 执行幂等收敛

#### Scenario: Archive 只发现发布来源更新

- **WHEN** planning semantic identity 与 approval identity 仍匹配，只有 publication provenance 更新
- **THEN** Runtime 保留 Design approval 和 Build/Verify 事实，只重新验证受 publication provenance 约束的 Archive 输入

## ADDED Requirements

### Requirement: Specification Planning 必须公开分层身份

Specification Planning MUST 分别公开 planning semantic、approval authority、publication provenance 与 validation observation 的版本化身份和依赖，不得以单一 snapshot digest 同时代表规划授权、Runtime composition、Build execution 或发布来源；每个观察结果 MUST 指明变化类别与其授权范围。

#### Scenario: 相同语义使用新的 composition

- **WHEN** Provider 观察到相同 planning semantic identity，但调用 Runtime 使用新的 composition identity
- **THEN** planning observation 保持 authorized，并把 composition 判定留给 Runtime compatibility 权威

#### Scenario: 远端地址仅大小写不同


```

Full source: openspec/changes/stabilize-runtime-continuation/specs/specification-authority/spec.md
