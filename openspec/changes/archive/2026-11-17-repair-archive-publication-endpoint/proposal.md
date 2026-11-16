# Proposal

## Why

使用自定义 GitHub API 的五仓验收停在 `delivery.publish`。业务 PR 已通过配置的 API 创建，规格分支已推送，规格 PR 的发布适配器却仍向默认 API 查询并收到 401，导致原 Run 无法生成完整收据。

## What Changes

- 让 Archive 的业务发布与规格发布使用同一份通过 Runtime 摘要核验的 Workspace 发布策略。
- 通过现有精确前驱采纳和发布 Journal，验证修复包可以继续两条原 Windows 五仓 Run。
- 验证已经创建的业务 PR 和已推送的规格提交可以复用，完成收据后冷恢复不再产生发布副作用。

## Capabilities

### Modified Capabilities

- `delivery-governance` 增补 Archive 各发布项使用同一份已核验策略的需求，并覆盖部分发布后的恢复。

## Impact

涉及 Runtime 的 Archive 编排、Delivery 服务及 GitHub Adapter 构造和回归验收。继续使用现有 `delivery.publication.githubApiBaseUrl`、策略摘要、提交坐标、Journal 与 Receipt 格式。正式版渠道和 Archive 之外的一致性查询另行处理。
