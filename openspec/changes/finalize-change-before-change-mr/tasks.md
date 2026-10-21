# Tasks

## 1. 建立分支优先的规划批准契约

- [x] 1.1 增加版本化 `ChangeBranchReference`、`PlanningSnapshot`、`specification-approval` Human Decision 与稳定摘要，更新 JSON Schema，并运行对应领域与 schema 测试证明 change、四类产物、Provider、目标分支和远端 OID 漂移都会使批准失效。
- [x] 1.2 通过 Specification Service 与命令入口生成、记录和恢复规划批准，接入现有可信 Human Decision Adapter；运行服务与 CLI 测试证明没有可信响应、Provider 严格校验失败或 Change 分支未公开时不能进入实施。
- [x] 1.3 更新规格权威与自举文档，说明公开分支、规划批准和最终 MR 的不同授权边界，并执行文档命令冒烟测试证明示例不要求提前存在 Change MR。

## 2. 交付默认单 Business MR 的真实纵切

- [x] 2.1 实现 `DeliveryIntent`、`DeliverySnapshot` 和 `DeliveryState` v3，以 `changeBranch` 和稳定 `businessDeliveries[]` 取代 `changeMergeRequest`；运行规范化、摘要、漂移与状态转换测试证明默认计划只生成一个 Business MR。
- [x] 2.2 重构 Delivery Service、平台 MR 映射和批准请求，使业务发布不读取或创建 Change MR；运行领域、Service、GitHub Adapter 与 CLI E2E，证明 Change 分支已核对后可以独立创建一个 Business MR，且 Runtime 仍不执行 merge。
- [x] 2.3 同步 Delivery Intent 示例、schema 和交付文档到 v3，执行 schema fixture 与示例 CLI 测试，证明旧 `changeMergeRequest` 输入返回可操作迁移诊断而不是被静默解释。

## 3. 在关闭后创建最终 Change MR

- [x] 3.1 扩展 Post-merge Checkout 和 Closure Journal，在 Change 分支上把锁定目标 OID 作为普通 merge 合入；使用干净、冲突、目标漂移和中断恢复测试证明不执行 rebase、force push 或文件复制旁路。
- [x] 3.2 把发布策略改为 `merge_target + commit + push + merge_request.create_or_recover`，扩展平台端口和 Receipt；运行响应丢失、唯一 MR 复用、多个匹配、head/base 漂移和越权路径测试证明最终 MR 只在关闭分支发布成功后出现。
- [x] 3.3 更新 PostMergeCoordinator 与 Actions 的状态推进，运行默认单 Business MR 进程外 E2E，证明精确 merge commit 验证、Provider 归档、Change 分支普通 push 和最终 MR 创建可以从中断点幂等完成。
- [x] 3.4 更新 Post-merge 操作与恢复文档，并执行文档命令冒烟测试，证明维护者能够区分等待业务合入、规划漂移、目标合并冲突、关闭发布失败和最终 MR 恢复。

## 4. 扩展显式多 Business MR 集合

- [ ] 4.1 用稳定 `deliveryId` 支持跨仓和同仓多个 Business MR，并要求多成员计划包含结构化拆分理由；运行验证与快照测试证明无理由多 MR 被拒绝、任务不会被自动拆 MR、集合顺序不影响摘要。
- [ ] 4.2 更新事件匹配、主动刷新和 Reconciliation，使其等待已批准完整集合，并运行部分合入、关闭未合入、补充 MR 导致批准失效及最后一个 MR 合入测试。
- [ ] 4.3 增加显式多 Business MR E2E 和文档示例，证明完整集合的权威 merge commit 都进入 Post-merge Run，而默认用户路径仍保持单 MR。

## 5. 迁移旧 Delivery 并验证多 Runner 收敛

- [ ] 5.1 增加 v2 只读解析和 v3 迁移计划，覆盖无远端动作、开放旧 Change MR、已关闭/已合入旧 Change MR 三类状态；运行迁移 fixture 证明不复用旧批准、不自动改变平台 MR 状态并对不可迁移状态返回 `repair_required`。
- [ ] 5.2 将多 Runner 并发栅栏改为 Change 分支远端 OID 与关闭语义核对，运行独立状态卷竞态测试证明等价结果收敛为 no-op、不等价结果 fail-closed 且最多恢复一个最终 MR。
- [ ] 5.3 更新迁移、团队协作和 Runner 文档，执行文档示例与负向配置测试，证明 MR 作者、分支作者和 Runner identity 都不会成为独占 Change owner。

## 6. 自举集成与交付准备

- [ ] 6.1 更新项目配置 schema、默认配置、内置插件目录和架构治理，运行 typecheck、lint、架构检查及配置 E2E，证明旧 `update-existing` 策略不能进入新 v3 发布路径。
- [ ] 6.2 使用本仓公开 Change 分支执行一次无 Change MR 的规划批准和默认单 Business MR 自举演练，保存正式 Evidence，运行 `npm run verify`、包 E2E 与 Post-merge E2E，并确认精确分支/MR事实与验证报告一致。
- [ ] 6.3 清理自举测试的临时检出、日志、模拟平台状态和 scratch Artifact，复查 Git 状态、运行进程和远端分支，证明没有遗留调试产物或未发布提交。

## Workflow follow-up

- 本 Change 规划期间只公开并普通 push `spec/finalize-change-before-change-mr`，不创建 Change MR。
- 实现默认使用一个 Business MR；只有出现规格允许且经批准的拆分理由时才增加 Business MR。
- 全部 Business MR 合入并完成 Post-merge Evidence、主规格同步与归档后，才创建最终 Change MR并等待人工合入。
