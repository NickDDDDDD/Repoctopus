# Spec Delta

## ADDED Requirements

### Requirement: 规格关闭先形成隔离候选再签发 Receipt

Specification Provider MUST 在隔离的 Workspace checkout 中把关闭计划应用为候选结果，并在签发 Closure Receipt 前核对活动 change 已移除、恰好新增一个预期归档目录、全部受影响主规格已同步、允许路径差异成立且全局严格校验通过；任一后置条件失败时不得把目录移动或命令退出码解释为完整关闭。

#### Scenario: OpenSpec 已移动目录但主规格无效

- **WHEN** 官方 archive 命令已移动 change 目录，但受影响主规格或全局严格校验失败
- **THEN** Provider 保留可恢复 Journal 和诊断，不签发 Closure Receipt、不允许发布候选结果

#### Scenario: 关闭候选满足全部后置条件

- **WHEN** 预期归档唯一存在、活动 change 不再存在、受影响主规格与允许差异均通过严格核对
- **THEN** Provider 返回绑定关闭计划、文件身份和内容摘要的候选关闭结果，供 Archive 发布步骤使用

### Requirement: 规格关闭副作用具有可恢复 Journal

Provider MUST 在调用官方 archive 副作用前持久化包含输入文件身份和预期输出的 prepared Journal，并在应用、后置验证、回滚或继续恢复、提交候选和最终化时单调推进状态；恢复不得依赖活动 change 目录仍然存在。

#### Scenario: 进程在 change 目录移动后中断

- **WHEN** 恢复入口发现活动 change 不存在且 prepared Journal 没有完成 Receipt
- **THEN** Provider 根据归档目录、主规格文件身份和预期输出判断继续验证、回滚或进入人工修复，不把缺少活动目录当作新请求失败

#### Scenario: 相同关闭计划重放

- **WHEN** 已存在匹配输入摘要且后置条件仍成立的 committed Journal 与 Closure Receipt
- **THEN** Provider 返回同一逻辑关闭身份，不再次调用 archive 或创建第二个归档目录

### Requirement: 历史关闭完整性异常追加记录

Repoctopus MUST 通过追加式诊断或迁移事实记录既有 Closure Receipt 与后来发布或合入 head 不一致的情况，并保留原始 Receipt；系统不得静默重写旧摘要、时间或外部身份来制造一致。

#### Scenario: 已完成 Run 的发布 head 后续改变

- **WHEN** 审计发现终态 Run Receipt 绑定的 Change 分支 head 与最终实际合入 head 不同
- **THEN** Runtime 追加可定位的完整性异常和处置状态，并要求按当前协议重新证明或人工确认，不修改旧 Receipt
