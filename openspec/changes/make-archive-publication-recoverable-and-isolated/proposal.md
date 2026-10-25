# Proposal

## Why

Repoctopus 已能在隔离 checkout 中验证 OpenSpec archive 候选，也能为业务发布保存远端动作状态；但规格关闭成功后，Provider 会把候选文件复制回调用者工作树、立即删除隔离 checkout，再由规格发布 Adapter 在调用者当前分支上 `git commit`。本仓自举刚刚稳定复现了后果：Change Run、业务分支与两个 MR 都发布成功，但本地 `spec/...` 分支被规格归档提交静默前移，形成“本地 ahead 1、远端仍停在已验证提交”的漂移。

固定 Comet 0.5.0 `aeb1a6598034e28ce46b8422d4dbd8785e607bd7` 的成熟做法把 Archive 文件事务与后续 workspace finish 分开：归档事务先密封候选，finish journal 再记录 commit/remote/PR 的单调进度；重试先观察现有文件、commit 和远端事实，不重放未知副作用。Repoctopus 应采用这些恢复不变量，同时保持 OpenSpec Provider、现有多仓 Business Delivery 与 Publication Receipt 的职责边界。

## What Changes

- Specification Closure Result 增加不透明的隔离候选身份与基线 OID；关闭成功后不再复制到开发者工作树，也不立即删除候选 checkout。
- 新增规格发布 Journal，在任何 Git 提交前持久化稳定意图，并按 `prepared → committed → pushed → completed` 单调记录精确 commit、远端分支和 MR Receipt。
- 规格发布只在隔离 checkout 中 stage/commit；重试可采纳已存在且内容完全匹配的 commit、remote OID 或 MR，歧义和漂移 fail-closed。
- Business Delivery 恢复严格 clean-worktree 要求，删除“规格关闭脏路径”例外；同仓业务发布与规格发布在物理目录和 Git ref 上隔离。
- 只有规格发布 Journal 到达 `completed`、远端身份重新核对且 Publication Receipt 被 Change Run 接受后，才清理隔离 checkout；响应丢失后仍可从 Journal 与远端事实返回同一逻辑结果。
- 将 `archive-prepare` 的 Evidence Attempt 与 `archive-publish` 的 Work Attempt 改为不同 CLI 参数，消除同名 `--attempt` 的两种类型和含义。
- 增加真实 Git/远端故障注入与自举回归，证明 Archive 不改变调用者 branch、HEAD、index 或 worktree。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `specification-authority`: 规格关闭返回可发布的隔离候选，并把候选保留到发布完成。
- `delivery-governance`: 规格发布使用可恢复 Journal 和精确远端采纳，不依赖调用者工作树脏路径。
- `change-lifecycle`: Archive 只在业务与规格发布 Receipt 完整后终结，重试使用明确的 Evidence/Work attempt 身份。

## Impact

受影响范围包括 Specification Closure Result、OpenSpec Provider、隔离 checkout 生命周期、规格发布 Adapter/Journal、Archive orchestration、Delivery clean-worktree 规则、CLI 参数、文档与 E2E。已有历史 Receipt 保持只读；活动旧 Closure Result 缺少候选身份时必须重新 prepare 或进入明确迁移/修复，不从当前工作树猜测候选。
