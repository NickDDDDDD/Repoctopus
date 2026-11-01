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

### 1. 用分层身份图替代聚合 planning snapshot 的跨域授权

Change Run v2 保存下列相互独立、内容寻址的身份；边只从消费者指向其实际输入：

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

### 2. 在纯领域层增加 Dependency-aware Invalidation Planner

新增纯函数 planner，输入为旧 identity graph、当前权威 observations、current checkpoint、副作用边界和 lifecycle definition；输出为：

- `classification`: `semantic | approval-authority | composition | build-input | verification-input | publication | unknown`；
- `disposition`: `continue | reconcile | invalidate | migration_required`；
- retained/invalidated identity 集合；
- Runtime 允许的唯一 successor Action；
- 低基数 reason code。

Planner 不读取文件、Git、Cordis 或网络，不创建 Human Decision，也不直接写 Run。`WorkflowRuns` 在锁外收集带 identity 的 observations，在一次 `RunStore.transaction()` 内按 expected revision 重算/核对 planner 输出并提交 transition。陈旧 observation 只返回 revision conflict。

Build Protocol 增加 `suspended-for-design` 状态和 invalidation ledger。返回 Design 时，旧 Build 状态保留为同一 Run 内不可执行的候选，而不是被删除。新 Design approval 后，planner 逐层重新验证：

1. configuration 输入仍相同则保留，否则回 Configure；
2. Plan 对新 planning/Task identity 仍完整则保留，否则回 Plan；
3. Package identity、依赖和输入仍相同则保留 completion；
4. Plan Evidence、Check 与 Verification 只在其完整输入仍匹配时保留。

无法证明安全最小范围时使用 definition 声明的保守失效或 Human Decision，并记录原因；不得静默假设兼容。

**替代方案：Design 回退继续删除 Build Protocol，再从 trajectory 推断可保留事实。** 拒绝。Trajectory 是审计历史，不应成为第二个当前状态 reducer；删除后重建也会再次引入重复批准和歧义 continuation。

### 3. Continuation 只从已提交 checkpoint 产生

公共 `next/resume/status` 共用一个只读 projector；写入口先读取 checkpoint，再执行必要 observation，最后通过单一 CAS transition 返回新 projector 结果。Projector 只接受：

- Run revision 与 lifecycle phase/status；
- current Work、attempt、`checkEpoch`；
- packet/invocation/Outcome/Validator/Human Decision identity；
- invalidation planner 的已提交结果。

它不扫描 OpenSpec 目录、Git diff 或“最新”Action 文件来推断下一步。相同命令的稳定 submission/request/invalidation key 已存在时返回原结果；不同 payload 使用同一 key 时 conflict。可纠正 Host submission 继续使用原 invocation 和新 submission ID，不新建 Work。

Crash injection 覆盖 observation 后/CAS 前、CAS 后/响应前、Outcome 后/Validator 前、Validator 后/transition 前。只有 CAS 内的 Run fact 拥有 continuation；孤立内容可清理但无执行权。

**替代方案：每次 `next` 重新观察全部当前文件并重新生成当前 Action。** 拒绝。当前 Work 自身可能合法改变文件，该方案无法区分进度与漂移，也违背不可变 packet 恢复。

### 4. Composition 采用精确 adoption，不能借 Planning approval 恢复

Composition compatibility 以受影响角色的 identity dependency closure 判定：

- `same`：继续原 checkpoint；
- `compatible-adoption`：catalog 精确声明 `{old implementation/code/config/definition identity → new identity, allowed checkpoint range}`，CAS 记录一次 adoption 后恢复原 Work 或声明 successor；
- `migration_required`：无法证明兼容，保留只读审计，禁止写入。

已 claim 的 Work 始终使用原 packet 内容；adoption 不能用新 Skill/Provider 内容重组它。尚未 materialize 的 successor Work 才使用新 composition。未进入当前 composition 或不在 current checkpoint dependency closure 的 Contributor 变化不影响 continuation。

`PlanningSemanticIdentity` 和 `ApprovalAuthorityIdentity` 不包含 composition；Specification Provider implementation 真正改变规范化语义时，由新 Provider observation 产生 semantic drift，而不是仅因代码摘要变化自动撤销批准。

**替代方案：composition 变化统一返回 Design 让用户重新批准。** 拒绝。人工批准不能证明二进制/状态 schema 兼容，也会把技术迁移责任错误转嫁给规格评审。

### 5. Unknown 结果与 Retry 使用不同状态

Invocation 一旦可能越过副作用边界，缺少 Outcome 就产生 `reconcile`，并保留 invocation identity、idempotency key、packet、attempt 和 epoch。Reconciler 只有三种合法输出：

- 找到匹配 Outcome/Receipt：从原 Validator/transition 继续；
- 确定性证明未执行：按 retry policy 创建更高 attempt；
- 仍未知：保持同一 reconcile continuation 或请求 Human Decision。

Archive 已开始的 Specification/Git/platform 副作用永不回滚到 Design；planning 或 publication observation 只形成待 reconcile 的后续事实。

**替代方案：超时即 retry。** 拒绝。它会重复外部副作用，且无法从审计链解释两个 attempt 的真实关系。

### 6. 遥测来自同一 transition fact

每次 planner/CAS 提交生成一个版本化 transition fact，同时映射 Trajectory 和规范 OTLP envelope。新增有界字段：authority、classification、disposition、scope (`exact|conservative|none`)、retained/invalidated counts、checkpoint outcome、dispatch suppression、reconciliation result。具体 identity 只进入 Trace/Event 允许列表，不进入 Metric label。

稳定性指标包括：重复批准率、Build Protocol 重建率、精确失效率、completion 保留率、checkpoint 恢复结果、reconcile 数量和 duplicate dispatch suppression。Desktop 与远端 SigNoz 消费相同 envelope，不新增查询 Store 的旁路。

### 7. 生产验收以 Comet 不变量为差分基线

测试不要求 Repoctopus 输出与 Comet 相同格式，而是为相同行为不变量建立适配后的双边 fixture：

- checkbox 变化不改变 Task/planning revision；
- stable Task/Work identity 不变时保留 checkpoint；
- checkpoint revision 过期时显式 reconcile，不重跑实现；-相同 state revision 派生唯一 continuation；
- CAS restore 拒绝归属、固定材料或嵌套 revision 漂移；-未知副作用不自动 retry。

TDD 顺序先保存当前重复 approval/全量清空的失败黑盒，再实现 identity split、planner、persistence 和 adapter。验收必须通过公共 CLI 与生产 composition，并交叉核对 Run、Trajectory、受保护文件和 OTLP test receiver；只测 reducer 或最终 phase 不算通过。

## Risks / Trade-offs

- **[身份图增加状态模型复杂度]** → 每个 identity 由单一领域 owner 产生；依赖边使用有界枚举和 schema validator，禁止任意字符串关系。
- **[错误保留陈旧 completion]** → 默认 fail closed；只有完整输入依赖相同或显式 compatibility validator 通过才保留，未知范围走保守失效/Human Decision。
- **[Design 阶段携带 suspended Build 造成双权威]** → suspended protocol 不可调度；current phase/current Work 仍是唯一执行权威，Build 事实仅作为待重新验证候选。
- **[精确 adoption 被滥用为长期兼容层]** → 仅允许唯一直接前驱和有界 checkpoint；无通配、无 generation、无多版本执行分支，后续清除已无活动引用的 adoption。
- **[遥测基数膨胀]** → Metric 只使用有界枚举和计数；identity/digest 仅在 Trace/Event 允许列表中用于审计关联。
- **[Comet 上游继续变化]** → 固定 0.5.1 为实现基线，HEAD 只做差异审计；只采用有测试证明且适合 Repoctopus 架构的不变量。

## Migration Plan

1. 先增加 v2 schema、identity constructors、dependency validator 与失败回归测试，不切换生产写路径。
2. 实现 invalidation planner、continuation projector 和 composition adoption 判定，并用 property/contract tests 固定纯领域行为。
3. 一次切换新 Run 写入、Planning/Build/Recovery/Telemetry adapter；删除旧聚合 planning invalidation 与全量清空分支。
4. 旧预发布活动 Run 标记 `migration_required` 并保持只读；不执行自动转换。当前 Runtime 自身的开发继续由外部 Comet controller 管理，直到生产黑盒门槛通过。
5. 运行崩溃注入、并发 CAS、多仓、OpenSpec strict validation、CLI/production composition 与 OTLP receiver 验收，再进行独立 review。

回退仅通过撤销尚未发布的新 Runtime 版本并从干净分支重建新测试 Run；不得把已经写入 v2 的 Run 降级为旧 schema 或手改 Store。

## Stop Conditions

- OpenSpec 主规格、Comet 行为基线或当前实现事实出现无法同时满足的冲突。
- 无法确定某类身份的唯一领域 owner，或必须建立第二个当前状态权威才能实现。
- 发现需要保留旧 Runtime 的执行兼容层、跨版本双写或不可逆外部数据迁移。
- 测试不能在生产 composition/公共协议下证明无重复批准、无重复派发和精确恢复。
