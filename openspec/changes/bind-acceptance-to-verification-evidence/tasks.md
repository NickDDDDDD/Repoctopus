# Tasks

## 0. 固定上游模型与失败基线

- [ ] 0.1 为 checkbox 已完成但正式 Evidence 不覆盖全部 Acceptance、completed Run 仍投影 Archive 动作建立失败测试。
      **Blocked by:** None
      **Acceptance:** 测试分别证明 imported checkbox 不能形成 Evidence、弱 verify Profile 当前可错误通过、completed 状态当前暴露 `archive.prepare`
      **Requirements:** change-lifecycle#completion-claim, change-lifecycle#terminal-next-actions, implementation-evidence#acceptance-trace
- [ ] 0.2 更新 Comet 0.5.0 采用映射，记录 Classic Task 投影、Native Acceptance content identity、Trace、required Receipt 和 Archive 重检的采用边界。
      **Blocked by:** 0.1
      **Acceptance:** `npm run check:provenance` 通过；映射明确不复制 Comet 产品 shell、双状态根和 verification 文档权威
      **Requirements:** specification-authority#acceptance-identity, implementation-evidence#acceptance-trace

## 1. 建立 Acceptance 与 Completion Claim 领域契约

- [ ] 1.1 定义并解析稳定 `SpecificationAcceptanceCriterion`，以 Task、规范化文本、Requirement mappings 和来源形成内容身份。
      **Blocked by:** 0.2
      **Acceptance:** 等价格式和 checkbox 变化保持 ID；文字、Task、Requirement 或来源变化改变 ID；重复 Acceptance fail-closed
      **Requirements:** specification-authority#acceptance-identity
- [ ] 1.2 为 Task 增加 `runtime-work | imported-claim` completion 来源，并保持 expected taskRevision 的唯一写入口。
      **Blocked by:** 1.1
      **Acceptance:** Provider 导入 `[x]` 为 imported claim；Runtime 完成记录 Work identity；pending 没有 completion；重放幂等
      **Requirements:** change-lifecycle#completion-claim, specification-authority#task-completion-projection

## 2. 编译不可变 Acceptance Coverage Plan

- [ ] 2.1 扩展项目配置与 Evidence Profile 节点 `covers` selector，严格解析 `*`、acceptance、task 和 requirement 形式。
      **Blocked by:** 1.2
      **Acceptance:** schema/config tests 拒绝空、重复、非法和未知字段；配置摘要随 covers 变化
      **Requirements:** implementation-evidence#coverage-plan
- [ ] 2.2 将完整 Acceptance Set、set hash 与 selector 解析结果绑定到 Verification Input v2。
      **Blocked by:** 2.1
      **Acceptance:** 未覆盖、未知精确身份、未知 Task/Requirement、仅 optional 覆盖和输入漂移均在执行命令前失败
      **Requirements:** implementation-evidence#coverage-plan, change-lifecycle#acceptance-gate

## 3. 生成 Receipt-backed Acceptance Trace

- [ ] 3.1 定义版本化 Acceptance Trace，并从 coverage plan 与实际 Evidence Receipt 纯函数生成 canonical 结果。
      **Blocked by:** 2.2
      **Acceptance:** 每条 passed Acceptance 具备所有绑定 required 节点的 verified Receipt；observed、superseded、failed、blocked 和缺失均不能伪装通过
      **Requirements:** implementation-evidence#acceptance-trace
- [ ] 3.2 扩展 Evidence Bundle、Store validation、恢复、retention 和 verification report，持久化并验证 Trace 引用闭包。
      **Blocked by:** 3.1
      **Acceptance:** Bundle JSON round-trip、内容摘要、恢复和清理保留所有 Trace Receipt；旧 schema 不能满足新 Gate
      **Requirements:** implementation-evidence#acceptance-trace, implementation-evidence#trace-retention
- [ ] 3.3 让 EvidenceCoordinator 从当前 Verify Work 注入 Acceptance context，并在 Gate 投影前重新核对 input/set/trace identity。
      **Blocked by:** 3.2
      **Acceptance:** 独立 Evidence Bundle 可以没有 Trace但不能满足 Change Verify；跨 Run、跨 Work、陈旧指纹或 Trace 漂移全部 blocked
      **Requirements:** implementation-evidence#acceptance-gate, change-lifecycle#acceptance-gate

## 4. 闭合 lifecycle 与展示投影

- [ ] 4.1 让 Build 接受 imported claim 但保留其来源，Verify→Archive 只接受完整 Acceptance Gate。
      **Blocked by:** 3.3
      **Acceptance:** 已实现 Change 不重复派发 Build Work；缺少任一 Acceptance Receipt 时停在 Verify；完整 Trace 时进入 Archive
      **Requirements:** change-lifecycle#completion-claim, change-lifecycle#acceptance-gate
- [ ] 4.2 修复 Runtime、CLI、Dashboard 和 Telemetry 的终态 next-action 投影。
      **Blocked by:** 4.1
      **Acceptance:** completed/failed/migration_required 无可执行下一动作；waiting/blocked 只显示合法决定或恢复动作；进程外 CLI 不再建议 `run next`
      **Requirements:** change-lifecycle#terminal-next-actions

## 5. 自举 Profile 与生产路径验证

- [ ] 5.1 把本仓正式 `verify` Profile 扩展为完整 verify、package E2E、tracer E2E 和生产依赖审计，并显式声明 Acceptance coverage。
      **Blocked by:** 4.2
      **Acceptance:** Profile plan 顺序稳定、所有节点 required、`covers` 明确，正式 Bundle 的 Receipt 与手工验收命令一致
      **Requirements:** implementation-evidence#coverage-plan
- [ ] 5.2 增加真实生产组合 Change Verify E2E，从 Verification Input 经 EvidenceService、Store、Gate 到 Archive phase，不 mock Bundle 或 Gate。
      **Blocked by:** 5.1
      **Acceptance:** 弱 profile 和缺失覆盖失败；完整 profile 产生 Trace 并推进；进程中断恢复引用同一 Receipt
      **Requirements:** implementation-evidence#acceptance-gate, change-lifecycle#acceptance-gate
- [ ] 5.3 更新 Runtime、Specification、Evidence、配置和自举文档并完成正式验证。
      **Blocked by:** 5.2
      **Acceptance:** `npm run verify`、`npm run test:package-e2e`、`npm run test:tracer-e2e`、`npm audit --omit=dev`、`npm run check:provenance` 与 OpenSpec strict 全部通过
      **Requirements:** specification-authority#acceptance-identity, implementation-evidence#acceptance-trace, change-lifecycle#acceptance-gate

## Workflow follow-up

- 四类 OpenSpec 产物经 strict 校验并绑定本次可信批准后进入 Build；当前分支保持公开，每次 commit 立即 push。
- Verify 生成正式 Evidence Bundle、Acceptance Trace 和验证报告；这些运行结果不写回 Tasks 成为第二套账本。
- 本 Change 完成后再启动 `make-archive-publication-recoverable-and-isolated`，不得把 Archive 文件事务混入本 Change。
