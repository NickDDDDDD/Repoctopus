---
change: separate-build-strategy-and-execution-binding
design-doc: openspec/changes/separate-build-strategy-and-execution-binding/design.md
base-ref: bafbb1b94627e4ade3692a6a04f0e8f7f31c6542
---

# Separate Build Strategy and Execution Binding Build Plan

<!-- comet-task-authority: openspec/changes/separate-build-strategy-and-execution-binding/tasks.md -->

## Context and execution contract

当前 `BuildConfigurationProposal` 把 execution/TDD/review/isolation 与 Host、capability、checkout、HEAD 共同散列并在 Build Configure 建立 Human Decision，导致机器漂移重复询问稳定选择。本计划按已批准 [Design](../../../openspec/changes/separate-build-strategy-and-execution-binding/design.md) 将协议破坏性切换为 `BuildStrategy + ExecutionBinding`，保留 Comet 0.5.1 的 `Configure → Plan → Execute → Check`、精确 proposal identity、evidence-before-effect 和增量恢复原则，同时保留 Repoctopus 的 OpenSpec、多仓、Cordis composition 与 Runtime-authoritative Action 架构。

本文件只是外部 Comet 控制器的执行投影。任务文本、完成状态与稳定 ID 只以 `openspec/changes/separate-build-strategy-and-execution-binding/tasks.md` 为权威；它不增加 checkbox、需求、Specification Provider 工件或第二套产品 BuildPlan。每个行为任务先捕获真实 RED，再做最小 GREEN；纯文档、机械删除与基线格式修复不伪造 RED。每个提交立即 push。

## Verified implementation assumptions

- `domains/change-lifecycle/build-protocol.ts` 当前同时拥有 workspace intent/binding、Build Configuration、BuildPlan、PlanEvidence 与恢复 reducer，因此领域切换应在该 owner 内完成，不新建通用 identity framework。
- `services/workflow-runs.ts` 当前在 Configure Host Outcome 后创建配置提案和 `build-configuration:*` wait；它也是 Planning、Binding、Plan、Execute、Check 与 Verify→Build 的生产协调 owner，生产切换必须在同一纵切完成。
- `domains/specification/planning-approval.ts` 的 Design snapshot 是可信规划批准 owner；Strategy 必须进入其 Design semantic identity，actual composition 继续由独立 compatibility authority 处理。
- `StartChangeRunInput` 与 `run start` 已经冻结 project snapshot/config/target inputs。第一版在这里冻结 execution/TDD/review 偏好，Design 时再与 Open 已批准的 isolation 组合成完整 Strategy；不新增 project config schema、运行中模式切换或第三个配置 Store。
- `services/desktop-projection.ts` 与 `app/desktop/renderer/src/dashboard.tsx` 消费同一 OTLP/trajectory 领域事实；UI 不从文件或本机 Runtime 查询推断决定。

## 1. 锁定退化行为并恢复 strict baseline

<!-- comet-task-ref:05cd2200-79a6-4d1a-9d6b-e4d81dc8d0b8 -->

**1.1 历史旅程 RED。** 在 `test/build-orchestration-characterization.test.ts`、`test/change-lifecycle-domain.test.ts` 与 `test/managed-change-execution.e2e.test.ts` 增加四类失败断言：相同策略的 Configure 重复批准；Host/checkout/HEAD 兼容漂移生成新决定；Verify→Build 返工重复询问；Plan 未覆盖 repository/write scope 仍能进入 Execute。测试必须计数决定、wait、Binding/Plan revision 与 dispatch，而不是只断言最终 phase。先运行定向 Vitest 并保存由旧行为导致的 RED。

<!-- comet-task-ref:3d26f41d-6da4-41a4-92b8-b31a78230db5 -->

**1.3 strict 基线修复。** 在 `openspec/specs/change-lifecycle/spec.md` 中把超过 OpenSpec 500 字符限制的“规划授权失效必须原子恢复 Design checkpoint”拆成行为等价的两个 Requirement，保留原 scenarios、授权正交性和精确失效语义。先运行 `npx openspec validate change-lifecycle --type spec --strict`，再运行 `npx openspec validate --all --strict`；本步骤不得改 Runtime 行为。

## 2. 建立 Strategy 与 Design approval 纵切

<!-- comet-task-ref:72e19e09-c249-43ad-bf86-b22f48ee075b -->

**1.2 Strategy/Binding 领域 schema RED→GREEN。** 在 `domains/change-lifecycle/build-protocol.ts` 定义 `BuildStrategy`、`ExecutionBinding` 和 `BuildProtocolState` v2；独立计算 strategy semantic digest、binding portable/state digest 与 revision。先在 `test/build-protocol-domain.test.ts` 固定字段所有权、摘要敏感度、绝对路径 overlay 隔离、schema v1 `migration_required` 及无双写行为，再实现最小领域构造器和断言。不得添加通用依赖图或兼容 adapter。

<!-- comet-task-ref:a04416b0-35c3-4bd8-8d7d-773688926156 -->

**2.1 Strategy 进入 Design authority。** 扩展 `StartChangeRunInput`、`app/cli/main.ts` 和 Change trigger facts，冻结 `executionMode`、`tddMode`、固定 `reviewMode=standard`；CLI 默认 `autonomous+tdd+standard`，允许 start flags 显式选择批准范围内的 mode。Open 仍批准 isolation；`services/specification-planning.ts` 在 Design assessment 中将这三项与已批准 workspace intent 组合为 Strategy，`domains/specification/types.ts` 与 `planning-approval.ts` 把完整 Strategy 摘要纳入 Design snapshot/proposal。Open snapshot 不提前绑定尚未批准的 isolation；composition code/config identity 不进入 snapshot。用 `test/specification-planning-approval.test.ts`、`test/specification-planning-service.test.ts` 和 CLI contract tests 证明 Strategy 变化刷新 Design decision，compatible composition adoption 不刷新批准。

<!-- comet-task-ref:f1718834-e265-4284-bb8e-c04e5529e2cc -->

**2.2 统一 Human Decision identity。** 在 planning approval 与 lifecycle decision helper 中以 `decisionKind + semanticDigest` 确定 request identity，保留 proposal hash、Run revision 和 CAS 防陈旧提交。相同摘要的 retry/resume/Runner 交接/Verify 返工返回原 request 并记录 reused；真实 Strategy 变化 supersede 旧决定。优先复用现有 `requestSpecificationApproval` 幂等逻辑，不创建第二个 decision service。以 `test/human-decision.test.ts`、planning approval tests、transition tests 固定 created/reused/superseded 计数。

## 3. 用自动 Binding Configure 替换配置审批

<!-- comet-task-ref:f01879d2-0ca9-4f01-8079-a347df6b1af6 -->

**3.1 Configure 纵切。** 把 `domains/work-execution/types.ts` 的 `build-configuration-candidate` 替换为 `execution-binding-candidate`，Host 只提交当前 Strategy 下的 Host identity/capability 和 workspace observation；`services/managed-work-executor.ts` 在 acceptance boundary 拒绝缺字段或越界候选。`services/workflow-runs.ts` 复用 `ExecutionWorkspace` authority 验证 current/branch/worktree、多仓 repository/branch/head/worktree ownership 与 Host capability，将绝对路径写入本地 overlay，并自动接受 Binding 后派发 Plan。可纠正失败保留同一 Work/attempt/checkEpoch；intent 不兼容仍走既有 Open revision；composition 不兼容进入独立 `migration_required`。

在 `test/execution-workspace.test.ts`、`test/managed-work-executor.test.ts`、`test/build-protocol-domain.test.ts` 和 production E2E 中覆盖三种 isolation、多仓、跨 Runner Host、HEAD drift、路径隐私和 capability 不足。最小 tracer bullet 是单仓 Design-approved Strategy → Configure Binding → 自动 Plan，断言零 Build Configure wait。

<!-- comet-task-ref:981953df-9058-4f29-a3b4-da5eac884f51 -->

**3.2 删除旧生产路径。** 从 `build-protocol.ts`、`transition.ts`、`definition.ts`、`workflow-runs.ts`、`build-work.ts`、`work-execution/types.ts`、`managed-work-executor.ts`、CLI view 与 tests 删除 `BuildConfigurationProposal`、`BuildConfiguration`、`create/acceptBuildConfiguration`、`configurationProposal/configuration`、`build-configuration-candidate`、`build-configuration-proposed/decision`、`build-configuration:*` wait 和 `configurationId/configurationDigest`。Validator profile 改为 Binding-valid，Configure definition 自动进入 Plan。旧预发布状态只返回结构化只读 `migration_required`，不得双读、补默认值或可写转换。用架构测试和定向 `rg` 证明旧生产入口为零。

## 4. 加强 Plan Evidence 与精确返工

<!-- comet-task-ref:b1365a0b-4839-46b5-afce-f1edf4af3796 -->

**4.1 Plan preflight RED→GREEN。** 扩展 `BuildPlan`/`PlanEvidence`，明确绑定 Task revision/acceptance、planning digest、Strategy、Binding state、独立 composition checkpoint、repository topology/dependency DAG、repository/write scope authorization、terminal report owner、validator profile 与 risk policy。`services/workflow-runs.ts` 必须在创建 Execute Work 前返回结构化 planning findings；每类缺失/越界输入单独 fail closed，完整输入才自动 Execute。更新 `test/build-protocol-domain.test.ts`、`test/build-orchestration-verification.test.ts` 与 Plan submission E2E。

<!-- comet-task-ref:5d6bb744-f0cc-40d3-9df1-303bc26a6ee5 -->

**4.2 精确失效矩阵。** 在纯领域 reducer 固定 Design→Configure、Configure→Plan、Binding/HEAD drift、Strategy change、compatible/incompatible composition、Plan correction、bounded risk pause、Build Check 和 Verify→Build 的 retained/invalidated 集合。`services/workflow-runs.ts` 用该矩阵替换 `canRetainSuspendedBuildConfiguration` 等配置聚合判断：Binding 漂移只重建依赖旧 state 的 Plan/Evidence/未执行 Work；Strategy 变化回 Design；Verify finding 递增 checkEpoch 并保留无关 completion。相同决定不重建。以 `test/runtime-invalidation-scope.test.ts`、transition/domain tests、跨 Runner 和 Verify repair E2E 证明精确结果与 CAS 重放幂等。

## 5. 观测、Desktop 和正式验收

<!-- comet-task-ref:43579ae8-578e-44ad-bd3e-9521f776db05 -->

**5.1 Trajectory/OTLP。** 在 trajectory allowlist、`platform/telemetry/opentelemetry/mapping.ts` 与 observation service 增加 Strategy proposed/approved/reused/invalidated、Binding validated/drifted/rejected、Decision created/reused/superseded/resolved 和 Plan preflight accepted/rejected。Trace/Event 可用 opaque identity 关联；Metric labels 仅使用有界 phase/action/mode/result/reason，禁止绝对路径、正文、用户输入和摘要片段。更新 telemetry mapping、cardinality、offline replay 与 managed execution OTLP E2E。

<!-- comet-task-ref:993c22b8-3dd0-4c63-a740-0f6458135214 -->

**5.2 Desktop projection。** 更新 `services/desktop-projection.ts`、`app/desktop/shared/renderer-contract.ts`、`app/desktop/renderer/src/dashboard.tsx` 及 reducer/component tests，显示 Strategy、当前 Binding 自动重验、独立 composition compatibility 和决定历史；同一语义只能有一张 waiting card，reused/superseded 进入 timeline，不把自动验证显示成人工等待。保持接收同一 OTLP envelope，不新增查询轮询路径。

<!-- comet-task-ref:9773fc73-5b85-4c9d-bbbe-8da3f958b931 -->

**5.3 文档、生产 E2E 与验证报告。** 更新 `docs/runtime-state.md`、`docs/self-hosting.md`、`docs/specification.md` 和 `docs/skills.md` 的最终术语与命令；加入单仓、多仓、跨 Runner 恢复真实 E2E，核对 Strategy/Binding/Plan Evidence identity、零重复决定及本机路径隐私。生成 `verification/separate-build-strategy-and-execution-binding/verification-report.md`，绑定最终 HEAD、命令、Evidence 与未执行项；不创建 implementation notes。

## Files to modify

- **Strategy/planning authority:** `domains/change-lifecycle/build-protocol.ts`, `domains/specification/types.ts`, `domains/specification/planning-approval.ts`, `services/specification-planning.ts`, `services/workflow-runs.ts`, `app/cli/main.ts`。
- **Binding/Run orchestration:** `domains/change-lifecycle/transition.ts`, `domains/change-lifecycle/definition.ts`, `domains/change-lifecycle/build-work.ts`, `domains/work-execution/types.ts`, `services/execution-workspace.ts`, `services/managed-work-executor.ts`, `services/work-execution-authority.ts`。
- **Observation/UI:** `domains/trajectory/observation.ts`, `platform/telemetry/opentelemetry/mapping.ts`, `services/desktop-projection.ts`, `app/desktop/shared/renderer-contract.ts`, `app/desktop/renderer/src/dashboard.tsx`。
- **Specs/docs/tests:** current OpenSpec main specs, the targeted test files named above, final docs and verification report。只有实际编译或测试证明需要时才扩展此清单；不得顺手重构无关 Runtime。

## Scope cuts

- 不增加 Hotfix/Tweak profile、Direct execution、Executing Plans、运行中策略升级或任意 Action Skill 替换。
- 不新增 project configuration schema、通用 capability resolver、任意 identity graph、新依赖或后台服务；Run start 的稳定偏好复用既有 trigger snapshot。
- 不复制 Comet 源码、单仓 Store 或 Classic 产品格式；只重建已审计行为不变量。
- 不把 composition 并入 Strategy，不改变 OpenSpec 四工件权威，不建立第二套 Task/checkbox。
- 不兼容旧预发布 Run 的继续执行；只提供可诊断 `migration_required`。

## Failure handling and STOP conditions

普通 candidate/validation 失败保留原 Run、Work、attempt、checkEpoch 和冻结输入，修复后只重跑受影响 RED/GREEN/审查集合；未知外部结果先 reconcile，只有确定未执行才增加 attempt。任何提交后立即 push，临时日志、测试 receiver 数据和配置草稿在验证后清理。

出现下列任一事实必须停止并回到 revision-bound Design，而不是即兴扩展：

- Design approval 无法在不解析自由文本的情况下绑定完整 Strategy；
- 兼容 Host/HEAD/path/composition 漂移仍必须创建人工策略决定；
- Plan Evidence 在 Execute 前无法取得 repository/write scope 或 terminal report owner；
- 实现要求把绝对路径写入 portable state/OTLP，或要求保留旧 BuildConfiguration 可写双路径；
- OpenSpec Tasks 之外出现第二个完成权威，或 Comet 行为只能通过复制其产品状态格式实现。

## Verification

按风险递增执行，任一失败都修复根因，不放宽门禁：

1. `npx vitest run test/build-protocol-domain.test.ts test/change-lifecycle-domain.test.ts test/build-orchestration-characterization.test.ts test/build-orchestration-verification.test.ts`
2. `npx vitest run test/specification-planning-approval.test.ts test/specification-planning-service.test.ts test/execution-workspace.test.ts test/managed-work-executor.test.ts test/runtime-invalidation-scope.test.ts`
3. `npx vitest run test/telemetry-mapping.test.ts test/desktop-projection.test.ts test/managed-change-execution.e2e.test.ts test/e2e/managed-execution-otlp.e2e.test.ts`
4. `npx openspec validate change-lifecycle --type spec --strict && npx openspec validate --all --strict && npm run spec:validate`
5. `npm run typecheck && npm run lint && npm test`
6. `npm run check:architecture && npm run check:provenance && npm run verify`
7. `git diff --check`、旧协议定向 `rg`、`git status --short`；期望无旧生产入口、无临时产物、所有检查退出码为 0。

## Plan review

PLAN TRIAGE（2026-11-01）：Completeness 5/5；Feasibility 5/5；Scope 5/5；Testability 5/5；Risk 5/5；Assumptions 5/5。载荷假设已用现有领域 owner、WorkflowRuns 生产路径、Planning approval identity、CLI Run trigger 与 Desktop OTLP 投影核对。最小纵切、失败恢复、破坏性 schema 边界、scope cuts、STOP conditions 和逐级验证均已明确；没有未解决项。
