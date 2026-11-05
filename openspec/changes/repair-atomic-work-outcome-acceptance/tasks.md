# Tasks

## 1. 锁定缺陷与接受边界

- [x] 1.1 在 `managed-change-execution.e2e` 增加 Round 8 回归：`build.configure` 返回正确 result kind 但错误 `strategyDigest`，并验证当前实现会错误终态化；运行 `npx vitest run test/managed-change-execution.e2e.test.ts` 可观察到新增断言先失败。 <!-- comet-task:f1487e82-4388-447a-8b35-6a00092072f8 -->
- [x] 1.2 在 authority/executor 单元测试中固化 terminal acceptance 前不得出现 accepted submission、Host Outcome、Action Outcome 或 Receipt 的不变量；运行 `npx vitest run test/work-execution-submission.test.ts test/managed-work-executor.test.ts` 验证 RED 覆盖完整。 <!-- comet-task:52f937f1-5299-4c08-95a2-42177bb5f078 -->
- [x] 1.3 记录 Configure、Plan、Execute、Check 现有接受入口和旧特判清单到 `design.md`，并运行 `rg -n "acceptOutcome|rejectInvalidConfigureResult|build\.plan.*build\.check" services` 确认没有遗漏的生产入口。 <!-- comet-task:267276ab-5fb7-4dca-9a0e-cbea05bf669c -->

## 2. 建立统一候选处理协议

- [x] 2.1 在领域层定义封闭的 accepted、correctable rejection、processing error disposition 及稳定 validation record；运行 `npm run typecheck` 验证所有分支穷尽处理。 <!-- comet-task:ab441f6d-96e8-4eb6-94d8-0bf4a3a8474c -->
- [x] 2.2 为 Build Work 建立按权威 `WorkDescriptor.kind` 解析的处理器注册表，未注册 Build Work fail closed；运行对应领域单元测试验证四种 Work 均已注册且未知 kind 被拒绝。 <!-- comet-task:d7cda0b9-7959-4739-a422-e8d432c3bd3f -->
- [x] 2.3 实现统一 acceptance coordinator，按身份/协议、schema、领域、lifecycle validator、transition feasibility 的顺序处理 pending submission；运行 coordinator 单元测试验证任一前置失败都不会调用 terminal bind。 <!-- comet-task:02ecb5ed-c02b-40fe-9e64-747ee14673df -->
- [x] 2.4 扩展 `WorkExecutionAuthority` 的 guarded terminal commit，使其重新核对 Work、claim、attempt、checkEpoch、invocation、submission、candidate 与稳定输入 digest；运行 `npx vitest run test/work-execution-submission.test.ts` 验证漂移 fail closed、合法记录一次性绑定。 <!-- comet-task:23e3a1ff-fffb-49bd-a80e-19bd7ddf1dd9 -->
- [x] 2.5 将 processing error 与 correctable rejection 分离：前者保留 pending，后者进入 `awaiting-correction` 并追加有界历史；运行 submission/recovery 单元测试验证两者状态、history 与 continuation 不混用。 <!-- comet-task:10b26d88-387a-4408-85ce-258ef456698a -->
- [x] 2.6 验证相同 submission ID + 相同 digest 幂等、同 ID + 不同 digest 冲突、新 ID 可纠正；运行 `npx vitest run test/work-execution-submission.test.ts test/work-execution-recovery.test.ts` 通过。 <!-- comet-task:b903de32-95dd-499e-962a-d4cff603d0f9 -->

## 3. 交付 Configure 垂直切片

- [ ] 3.1 实现 Configure 处理器，对 `execution-binding-candidate` 的 schema、Strategy identity/digest、仓库集合和 Binding 构造约束做完整校验；运行 Configure 领域测试覆盖结构错误与语义错误。 <!-- comet-task:0a5a1863-1c9d-4bc3-afd4-e03157f1c3a1 -->
- [ ] 3.2 将内嵌与外部 Configure submission 接到统一 coordinator，删除 `rejectInvalidConfigureResult()` 和 Configure 的早期 `acceptOutcome()`；运行 `rg -n "rejectInvalidConfigureResult" services` 无结果且 executor 单元测试通过。 <!-- comet-task:2d837b06-5f0c-4c0e-93a8-c546e8e11b52 -->
- [ ] 3.3 让 Round 8 错 digest 候选返回结构化 `awaiting-correction`，保持同一 Work/claim/attempt/checkEpoch/invocation/packet；运行新增 E2E 验证全部 identity 未变化。 <!-- comet-task:a4824a9d-3ab9-48a3-ac74-9091f20643d1 -->
- [ ] 3.4 使用新 submission ID 提交修正版 Configure candidate，并验证它被接受后只创建一个 Binding、一个 Plan Work；运行 `npx vitest run test/managed-change-execution.e2e.test.ts` 通过。 <!-- comet-task:85d81440-31df-4e60-aa6e-b1c27edb4b14 -->
- [ ] 3.5 覆盖 terminal commit 前中断和接受后、lifecycle observation 前中断的冷启动恢复；运行 `npx vitest run test/work-execution-recovery.test.ts test/managed-change-execution.e2e.test.ts` 验证不重调 Host、不新增 Work/attempt。 <!-- comet-task:3ca04124-3601-493f-8978-8dd5f3cdbc52 -->

## 4. 统一其余 Build Work

- [ ] 4.1 将 Plan 的 candidate 构造、Plan Evidence、领域校验与 lifecycle validator 接到统一处理器，并删除 executor 的 Plan 延迟名单分支；运行 Plan rejection/correction 与受保护分支 E2E 通过。 <!-- comet-task:36fc536f-cbb7-4fe2-afa6-784a48a4649a -->
- [ ] 4.2 将 Execute package completion 接到统一处理器，同时保留 workspace checkpoint 和外部副作用 journal 的两阶段消费；运行 Execute 中断点与恢复测试验证不会重复提交或重复 Host 副作用。 <!-- comet-task:604296b0-f4c2-45bb-8897-19cbaf5d4f6e -->
- [ ] 4.3 将 Check candidate/evidence 接到统一处理器，并删除 executor 的 Check 延迟名单分支；运行 Check rejection/correction 与 Verify 输入测试通过。 <!-- comet-task:10d9ff1b-2853-4ce9-ba69-43fe8b5f1693 -->
- [ ] 4.4 对 Configure、Plan、Execute、Check 增加 schema、语义、validator、transition infeasible 矩阵测试；运行相关 Build protocol 与 managed execution 测试，验证所有拒绝均发生在 terminal acceptance 前。 <!-- comet-task:0f8560bc-e38f-47e5-b680-920305c3f88a -->
- [ ] 4.5 删除所有按 Work kind 决定“立即/延迟 accept”的生产条件，改为注册表穷尽检查；运行 `rg -n "build\.plan.*build\.check|build\.check.*build\.plan" services/managed-work-executor.ts` 无旧名单结果并通过 `npm run typecheck`。 <!-- comet-task:346693b7-c742-455b-acd0-32fcd0a3b38a -->

## 5. 入口、恢复与遥测一致性

- [ ] 5.1 让内嵌 Host、外部 `work-outcome` 和已知 candidate 的恢复入口共享同一 coordinator；运行外部 CLI 与 managed execution E2E 验证 disposition、diagnostic 和 identity 一致。 <!-- comet-task:d4cd08b5-1622-4d46-af30-d119df92d3d0 -->
- [ ] 5.2 验证 pending/rejected candidate 不会进入 `not-executed` reconciliation，只有未知执行结果使用 reconciliation；运行 `npx vitest run test/work-execution-recovery.test.ts` 通过。 <!-- comet-task:8e1feeef-c6fb-434c-8351-4145260e64cb -->
- [ ] 5.3 为 accepted、rejected、processing error、validator 和 continuation 补齐一次性 OpenTelemetry 断言，禁止 payload/自由文本成为 label；运行 `npx vitest run test/telemetry-mapping.test.ts` 通过。 <!-- comet-task:e49aeb06-6b69-41a7-ab16-e9a2d0d0e9ce -->
- [ ] 5.4 验证多仓 Project Snapshot、Strategy、Binding、Plan 和 workspace checkpoint digest 在恢复前后保持绑定；运行多仓 managed execution E2E 通过。 <!-- comet-task:b6480ce8-12b7-49fb-a14a-bae722d75d9b -->
- [ ] 5.5 更新正式 Runtime/Host 协议文档，说明统一接受顺序、纠正 identity 与 processing/reconciliation 区别；运行 `npm run check:managed-execution-report` 和文档内命令验证通过。 <!-- comet-task:83f2fd84-791f-404a-ae5d-48e55d753c5a -->

## 6. 综合验收

- [ ] 6.1 运行定向回归 `npx vitest run test/work-execution-submission.test.ts test/managed-work-executor.test.ts test/work-execution-recovery.test.ts test/managed-change-execution.e2e.test.ts test/telemetry-mapping.test.ts` 并记录 Evidence。 <!-- comet-task:c351caf8-aefe-468a-8c3d-eeefd7e36e93 -->
- [ ] 6.2 运行 `npm run typecheck && npm run lint && npm run check:architecture && npm run check:provenance`，确认领域、Service、Engine 与平台适配器边界无违规。 <!-- comet-task:2763104c-fc1d-4ee9-b831-8f54e69496f7 -->
- [ ] 6.3 运行 `npm run verify`，确认全量测试、生成物、品牌、架构、来源、OpenSpec 与报告检查全部通过。 <!-- comet-task:657897f5-6ef0-47f0-9d71-764748fc6679 -->
- [ ] 6.4 使用新的多仓 acceptance Run 重放 Round 8 场景，验证错误 Configure candidate 可在同一 invocation 纠正并继续至 Archive；保存 Run/Work/submission/Evidence/phase 遥测，旧卡住 Run 保持未修改。 <!-- comet-task:4fa9a8d2-91fc-44cf-a0c9-a1de20ecb525 -->
- [ ] 6.5 对照 Comet 0.5.1 固定源码复核 Outcome identity、拒绝与恢复语义，并运行 `npm run check:upstream`；若权威资料冲突则停止交付并回到 Design。 <!-- comet-task:ef8a4b65-0a61-47c4-8253-f17a83b3ed61 -->
- [ ] 6.6 完成独立 thorough review，修复高优先级 finding 后重新运行受影响测试，并将最终结论写入正式验证报告。 <!-- comet-task:2d22d4cc-6da9-45d6-9c03-127b3df9a852 -->

## Workflow follow-up

- 在正式验证和人工批准完成后归档该 change。
- 合入并发布分支后，从干净 checkout 验证归档结果和新的多仓 acceptance Run。
