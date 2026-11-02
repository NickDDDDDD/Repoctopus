---
change: stabilize-runtime-workspace-binding
design-doc: openspec/changes/stabilize-runtime-workspace-binding/design.md
base-ref: f26b9e078c333fa9413a4e3ece11f66e6fb17f6e
archived-with: 2026-11-02-stabilize-runtime-workspace-binding
---

# Stabilize Runtime Workspace Binding Build Plan

<!-- comet-task-authority: openspec/changes/stabilize-runtime-workspace-binding/tasks.md -->

## Execution contract

本计划是 Comet Build 的执行投影；任务文本、完成状态与稳定 ID 只以 `openspec/changes/stabilize-runtime-workspace-binding/tasks.md` 为权威。实施遵循已批准的 [Design](../../../openspec/changes/stabilize-runtime-workspace-binding/design.md)，固定 `build_mode=autonomous`、`tdd_mode=tdd`、`review_mode=thorough`，不使用子代理、不修改旧验收 Run Store、不让 Runtime 创建 Git checkout。

实现任务保留真实 RED/GREEN：先证明失败由待实现行为导致，再做最小实现并转绿。每个结果段在进入下一段前做差异审查；遇到规格冲突、需要解析异常文本、需要重放未知 Host 副作用或需要改变已冻结职责边界时停止并返回 Design。

## 1. 启动绑定领域契约

<!-- comet-task-ref:6ebd1e88-c261-4cc0-8dd8-bb41c10d01c0 -->

**1.1 锁定非法绑定 RED。** 范围是新的纯领域测试；无实现依赖。分别固定 detached HEAD、source=target、remote identity 不一致与 repository topology 漂移，断言受限 code 而非错误消息。接受为目标 Vitest 用例只因缺少 `ChangeStartBinding` 行为而失败。

<!-- comet-task-ref:d345a9a3-da8d-47bd-b660-01c25702d4a6 -->

**1.2 实现 ChangeStartBinding。** 范围是领域值对象、规范化输入、稳定摘要和错误类型；依赖 1.1。实现不得访问文件、Git、Cordis 或网络。接受为 1.1 全部 GREEN、类型穷尽且相同语义输入字节稳定。

<!-- comet-task-ref:acb74feb-a8f2-4c98-95f5-dbf269bf458a -->

**1.3 排除易变机器事实。** 范围是 binding identity 参数化测试；依赖 1.2。分别改变 HEAD、worktree digest、path、capturedAt，保持 repository id/remote/topology/source/target 不变。接受为 digest 不变；任一稳定语义改变时 digest 改变或输入被拒绝。

<!-- comet-task-ref:8a4d1616-423b-4c3a-9770-e92d73256789 -->

**1.4 固化架构职责。** 范围是现有 Architecture/Runtime 文档与公共类型导出；依赖 1.2 命名稳定。说明 Runner 准备 checkout、Project adapter 观察、领域构造 binding、WorkflowRuns 负责编排。接受为 `npm run check:architecture` 和格式检查通过。

## 2. Run 创建前校验与幂等启动

<!-- comet-task-ref:042d5607-afd4-4632-85dd-72901142e5de -->

**2.1 锁定幽灵 Run RED。** 范围是 WorkflowRuns Service 测试；依赖第 1 段契约。用 spy 同时观察 RunStore initialize、Skill composition、`work.created` 与 Desktop activation，证明 source=target 旧行为发生得过晚。接受为目标测试在生产实现修改前失败。

<!-- comet-task-ref:8d7047db-948a-4952-acad-0e02eb0230a2 -->

**2.2 接入创建前 binding。** 范围是 `startChange` 的 target facts/binding/trigger 顺序；依赖 1.2、2.1。binding 必须在任何 Run 持久副作用前完成，并进入 `change.open` trigger identity。接受为 2.1 GREEN，合法 branch 仍能创建 Run。

<!-- comet-task-ref:6ba049a5-f60a-4141-aea3-05d74fb78fd9 -->

**2.3 显式 start disposition。** 范围是 Coordinator 幂等入口与调用类型；依赖 2.2。返回 `started|resumed` 强类型，不从 diagnostic 文案猜控制流；普通非幂等 `start` 保持原契约。接受为 Runtime 单元测试与 TypeScript 编译通过。

<!-- comet-task-ref:8f61b0f2-826e-4ce6-b5ab-a638a0d900d0 -->

**2.4 只记录 authoritative initial Work。** 范围是 Change Service 初始 Skill/Work/activation 路径；依赖 2.3。只有 `started` 使用候选 lifecycle，`resumed` 直接返回 Store current Work。接受为等价重放只有一个 `work.created`，没有候选 Work invariant error。

<!-- comet-task-ref:dd44a603-49e1-43e9-8ee4-7eb85f1e3e9e -->

**2.5 公共 binding conflict。** 范围是 typed error 与 CLI failure envelope；依赖 2.2/2.3。公共 code 固定，message 只服务人读，不作为控制输入。接受为 CLI 契约返回 `workspace-binding-conflict` 且测试不匹配错误正文。

<!-- comet-task-ref:ac73f079-6beb-423c-b5d8-ded547b20efe -->

**2.6 CAS 并发启动。** 范围是 Coordinator/Store 并发测试；依赖 2.3-2.5。相同 binding 只初始化一次，不同 binding 失败且不改变原 checkpoint。接受为 stateVersion、trajectory、current Work 的精确计数断言通过。

## 3. Open observation 分类与恢复

<!-- comet-task-ref:8c1c9504-77ee-43b5-a84f-d6996e4da634 -->

**3.1 锁定 Provider unavailable RED。** 范围是 Open gate 与 Work execution spy；依赖已有一次成功 Host Outcome。注入一次 inspection/validation 不可用，断言 Outcome、attempt、invocation 保留并统计 Host reconcile 调用。接受为旧实现的 continuation/分类断言失败。

<!-- comet-task-ref:03d5f36e-6c18-4556-9d4d-ffdbb11bc3aa -->

**3.2 实现 reobserve 分类。** 范围是 typed observation result 与 Open continuation；依赖 3.1。Provider read 不可判定时保持 checkpoint并请求 reobserve，不进入 Host reconciliation。接受为 3.1 GREEN，下一次 Provider 恢复后继续原 gate。

<!-- comet-task-ref:4b76a843-38bc-431e-b7ff-5934ea318a87 -->

**3.3 保持 strict-invalid repair 原子性。** 范围是既有 repair CAS 与重复 pull；依赖 3.2。明确无效仍安装唯一 repair Work、递增一次 epoch、退役一次 execution。接受为并行 `next/resume` 不产生重复 Work 或 retirement。

<!-- comet-task-ref:62c788f2-5d3f-483a-b70c-910019a81876 -->

**3.4 处理遗留 branch identity 错误。** 范围是 Specification planning typed error 与 Open adapter 分类；依赖 1.2、3.2。不得比较消息文本。接受为错误投影 binding/input conflict，`open-observation-unavailable` 与 Host reconcile 均未出现。

## 4. 启动与重观察遥测

<!-- comet-task-ref:f8cd6ff4-2203-4fcd-a45d-7a5628186234 -->

**4.1 创建前拒绝观测。** 范围是 canonical observation outbox/mapping；依赖 2.2 的 bounded code。不得为了遥测创建 Run。接受为 `run_created=false`，并通过敏感字段与 Metric label 拒绝测试。

<!-- comet-task-ref:758a4242-8b21-4afd-91e6-9470c8d14dc2 -->

**4.2 启动复用与冲突事实。** 范围是已有 Run trajectory/outbox；依赖 2.3-2.6。相同 binding 记录 reused，不同 binding 记录 conflict且 checkpoint unchanged。接受为稳定 event identity、零重复 Work和有界 labels。

<!-- comet-task-ref:fdaf9ade-e9d9-4e23-b53d-27c3e1789f31 -->

**4.3 Open 重观察链路。** 范围是 unavailable/reobserved trajectory 与 OTLP 映射；依赖第 3 段。接受为同一 Run/Work/invocation 关联、`host_replayed=false`，重复 exporter replay 不改变逻辑计数。

<!-- comet-task-ref:8916a520-f614-4de7-bc06-f74c1fca3a30 -->

**4.4 双信号接收验证。** 范围是测试 receiver、Desktop codec 与 OTLP logs/traces/metrics；依赖 4.1-4.3。接受为 outbox/trajectory identity 可关联，任一 destination 失败不回滚领域事实。

## 5. 生产边界验收

<!-- comet-task-ref:b60a56e3-d3fa-45d2-a156-f1c5064b0436 -->

**5.1 Windows CLI 非法启动。** 范围是生产 composition 的临时多仓 fixture；依赖第 1、2、4 段。接受为 target branch 上 `run start` 返回 structured rejection，且没有 Run 目录、Work、activation 或成功 lifecycle 事实。

<!-- comet-task-ref:84aef510-8809-4098-ab15-ba40c18e5530 -->

**5.2 合法启动与等价重放。** 范围沿用 5.1 fixture；依赖 5.1。切换 feature branch 后启动并重放。接受为相同 runId、current Work、attempt 和单一 `work.created`。

<!-- comet-task-ref:9d135c5f-11ef-4de9-9320-bb821a1ee8aa -->

**5.3 绑定漂移黑盒。** 范围沿用 5.2 Run；依赖 5.2。切换 source branch 再启动。接受为 `workspace-binding-conflict`，checkpoint 字节和 trajectory 长度保持不变。

<!-- comet-task-ref:7c47368c-02da-48d8-b6c1-7f4dff74b6b8 -->

**5.4 Provider 恢复黑盒。** 范围是一次真实 Open Host Outcome 与可控 Provider；依赖第 3 段、5.2。接受为首次 unavailable、第二次恢复、Host invocation 计数不变且没有 `work-reconcile`。

<!-- comet-task-ref:0f85079e-eb93-4724-8642-ad0e29facd4c -->

**5.5 完整门禁与正式 Evidence。** 范围是最终 HEAD/tree/config/tool 输入；依赖全部任务。运行 `npm run verify`、Comet 适配的 OpenSpec strict validation 与 `git diff --check`，保存正式验证报告并清理临时 JSON、日志和 scratch 输出。接受为所有门禁通过、工作区只含预期源文件与正式 Evidence。
