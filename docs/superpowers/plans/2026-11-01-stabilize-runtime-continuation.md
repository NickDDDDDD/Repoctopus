---
change: stabilize-runtime-continuation
design-doc: openspec/changes/stabilize-runtime-continuation/design.md
base-ref: 0ddd667ea9a0b8be9f8192a3608d2ef526dea4cb
---

# Stabilize Runtime Continuation Build Plan

<!-- comet-task-authority: openspec/changes/stabilize-runtime-continuation/tasks.md -->

## Execution contract

本计划是 Comet Build 的执行投影；任务完成状态、任务文本和稳定 ID 只以 `openspec/changes/stabilize-runtime-continuation/tasks.md` 为权威。实施遵循已批准的 [Design](../../../openspec/changes/stabilize-runtime-continuation/design.md)，不增加 phase、generation、repair lifecycle、后台进程、兼容旧预发布 Run 的双读或第二个当前状态权威。

执行顺序按下列八个结果段推进。每个实现任务先运行所列 RED 命令并保存由缺失行为导致的失败，再进行最小实现并运行对应 GREEN；文档、删除和最终验证任务不伪造 RED。每个可独立接受的结果在依赖它的下一段开始前接受 thorough 独立审查。任何未知外部副作用先 reconcile，任何无法证明精确保留的 identity 默认 fail closed。

## 1. 锁定缺陷并建立 v2 状态契约

<!-- comet-task-ref:300bb461-3de3-4765-bb81-0408d0c20a89 -->

**1.1 Planning drift 回归基线。** 范围是 planning approval/service 既有契约测试；依赖当前 `PlanningSnapshot` 行为，无实现依赖。约束是分别证明 composition、完整 project config、remote 表示差异不应改变 planning semantic，同时真正的规格语义变化仍应失效。接受以 `npx vitest run test/specification-planning-approval.test.ts test/specification-planning-service.test.ts` 的目标 RED 和后续 GREEN 为准。

<!-- comet-task-ref:2c460e82-0b53-4c9e-8b99-bfd4282d1a7c -->

**1.2 全量重建与重复派发回归基线。** 范围是 `workflow-runs`、change lifecycle 和生产 service 测试；依赖 1.1 的缺陷分类。约束是同时观察 Build Protocol completion、approval request 与 Work dispatch 次数，不能只断言最终 phase。接受为定向 lifecycle/service 测试先捕获旧行为，再在实现后无重复请求、无重复派发且保留可兼容 completion。

<!-- comet-task-ref:668ccfb2-6f89-4b9e-83c0-c927c687c713 -->

**1.3 Typed identity basis 与固定矩阵。** 范围是领域 schema、构造器和 validator；依赖 1.1/1.2 的失败样本。约束是 identity owner 与依赖边使用穷尽类型和代码固定矩阵，不接受任意字符串图、未知组合、缺失输入或非 SHA-256 digest。接受为新增领域单元测试覆盖合法 round-trip 及全部拒绝分支，并通过 `npm run typecheck`。

<!-- comet-task-ref:0ed0c3ad-b64d-405c-b308-9da9a79bb1dc -->

**1.4 Change Run v2 checkpoint。** 范围是 Run schema、序列化和 Build Protocol suspended candidate；依赖 1.3 的 identity 类型。约束是一次破坏性替换预发布 schema，旧 Run 只读，不做转换、双读或 fallback；`phase/currentWork` 始终是唯一执行权威。接受为 round-trip、schema invariant 和不可调度 suspended Build 测试通过。

<!-- comet-task-ref:270a001b-4815-453b-bf59-3953ac43f598 -->

**1.5 v2 状态文档。** 范围是 `docs/runtime-state.md`；依赖 1.3/1.4 的最终命名。约束是明确身份 owner、schema 破坏性边界和旧 Run 只读诊断，不描述未实现兼容路径。接受为文档示例与公共 schema 一致并通过 `npm run format:check`。

## 2. 拆分 Specification Planning 与发布身份

<!-- comet-task-ref:782227c7-2126-4b86-9bfc-2756a4dabe09 -->

**2.1 身份构造器契约。** 范围是 planning semantic、approval authority、validation observation 与 publication provenance 测试；依赖 1.3。约束是 checkbox、source OID、无关 composition 不改变语义，而四工件、规划 metadata、target branch 和 policy 改变语义。接受为参数化构造器 RED/GREEN 测试固定每一字段的 owner。

<!-- comet-task-ref:86905b09-fbaf-481f-8a1a-c2f0fc969718 -->

**2.2 PlanningSemanticIdentity。** 范围是 Specification Planning 领域模型与 planning policy 投影；依赖 2.1。约束是从聚合 digest 中移除完整 composition、完整 project config 和 source OID，只投影影响规格含义、验证策略或关闭行为的配置。接受为 2.1 全部 GREEN，既有真实语义漂移测试继续通过。

<!-- comet-task-ref:9f07488e-0652-4e74-baa8-dfa977526200 -->

**2.3 Repository/publication 规范化。** 范围是 Git/platform adapter 的 stable repository ID、remote/base/head identity；依赖 1.3 与 2.1。约束是 stable ID 优先，只有平台明确规则才折叠大小写；未知平台或不可证明等价必须返回不确定而非猜测。接受为 GitHub 大小写、`.git`、分隔符、URI 和未知平台矩阵测试通过。

<!-- comet-task-ref:4da89c4d-cbdb-4afe-bad3-1e7ada1ecd05 -->

**2.4 Approval authority 幂等化。** 范围是 planning approval request/record/store；依赖 2.2。约束是 request key 绑定 semantic 与 authority identity，相同 payload 重放返回原决定，不同 payload 冲突，不刷新既有决定。接受为 approval domain tests 证明单请求、单决定和 conflict 行为。

<!-- comet-task-ref:a5fe4dd3-21f5-4d08-894c-d5c691203a6b -->

**2.5 只读 authority observation。** 范围是 Specification Planning service `observeAuthority`；依赖 2.2-2.4。约束是只返回分层 observation 与 `semantic | approval-authority | publication | unknown`，只读路径不得创建 proposal、刷新 request 或写 Store。接受为 service contract tests 校验零写入和精确分类。

<!-- comet-task-ref:f59b55c9-e6dd-436b-b98e-b21e58bf7b9d -->

**2.6 Specification 身份文档。** 范围是 `docs/specification.md`；依赖 2.2-2.5。约束是区分语义、批准、观察和发布 owner，publication-only 更新不得被描述为 Design 漂移。接受为 `npm run spec:validate` 与格式检查通过。

## 3. 依赖感知失效与 Design 返工

<!-- comet-task-ref:6eb6ebe3-22fc-42f6-95e9-6edf17c23e5d -->

**3.1 失效矩阵契约。** 范围是纯领域 parameterized tests；依赖第 1、2 段 identity basis。约束是覆盖 semantic、approval、composition、build-input、verification-input、publication、unknown 的 retained/invalidated 集合和唯一 successor。接受为每个分类至少一个 exact 和 conservative 案例，顺序规范化结果稳定。

<!-- comet-task-ref:c72de8ac-d78b-4fe8-aaad-ffc7ef7b2ec4 -->

**3.2 Invalidation Planner。** 范围是纯领域 planner 与 reason codes；依赖 3.1。约束是无文件、Git、Cordis、网络访问，不直接创建 Human Decision 或写 Run；相同输入必须产生字节稳定的规范结果。接受为 3.1 GREEN、determinism/property tests 和 architecture boundary tests 通过。

<!-- comet-task-ref:86f0970c-cc7f-49e1-a241-143c41a96587 -->

**3.3 Suspended Build reducer。** 范围是 Build Protocol reducer、invalidation ledger 和调度守卫；依赖 1.4、3.2。约束是候选保留但不可 claim/dispatch，current phase/current Work 独占执行权。接受为 reducer tests 证明 Design 中不能领取旧 Work，历史 completion 未被删除或误执行。

<!-- comet-task-ref:84791012-882d-4f71-bd2a-13be3c917c92 -->

**3.4 分层兼容重验。** 范围是 Configuration → Plan → Package completion → Evidence 的 compatibility validators；依赖 3.2/3.3。约束是逐层比较完整输入依赖，任一层失效只级联依赖后继；未知默认保守。接受为局部 Task、Plan、配置和 Evidence 变化矩阵证明未受影响 completion 被保留。

<!-- comet-task-ref:b9e6486b-e7e3-4867-af72-33484ff1b4d4 -->

**3.5 Planning recovery 原子提交。** 范围是 WorkflowRuns/planning-authority recovery transaction；依赖 3.2-3.4。约束是锁外 observation、锁内按 expected revision 重算并一次提交 Design Work、epoch、execution retirement、planner result；禁止无条件删除 Protocol。接受为 transition/CAS tests 证明 revision conflict 无部分写入且重放不新增 Work。

<!-- comet-task-ref:308f4d40-d472-47da-8f0b-1ce5e8272ed1 -->

**3.6 保守失效与 Human Decision。** 范围是 planner/Runtime 的 unknown 路径；依赖 3.2/3.5。约束是只有 definition 声明的路径可请求人工决定，不能把人工批准当技术兼容性证明，也不能静默保留或重开全部 Task。接受为未知依赖测试返回稳定 conservative scope、单一 decision 或 blocker。

<!-- comet-task-ref:84b060d5-8cb8-4f58-87e0-5aac150f8a93 -->

**3.7 自举返工文档。** 范围是 `docs/self-hosting.md`；依赖 3.3-3.6。约束是说明 suspended candidate、重验和恢复，不引入专用 repair lifecycle。接受为命令示例可复现且 `npm run format:check` 通过。

## 4. 单一 Continuation 与 checkpoint 恢复

<!-- comet-task-ref:f61ce630-8614-4eb9-a26e-9e0d56130983 -->

**4.1 重放幂等契约。** 范围是 next/resume、approval、Outcome、transition 的同 revision 测试；依赖 Run v2 与 3.5。约束是分别计数 Work、request、invalidation、side-effect intent，不能仅比较响应。接受为并行与串行重放均只产生一个持久事实。

<!-- comet-task-ref:3353f049-d017-4091-80d0-564615115065 -->

**4.2 Shared continuation projector。** 范围是 CLI、Runtime、Dashboard 共用的只读 projector；依赖 4.1。约束是只消费已提交 checkpoint，不扫描 OpenSpec、Git diff 或最新文件推断 Action。接受为 projection parity tests 在同一 revision 输出相同 continuation 与诊断。

<!-- comet-task-ref:6cc3e6aa-2255-4fd5-aef9-b9cffa075a99 -->

**4.3 稳定 submission/request keys。** 范围是 Human Decision、Build Configuration、Plan、submission、invalidation identities；依赖 4.2。约束是 key 绑定有界完整 payload，相同 payload 复用，不同 payload 使用同 key 必须 conflict。接受为重放和 payload-conflict 测试通过。

<!-- comet-task-ref:0b75b0e4-18f9-461a-b211-e4c10e401bd0 -->

**4.4 Crash-window 恢复。** 范围是 observation/CAS、Outcome/Validator、Validator/transition 注入点；依赖 4.2/4.3。约束是只有 CAS 内事实拥有执行权，孤立内容不得成为 continuation；已提交 transition 在响应丢失后可重放。接受为 fault-injection tests 覆盖四个窗口且无重复副作用。

<!-- comet-task-ref:c6041416-5cbf-49fc-adc1-dad3746e9762 -->

**4.5 Unknown invocation reconciliation。** 范围是 execution recovery state machine；依赖 4.3/4.4。约束是匹配 Outcome、确定性未执行、仍未知三分支穷尽；只有第二种可提高 attempt，未知绝不自动 retry。接受为三分支 tests 和副作用计数断言通过。

<!-- comet-task-ref:84532c93-f1ea-44c9-997e-f20a3b2596fc -->

**4.6 Lifecycle/Execution checkpoint 兼容。** 范围是 current Work 与 execution checkpoint guard；依赖 3.2、4.2、4.5。约束是 publication-only 变化保留 checkpoint，受保护输入漂移通过单次 CAS 退役，不能产生替代 generation。接受为 `test/work-execution-recovery.test.ts` 及 lifecycle recovery tests 通过。

<!-- comet-task-ref:99d409c0-aa58-4451-b4a4-2928f77516af -->

**4.7 公共 continuation 契约。** 范围是 CLI JSON schema、诊断和 `docs/runtime-state.md`；依赖 4.2-4.6。约束是保持 bounded reason codes，不泄漏本机路径或正文；文档示例必须来自公共命令。接受为 CLI contract tests、`npm run typecheck` 和格式检查通过。

## 5. Composition adoption 与 planning 解耦

<!-- comet-task-ref:959d4d53-5fca-4529-b9e0-20211d7a3339 -->

**5.1 Composition compatibility 矩阵。** 范围是 `same | compatible-adoption | migration_required` 领域测试；依赖 typed composition/checkpoint identity。约束是覆盖未使用 Contributor、已 claim packet、definition 唯一直接前驱、不完整或多前驱 adoption。接受为完整矩阵先 RED 后 GREEN。

<!-- comet-task-ref:82f323d4-fad3-4ea7-86d3-aea22b108232 -->

**5.2 Dependency-closure authority。** 范围是 composition compatibility service；依赖 5.1。约束是只看 current checkpoint 实际依赖 closure，未使用 Contributor 变化不阻断，不能借 planning approval 恢复技术兼容性。接受为 5.1 与现有 composition observability tests 通过。

<!-- comet-task-ref:c88950ab-88a5-4383-864f-ce1c6090e738 -->

**5.3 精确 adoption catalog。** 范围是 old/new code、config、definition identity 与 CAS adoption fact；依赖 5.2。约束是唯一直接前驱、有界 checkpoint、一次性事实；拒绝通配、多前驱、已 claim packet 重组。接受为 catalog validation、CAS 重放和 packet immutability tests 通过。

<!-- comet-task-ref:4eef3cad-bfc1-4946-929f-a0e1b1ee861c -->

**5.4 `migration_required` 原地停机。** 范围是 Runtime 状态、status/doctor 只读投影；依赖 5.2/5.3。约束是不建第二个 Run、不返回 Design、不创建 approval，写入口全部阻断而审计可读。接受为 incompatible composition 纵切测试证明状态稳定和零新增决定。

<!-- comet-task-ref:4c90e986-4fff-4b77-8d3a-a37feb70f8f9 -->

**5.5 Composition 职责文档。** 范围是现有 plugin/composition 文档；依赖 5.2-5.4。约束是区分 implementation adoption 与 Provider semantic observation，不承诺通用兼容层。接受为 `npm run check:architecture` 和格式检查通过。

## 6. Trajectory 与 OTLP 稳定性证据

<!-- comet-task-ref:9e08d44a-30ec-4797-b448-109629e8885d -->

**6.1 版本化领域事实。** 范围是 planner result、retained/invalidated counts、checkpoint recovery、dispatch suppression、reconciliation schemas；依赖第 3-5 段最终 reason codes。约束是 allowlist 字段、低基数枚举，不含路径、正文或自由错误。接受为 schema round-trip 和敏感字段拒绝测试通过。

<!-- comet-task-ref:24d0e706-da6b-45ea-8d0a-a5dec0a554b2 -->

**6.2 OTLP 映射。** 范围是规范 Trace/Event/Metric envelope mapping；依赖 6.1。约束是 identity 仅进入允许的 Trace/Event，Metric labels 只含 authority/classification/scope/result/continuation 等有界值。接受为 telemetry mapping 与 cardinality tests 通过。

<!-- comet-task-ref:8ab84e75-0362-47c0-8e13-2c4e5485dd76 -->

**6.3 稳定性指标。** 范围是重复批准率、Protocol 重建率、精确失效率、completion 保留率、checkpoint recovery、duplicate dispatch suppression 聚合；依赖 6.1/6.2。约束是指标可从持久事件复算，不读取可变内存投影。接受为事件重放得到相同指标并覆盖零分母。

<!-- comet-task-ref:739daf07-a69a-4a8e-a6b5-c13dd06e835a -->

**6.4 双目的地纵切。** 范围是 OTLP test receiver、本地 Desktop 与远端 exporter；依赖 6.2/6.3。约束是两端消费同一 envelope，任一 exporter 失败不得回滚 Run 或改变 continuation。接受为 dual-destination e2e 对比 envelope identity 且注入失败后 Run 已提交。

<!-- comet-task-ref:e21c0e16-466f-4aab-8b50-a38ae543ff87 -->

**6.5 遥测解释文档。** 范围是 `docs/telemetry.md`；依赖 6.2-6.4。约束是说明每个指标可回答的问题、不可推断边界与 SigNoz 有界查询维度。接受为 `npm run format:check` 通过且示例字段与 schema 一致。

## 7. 生产纵切与恢复验收

<!-- comet-task-ref:67020eb2-6b7e-4f05-81f5-e445fd0a64d1 -->

**7.1 Cordis production composition 接线。** 范围是 typed identity、Planner、Planning、Build、Recovery、Composition、Telemetry 的生产 provider/service wiring；依赖第 2-6 段。约束是公共 CLI 真实启动 fresh Run，不使用测试旁路或替代 Store。接受为 app boot/service composition 与 fresh-run CLI 纵切通过。

<!-- comet-task-ref:92167e9d-1821-4485-a2b6-2b4b6d968108 -->

**7.2 Adapted Comet parity fixtures。** 范围是行为不变量 fixtures；依赖 7.1。约束是只比较 checkbox revision、stable ID、stale reconcile、唯一 continuation、CAS drift、unknown retry 等行为，不复制 Comet 产品格式或代码。接受为固定 Comet 0.5.1 基线与 Repoctopus adapter 两侧断言通过。

<!-- comet-task-ref:959dc25a-fc35-4985-afc7-a1bed0dd1e48 -->

**7.3 单仓/多仓精确返工。** 范围是 synthetic multi-repo e2e；依赖 3.4、7.1。约束是 Design 只改一个仓的 Task/Plan 后仅重做受影响 Work Package，其他 completion/evidence 与 repository binding 保持。接受为前后 checkpoint、包、证据和 binding digest 精确比对。

<!-- comet-task-ref:0f7fb55a-f510-4fb8-a2d2-d3dc7954aafe -->

**7.4 全阶段中断恢复矩阵。** 范围是 Open、Design、Build Configure/Plan/Execute/Check、Verify、Archive 前置；依赖 7.1。约束是交叉核对 Run、Trajectory、packet、受保护文件、OTLP receiver，未知外部结果不得盲重试。接受为每一注入点的 continuation、持久事实和副作用计数符合设计。

<!-- comet-task-ref:ebfb5802-4c21-4b6f-8f72-54fe5aaf0a49 -->

**7.5 并发 Runner/CAS。** 范围是同 checkpoint 并发命令；依赖 4.1-4.5、7.1。约束是一个 claim、一个 Human Decision、一个 invalidation、一个外部 intent；失败者得到 revision conflict/原结果。接受为可重复并发测试无竞态偶发。

<!-- comet-task-ref:d786c49e-70ff-4dc0-a65e-135b53fd427c -->

**7.6 公共 CLI composition 行为。** 范围是 compatible adoption、migration_required、publication-only 生产 CLI 流程；依赖 5.4、7.1。约束是不绕过 Runtime service，不直接改 Store。接受为 CLI 输出和持久 Run 同时证明无重复批准、无错误返 Design。

<!-- comet-task-ref:1949872e-230f-4046-a120-1a21df0e907b -->

**7.7 第三方来源审计。** 范围是 provenance manifest 与本次 diff；依赖实现完成。约束是仅行为重建时记录审计结论且不新增源码快照；若出现实质复制，必须固定 commit/path/digest/license。接受为人工 diff 审计与 `npm run check:provenance` 通过。

## 8. 删除旧语义并完成交付前验证

<!-- comet-task-ref:5a8f9678-370e-42cd-a863-24dace56a676 -->

**8.1 删除旧生产路径。** 范围是聚合 PlanningSnapshot 授权、全量 Protocol 清空、composition→planning drift、重复 proposal 构造；依赖新路径生产纵切通过。约束是无兼容 shim 或死分支保留。接受为 `rg` 无生产引用、architecture tests 和相关回归测试通过。

<!-- comet-task-ref:d9b7f7ec-5be0-43e8-9f72-ca4485aa8fa1 -->

**8.2 清理旧 fixtures/schema。** 范围是预发布 migration fixtures 与旧全量失效断言；依赖 8.1。约束是不增加 generation、双读、fallback adapter、Store 修复命令；旧 Run 只读诊断仍受测。接受为 migration/read-only tests 和全仓类型检查通过。

<!-- comet-task-ref:08a88783-5f1b-47cf-aad6-c35ae9a32cb5 -->

**8.3 最终公共文档。** 范围是 `docs/specification.md`、`docs/runtime-state.md`、`docs/self-hosting.md`、`docs/telemetry.md`；依赖全部公共行为稳定。约束是去除中间设计和旧命令，只保留可运行示例。接受为逐条执行文档命令、格式检查和 spec validation 通过。

<!-- comet-task-ref:7843b6f1-2c1b-4f0c-98a5-bf5fc9bfb593 -->

**8.4 全量工程回归。** 范围是 Runtime、领域、服务及所有既有能力；依赖 8.1-8.3。约束是修复根因，不放宽 lint/type/test 或跳过测试。接受为 `npm run typecheck && npm run lint && npm test` 连续通过。

<!-- comet-task-ref:5411ed42-b3c3-4595-a9ec-9c3a3c54d77c -->

**8.5 正式 Verification Evidence。** 范围是完整 verify、OpenSpec strict validation 和工作区卫生；依赖 8.4。约束是证据绑定最终 HEAD/tree/config/tool 输入，不把临时日志或调试输出提交。接受为 `npm run verify`、`npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate stabilize-runtime-continuation --strict`、`git diff --check` 全部通过并清理临时产物。

<!-- comet-task-ref:99fe553e-8039-4503-bc20-5a680f622d7f -->

**8.6 高风险独立复核。** 范围是 identity owner、失效范围、unknown side effect、CAS 原子性、多仓 binding、遥测基数与最终 diff；依赖 8.5。约束是 reviewer 与实现上下文独立，CRITICAL/IMPORTANT 必须修复并重跑受影响验证，非阻断偏差记录理由。接受为零阻断 finding 后才由 Comet 推进 Build Check/Verify。

## Failure handling and rollback

实现中的普通失败保留同一 Run、task ID 与 checkpoint，修复后重跑最小受影响 RED/GREEN/审查集合。设计假设失效时停止实现并经 Comet 的 revision-bound Design 返工入口处理；不得直接改 phase 或手改 `comet-state.yaml`。未知外部结果保持 reconciliation；只有确定性证明未执行才创建新 attempt。

本 Change 尚未正式发布，回退单位是尚未交付的新 Runtime 代码提交；从干净分支重建测试 Run，不把 v2 Run 降级成旧 schema。若发现需要旧 Run 执行兼容、第二状态权威、通用 identity graph 或不可逆数据迁移，立即触发 Design 的 Stop Condition，而不是扩大实现范围。
