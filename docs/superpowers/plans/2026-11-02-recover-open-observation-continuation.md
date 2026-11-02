---
change: recover-open-observation-continuation
design-doc: openspec/changes/recover-open-observation-continuation/design.md
base-ref: 2fe7cce58e0016c4b61b40630cec5f7e737d0811
---

# Recover Open Observation Continuation Build Plan

<!-- comet-task-authority: openspec/changes/recover-open-observation-continuation/tasks.md -->

## Execution contract

本计划是 Comet Build 的执行投影；任务文本、完成状态、稳定 ID 与 Acceptance 只以 `openspec/changes/recover-open-observation-continuation/tasks.md` 为权威。实现遵循已批准的 [Design](../../../openspec/changes/recover-open-observation-continuation/design.md)，固定 `build_mode=autonomous`、`tdd_mode=tdd`、`review_mode=thorough`、`subagent_dispatch=null` 和当前公开分支。

每个实现段保持真实 RED/GREEN：先证明失败由目标缺陷造成，再做最小领域实现并运行直接相关测试。不得通过回退 `validated`、重放 Host、修改旧验收 Store、解析错误文本、忽略 identity drift 或把 content drift 静默接受来转绿。每个可独立验证的提交立即 push；若实现要求改变已批准的 continuation 或 drift 权威边界，停止并返回 Design。

## 1. 复现两阶段 Open 失败窗口

<!-- comet-task-ref:2da357b8-8ddf-44ad-883e-6e75c9cf4213 -->

**1.1 锁定 branch observation RED。** 扩展 `test/managed-change-execution.e2e.test.ts` 或更小的 Service fixture：完成真实 Outcome、strict validation 与 `markValidated` 后，只让 `project.changeBranch` 失败一次。断言第二次 pull 当前错误投影为 execute，并保存 Work/attempt/epoch/Outcome/receipt/invocation 基线。

<!-- comet-task-ref:35e0414e-27dd-4018-996f-2ba3d75fdf2b -->

**1.2 锁定 planning assessment RED。** 在相同 checkpoint 对 `specificationPlanning.assess` 注入一次 unavailable，证明该入口具有同一缺陷且没有 Host reconcile/repair Work副作用。

<!-- comet-task-ref:33fb1e43-a8c4-4d98-8513-6ecedb96db2a -->

**1.3 锁定 resume content drift RED。** 用稳定 repository id/remote/branch/path/topology、仅 HEAD/worktree变化的 snapshot 调用 resume，证明当前实现错误设置全局 reconciliation。运行目标测试确认三个 RED 均由缺失行为失败。

## 2. 单一 continuation classifier

<!-- comet-task-ref:ab0dc4db-dede-40a3-92aa-e99525b5c1c5 -->

**2.1 建立纯领域状态表。** 为 classifier 参数化覆盖无 execution、活动 claim、Outcome、Open validated、其他 phase validated、unknown 与 terminal/wait边界；固定 `reobserve/open-gate-pending` 与 reconcile的唯一合法来源。

<!-- comet-task-ref:a4b4deff-59e3-4d96-81a6-041a20cd3464 -->

**2.2 从 recovery 抽取并接入。** 让 `WorkExecutionAuthority.recovery()` 使用 classifier，新增有界 `open-gate-pending` reason；Open validated保持 validator receipt并直接进入 `advanceOpenGate`。运行 recovery、Open lifecycle 与第一段测试转绿。

<!-- comet-task-ref:8e03f9d7-a8ac-4c2d-aa1b-33196188960d -->

**2.3 删除重复路由。** 让 `WorkflowRuns.next`、managed execution、resume/status next-action 共用 classifier输出；删除 raw status 猜测，保持其他 phase行为不变。运行 TypeScript、work execution recovery与 managed E2E测试。

<!-- comet-task-ref:a9e8fe50-56dc-47c3-aca6-eb36e108a0c5 -->

**2.4 并发与重复 pull。** 用 Promise 并发或 Store CAS fixture证明只创建一张 Open approval或一个 Design Work，重复 unavailable保留原执行身份且无重复 Skill consumption。

## 3. Project reconciliation 分级

<!-- comet-task-ref:ead65d0d-fcc2-47ae-b880-1f958fbfb988 -->

**3.1 锁定分类 RED。** 在 `test/project-snapshot.test.ts`（或现有等价文件）参数化 same、head、worktree、branch、remote、path、add/remove、root/project identity与 diagnostics；无法分类默认 identity。

<!-- comet-task-ref:6896ffbf-27b3-467c-a49a-4c23177e85cd -->

**3.2 实现强类型分类。** 一次性为 `ProjectReconciliation` 增加 `changeClass` 与 `requiresReconciliation`，迁移全部构造/断言；保留 `changed` 只作展示，不允许调用方继续用它决定全局阻塞。

<!-- comet-task-ref:76c8c6ab-d44f-4248-b1aa-5f326c007e00 -->

**3.3 修正 Coordinator resume。** identity才写 `recovery.reconciled` 并设置 `reconciliationRequired`；content写 `run.resumed`、保留 continuation并返回有界诊断。运行 Runtime原子性与幂等 resume测试。

<!-- comet-task-ref:6910b7ce-1713-4469-b3e8-da664bfd1709 -->

**3.4 修正 Service/CLI 投影。** 只有 `requiresReconciliation` 覆盖 execution continuation和 next actions；content + Open validated返回 reobserve/run next。

<!-- comet-task-ref:b6316238-c70b-4314-9932-214dd8637bb7 -->

**3.5 回归 phase freshness。** 运行 planning approval、Build Binding/Plan Evidence、Verify input/Evidence与 Archive closure相关测试；补最小断言证明content变化仍由依赖 authority精确失效。

## 4. 遥测事实

<!-- comet-task-ref:f61874d9-f092-4071-a28b-023751eab089 -->

**4.1 Open observation stage。** 扩展 trajectory与OTLP mapping，用低基数 `provider-validation|planning-gate` 区分失败位置；保持同一 run/work/attempt/epoch关联与 `host_replayed=false`。

<!-- comet-task-ref:5e20fcf6-e22b-4cf7-b197-660e0ed96cca -->

**4.2 Project drift catalog。** 在机器可校验 telemetry catalog登记 `none|content|identity`，同步 Desktop codec/公开参考；拒绝高基数字段进入Metric labels。

<!-- comet-task-ref:ed46942e-34a2-4c91-ae49-9a4d25b7bed6 -->

**4.3 逻辑去重。** 覆盖重复 reobserve、cursor replay与 exporter失败，证明可以统计 observation attempts但不会增加 Host invocation、Skill consumed、workflow execution或failure逻辑计数。

## 5. 生产边界验收

<!-- comet-task-ref:65bfc3dc-7ad2-4752-833f-de7d7b5df833 -->

**5.1 构造真实 validated fixture。** 使用 production composition、真实 Open packet/outcome与四类 artifacts，将 Work推进到 validated并产生相对启动快照的新 HEAD。

<!-- comet-task-ref:0706ddf4-a97f-4189-823b-bd4557adb709 -->

**5.2 注入 planning timeout并 resume。** 失败点必须在 strict validation之后；resume返回content且不全局阻断，所有冻结执行身份逐项相等。

<!-- comet-task-ref:95a89980-e5d7-47e2-b88b-e7d4a50df53f -->

**5.3 恢复 Provider并 next。** 进入唯一 Open Human Decision，验证无Host replay、无repair Work、无重复Skill消费，trajectory/OTLP链路可关联。

<!-- comet-task-ref:af414554-ae06-446c-9e19-afd0d88c0a41 -->

**5.4 真实 identity drift。** 在隔离fixture改变branch、remote与topology，逐项断言reconciliation required且不能进入gate。

<!-- comet-task-ref:0150572b-15b3-4963-9315-ae4491b1fcfe -->

**5.5 新多仓最小验收。** 修复合入前在新的临时/模拟Change identity从Open跑到approval后Design入口；旧 `clarify-web-design-boundary` Store只读保留。

## 6. 文档、门禁与交付

<!-- comet-task-ref:ec3be39c-8c8c-4ba7-8881-96b975d55f7b -->

**6.1 更新公共契约文档。** 解释resume、content/identity、phase authority与遥测字段；同步生成型telemetry reference并运行契约检查。

<!-- comet-task-ref:f1bb6b0c-de43-417c-93a4-23f3d5f7f857 -->

**6.2 完整验证。** 运行所有目标测试、`npm run verify`、`npx --yes --package=@rpamis/comet@0.5.1 comet classic openspec -- validate recover-open-observation-continuation --strict` 与 `git diff --check`，Evidence绑定最终HEAD/tree/config/tool输入。

<!-- comet-task-ref:c15292a2-6f34-40c1-a9cb-f9281956f928 -->

**6.3 正式 Evidence 与卫生。** 保存 verification report，保留真实失败Attempt，清理临时日志、JSON、mock remote和scratch输出；确认只剩预期源文件、规格、计划与正式证据，提交后立即push。
