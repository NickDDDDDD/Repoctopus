# Proposal

## Why

Repoctopus 的主要价值位于 `Open → Design → Build → Verify`：把正确的规格、Skill、任务、实现方法和验证证据装配到同一 Change Run。现有收尾路径却要求等待 Business MR 合入，再通过 Webhook、Event Inbox、长驻 Runner 和 Post-merge Coordinator 恢复规格关闭；拟议方案又继续加入最终 Change MR 合入等待与远端 Saga，使 Archive 成为比开发主流程更重的子系统。

固定 Comet 0.5.0 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` 已提供更合适的成熟边界：Classic 在 Archive 前重读 phase、branch、HEAD、Evidence 和授权，Native 只为本地文件变更维护 `prepared → applying → rollback|committed` 事务，finish 负责 commit、push、创建或复用精确 PR 后即完成，不等待远端合入。Repoctopus 应采用这些不变量，并以轻量最终一致性处理多仓 MR 后续变化。

## What Changes

- 将 Archive 收敛为 `preflight → close-specification → publish → complete`：Verify 通过后发布全部 Business MR 和最终 Change MR，核对每个远端分支及 MR 的 repository/base/head/head OID 后形成 `PublicationReceipt`，不等待任一 MR 合入。
- 规格关闭采用 Comet 式窄事务：只为隔离 checkout 中的 OpenSpec 文件操作保存 prepared/applying/rollback/committed Journal、文件身份和后置条件，不为远端 MR 建立长期 Saga。
- Push 或 MR 创建响应丢失时，按稳定 repository/head/base/head OID 查询并复用唯一结果；人工创建的精确匹配 MR 可以被采用，Runtime 不自动 merge、force-push、rebase 或删除分支。
- Change Run 在完整 Publication Receipt 被验证后进入 `completed`；后续 MR 更新、合入或关闭不重开原 Run，也不改变其历史 Receipt。
- 新增轻量 `consistency reconcile`：在下一次正常任务启动或显式命令时按 Publication Receipt 拉取远端事实；没有变化直接结束，有变化则产生 `no-spec-impact | spec-update-required | uncertain` 结构化审查结果。需要修正规格时启动一个普通的后续 OpenSpec change，而不是修改已归档 Change。
- 删除 GitHub Webhook Route、签名配置、Platform Event Inbox、Inbox Runner、`runner start`、事件管理命令及 Post-merge 唤醒链；GitHub API Token 继续作为 Delivery Provider 凭据使用。
- 保留 Build-only Tasks 门禁和 CLI 只读解析修复：Verify、Archive、发布与一致性审查不作为 Tasks checkbox，`--help` 等只读请求在 composition 启动前返回。

## Capabilities

### New Capabilities

- `consistency-reconciliation`: 定义已完成 Change 的按需远端变化检测、规格影响审查和后续 Change 交接。

### Modified Capabilities

- `change-lifecycle`: 让 Archive 以精确发布完成为终态，不等待 MR 合入；后续一致性审查不重开已完成 Run。
- `delivery-governance`: 以多仓 Publication Receipt 表达发布完成，保留 push/MR create-or-recover 幂等性并移除 merge wait。
- `specification-authority`: 使用窄范围可恢复 OpenSpec 关闭事务，并以新的规格 Change 修正后续语义漂移。
- `post-merge-automation`: 退役合入等待、Post-merge Run/Coordinator 与启动补偿语义。
- `platform-event-processing`: 退役 Webhook、Event Inbox 和长驻事件 Runner 能力。
- `runtime-foundation`: 移除平台事件唤醒权威 Run 的入口，保留短生命周期命令与同一 Change Run 权威。
- `plugin-composition`: 移除 Webhook/Inbox/Runner 插件组合，保留 Delivery Provider 与普通项目组合。
- `development-telemetry`: 移除平台事件遥测，增加有界的发布与一致性审查结果。

## Impact

受影响范围包括 Change lifecycle definition、Archive/Specification/Delivery Service、OpenSpec Provider、Git 平台 Adapter、项目配置 schema、CLI、Cordis composition、Telemetry、文档和测试。现有 `domains/post-merge`、Platform Event/Webhook/Runner 生产链和对应状态文件将被删除，不保留无调用者的兼容外壳；历史归档记录继续只读。实现默认重建 Comet 的行为不变量，不新增运行时依赖；若复制新的上游源码，必须先更新来源清单、摘要和许可证覆盖。
