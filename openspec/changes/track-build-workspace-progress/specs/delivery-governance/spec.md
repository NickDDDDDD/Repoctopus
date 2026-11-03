# delivery-governance Delta

## ADDED Requirements

### Requirement: Change branch 与 Publication 必须共享同一远端身份

Repoctopus MUST 让 Planning approval 中的 Change branch 与 Archive publication 中的 Workspace Repository 使用同一规范化 Git remote identity。配置内 `repositoryId` MUST 只作为 Repoctopus 拓扑标识，不得被推断为平台稳定仓库 ID 或替代 remote identity。

#### Scenario: 多仓 Change 进入 Archive publication

- **WHEN** Planning approval 与 Project snapshot 观察同一 Workspace Repository 的同一 Git remote，但配置内 repository id 是团队自定义名称
- **THEN** 两个边界生成相同 remote identity，Archive 可以继续验证与发布，不得因自定义 repository id 和远端 URL 字符串不同而拒绝

#### Scenario: Change branch 指向另一远端

- **WHEN** Archive intent 的 Change branch remote identity 与 Project snapshot 的 Workspace Repository remote identity 不同
- **THEN** Runtime 在任何 push、MR 或规格关闭发布副作用前 fail closed

#### Scenario: 已冻结 Archive 使用了配置别名

- **WHEN** 修复前的 Archive 已完成本地隔离 Closure、尚未产生远端 publication，且当前有效 Design approval 只把同一路由的配置别名规范化为真实 Git remote identity
- **THEN** Runtime 可以仅重绑定批准的 remote identity 与 Closure base OID、重发 `delivery.publish` Work，并保持业务交付、Evidence、策略与 Closure identity 不变
