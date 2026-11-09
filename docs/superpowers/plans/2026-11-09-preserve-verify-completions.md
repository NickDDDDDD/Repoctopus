---
change: preserve-build-completions-on-verify-repair
design-doc: openspec/changes/preserve-build-completions-on-verify-repair/design.md
base-ref: f47eabf081fa48fb27d020d53b2ccdcda2b2cab3
---

# Verify 局部实现修复实施计划

<!-- comet-task-authority: openspec/changes/preserve-build-completions-on-verify-repair/tasks.md -->

目标：从真实失败 Evidence 推导修复范围，保留仍有效的完成事实，通过普通 Plan、Execute、Check 和 Verify 完成修复。

执行方式：已批准 autonomous + TDD + thorough，由当前 Agent 实施，独立 reviewer 做最终集成审查。本计划引用唯一任务权威，不复制完成复选框，不新增审批。

## 边界与文件职责

- `domains/change-lifecycle/verify-repair.ts`：纯领域范围推导、修复事实摘要校验；不读文件。
- `domains/change-lifecycle/build-protocol.ts`：单一 schema 3、同内容 Plan 复用、保留 completion。
- `domains/runtime/recovery.ts`、`domains/change-lifecycle/transition.ts`：Work 权威的 revise-implementation，保留 continue-build 原语义。
- `services/evidence-coordinator.ts`：读取失败事实及选定机器 Receipt；复用真实输入、产物观察器。
- `services/workflow-runs.ts`：协调生产 Verify 和 Plan/Execute/Check 的受保护接受。
- 现有 Work context、技能、Trajectory/OTLP：冻结并展示当前修复依据，记录有界分类与数量。
- `test/verify-repair*.test.ts` 及现有协议、恢复、生产组合测试：失败回归与权限负例。实际安装包验收证据保存在项目外目录。

## 1. 局部修复垂直切片

<!-- comet-task-ref:445e47c3-f66a-4390-9a76-a9b8fbdd81e0 -->
1.1 先在生产 Verify 入口构造四包、一个失败的事实，断言三个原 completion 被保留。运行回归，保存旧实现全量失效的 RED；领域范围测试覆盖相同关系。

<!-- comet-task-ref:da090b63-9a31-43a1-b82c-805a0a29be61 -->
1.2 实现失败 Bundle/Trace 到 Acceptance、包及 dependsOn 闭包的纯函数；未知关联返回 scope-unavailable。EvidenceCoordinator 加只读选定 Receipt 输入核对，校验 producer 闭包、真实输出 bytes。将修复依据原子放入 schema 3，分类为 revise-implementation。规范化候选并复用同内容 Plan。运行垂直回归至 GREEN。

<!-- comet-task-ref:1532b36d-0809-4d7b-974f-36a60807a939 -->
1.3 在 Plan/Execute/Check 最终接受前重验保留证明；已完成 Task 仍按缺少有效 completion 派发普通 Execute。修复导致其他包输入变化时精确扩大失效范围。测试仅失败包新增 Execute、原 Task 完成事实不重写、新 Check/Verify 可达。

<!-- comet-task-ref:7872e6c7-872a-490c-817e-4b87cf035268 -->
1.4 将修复事实引用和 digest 加入现有 Work packet，事件记录真实原因及影响/保留数量。更新相关技能、协议说明及来源审计；测试恢复不再虚报 Plan 漂移，指标无原始路径或错误文本。

## 2. 依赖与权威负例

<!-- comet-task-ref:732baf3b-8ef1-46e1-8987-4f3c1b33556c -->
2.1 先增加依赖 A→B、独立 C/D、跨仓读取、全覆盖失败及未知 finding 的失败测试，再补实现。全局覆盖可使全部失效；缺证明稳定阻断，不猜范围。

<!-- comet-task-ref:1cb4397d-0cba-43f3-9f72-91198bc0a336 -->
2.2 测试 Plan 内容相同/真实变化、Design 变化、权限扩大和 Plan/Execute/Check CAS 前输入变化。旧 checkbox/等价 Git 提交回归继续通过；不得以整 Bundle fingerprint 替代选定 Receipt 判断。

<!-- comet-task-ref:22fddfd1-41fc-49bb-8658-a6ffc9ccc628 -->
2.3 重跑旧 epoch、invocation、consumed layers、能力、分支、畸形提交的拒绝测试；新增 schema 2 明确拒绝及 schema 3 修复事实篡改拒绝。Host result 和 Completion 仍用原 schema 1，无迁移。

## 3. 冷恢复与安装包

<!-- comet-task-ref:ae91bbe7-9ad9-48b4-8239-2ccc013b261e -->
3.1 四个边界退出后从新进程交替 resume/next：失败持久化、Plan 接受、单包修复、新 Check。断言同一 Run、原凭证 identity、调用次数与无配置重复审批。

<!-- comet-task-ref:ca51bd44-ea75-4e37-b880-c464bde108bb -->
3.2 打包并安装本次 CLI，在全新多仓目录用公共命令和受管 Host 执行四包场景。记录原/新 Plan、completion、Gate、Execute 和机器检查次数，保留失败及负例；不修改 Store。

<!-- comet-task-ref:996f4530-3aae-4e0a-8671-23d51e0ff58b -->
3.3 独立 reviewer 核对完整 diff，解决重大问题，整理已发生的 RED/GREEN 和安装包验收报告。随后同一 Comet Run 执行 check-policy 精确 `npm.cmd run build` 与 `npm.cmd run verify`；完整 Verify 不预先写成已通过。

## Review Focus

- 修复 A 不能因整个旧 Bundle 改变而连带使独立 B 失效；B 真正读取 A 时则不能保留。
- 未归属 finding、缺 Receipt、产物缺失和观察失败必须阻断，重复恢复不重放。
- 同内容 Plan 的身份和保留对象不变化；真实契约变化不得误复用。
- 修复 Outcome 在 CAS 前发生输入变化时不能先终态化为无法补交。
- schema 2、旧 epoch 和越权分支不得通过本次修复绕过校验。

任务完成只通过 Comet task-complete 更新原 tasks.md。每次 commit 立即 push；不在正式 Guard 检查期间改变源码。所有恢复历史保留，临时调试文件限于项目外证据目录和忽略的 cache。本次不发布 Release，归档/PR 交付待正式 Verify 后确认授权。
