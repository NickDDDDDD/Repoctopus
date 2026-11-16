# Spec Delta

## ADDED Requirements

### Requirement: Archive 发布使用同一份已核验的发布策略

一次 Archive Work 的业务及规格发布 MUST 使用 Runtime 已与冻结摘要核验的 Workspace Delivery Policy。创建、查找、采纳和核对 MR 的请求 MUST 使用该策略选择的平台 API 地址和凭据引用。Runtime MUST 在执行发布副作用前继续拒绝策略漂移，发布适配器不得以收据或 MR URL 替换已批准的 API 目标。

#### Scenario: Workspace 使用自定义 GitHub API

- **WHEN** 同一个已验证的 Archive 同时发布业务分支和规格分支，且 Workspace 配置了自定义 GitHub API
- **THEN** 业务项与规格项都通过该 API 查询及发布，完整的 Publication Receipt 允许原 Run 完成

#### Scenario: 规格发布失败后继续部分完成的 Archive

- **WHEN** 业务 PR 已创建且规格提交已推送，修复后的 Runtime 经精确前驱校验采纳原 Run
- **THEN** 继续使用原发布策略、Verify 证据、Closure 和 Journal，复用已经完成的动作并完成剩余的规格 PR
- **AND** 终态冷恢复保持同一收据且不再次发布

#### Scenario: 发布策略漂移

- **WHEN** 当前发布策略与 Archive 已冻结的策略摘要不一致
- **THEN** Runtime 在执行发布副作用前拒绝当前策略，保留已接受的归档和发布事实
