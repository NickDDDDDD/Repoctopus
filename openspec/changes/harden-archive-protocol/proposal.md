# Proposal

## Why

现有 Archive 在最终 Change MR 创建后就可能把 Run 标记为完成，且规格关闭、远端发布、重试与清理之间缺少统一的事务恢复边界；这会让“文件已经归档”“远端已经发布”和“Change 已真正完成”在故障后互相矛盾。近期自举归档还暴露了 Build 任务依赖未来 Verify/Archive 事实、CLI 探测产生状态以及不同 Runner 难以无歧义接管等问题，需要在继续扩大团队使用前系统修正。

## What Changes

- 把 Archive 明确为五阶段状态机内部的可恢复工作协议：只读 preflight、Business MR 发布与合入核对、候选规格关闭、最终 Change MR 发布与合入等待、终态提交。
- 最终 Change MR “已创建”不再等于 Change 完成；只有平台权威事实证明其精确 head 已合入目标分支，并且关闭与审计摘要一致，Run 才进入 `completed`。
- 引入可持久恢复的 Archive Journal，记录准备、应用、核对、回滚或继续、最终化和清理状态；进程在任何边界中断后先协调外部事实，再决定重试。
- 在产生 Action Intent 和消耗 attempt 之前执行无副作用 preflight，覆盖凭据可用性、Git 作者、Provider/Store、平台能力、Evidence profile、远端 OID、临时空间和发布策略。
- 让 Runtime 分配单调 attempt，并使用稳定 Runner identity 领取工作；PID 只表示当前租约活性，不再成为跨进程幂等身份。
- 保持多仓 Business MR 集合冻结并逐仓核对精确 merge commit；规格关闭仍发生在 Workspace Repository 的隔离检出中，最终 Change MR 仍由人合入。
- 将 `tasks.md` 的 checkbox 限定为 Build 阶段可完成的工作；Verify、Archive、最终 MR 合入和工作流清理由固定 phase Work、Validator 与退出条件表达，防止通过提前勾选未来事实绕过门禁。
- 对既有“Run 已完成但最终发布 head 后续改变”的历史记录生成追加式完整性诊断或迁移记录，不重写旧 Receipt。
- 补齐故障注入、全新检出、跨 Runner、多个业务仓、最终 MR 响应丢失/head 漂移、Windows 清理重试和自举闭环测试。
- 修正 CLI 帮助等只读探测不得创建 Run 或触发补偿副作用的契约。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-lifecycle`: 收紧 Archive 内部工作顺序、终态条件、任务阶段边界、attempt 与 Runner identity 语义。
- `delivery-governance`: 增加发布前无副作用 preflight、Runtime attempt 分配、最终 Change MR 精确合入证据和多仓恢复约束。
- `specification-authority`: 让规格关闭使用可核对、可恢复的候选事务，避免“已移动目录”被误判成完整关闭。
- `post-merge-automation`: 增加持久 Journal、跨 Runner 恢复、最终 MR 合入等待、后置核对和延迟清理语义。

## Impact

受影响范围包括 Change lifecycle definition/reducer、Workflow Run 与 Action Dispatcher、OpenSpec Provider、Delivery v3 与平台 Adapter、Post-merge Coordinator/Actions、文件状态存储、CLI、OpenTelemetry 映射、项目配置校验、迁移诊断、测试和自举文档。实现借鉴固定 Comet 基线的 archive preflight、事务 Journal、CAS 核对、未知副作用恢复和“归档不等于交付完成”原则，但不复制其单仓、本地 push/PR 或产品外壳；Repoctopus 的 Workspace Store、多业务仓/MR 集合、最终 Change MR 和团队多 Runner 仍是权威边界。第三方代码若复用只限现有已登记来源与许可证边界；本 Change 默认采用设计思想和仓内重建，不新增运行时依赖。
