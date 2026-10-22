# Spec Delta

## ADDED Requirements

### Requirement: 规划批准独立于 Change MR

Repoctopus MUST 在没有 Change MR 的情况下，通过当前 Specification Provider 校验四类规划产物，并使用结构化 Human Decision 记录批准、要求修改或拒绝；批准必须绑定 change、Provider、产物摘要、受影响能力、Change 分支远端 OID 和目标分支。

#### Scenario: 规划产物通过校验并获得批准

- **WHEN** Proposal、Design、Delta Specs 和 Tasks 均由当前 Provider 声明为完成，Change 分支已公开且可信用户批准对应摘要
- **THEN** Runtime 记录规划批准 Evidence，并允许该 Change 进入实施和 Business MR 交付

#### Scenario: Provider 校验失败

- **WHEN** 任一规划产物缺失、无效或与当前 Provider 状态不一致
- **THEN** Runtime 不创建规划批准请求，并返回 Provider 的可定位诊断

#### Scenario: 没有可信人工交互通道

- **WHEN** Runtime 无法确认规划决定来自可信用户交互上下文
- **THEN** Runtime 保持 Change 未批准，Agent、Runner 和 MR 状态不得代替用户批准

#### Scenario: 批准后规划分支发生变化

- **WHEN** Change 分支 OID、四类产物摘要、受影响能力或目标分支与已批准事实不同
- **THEN** Runtime 使旧规划批准失效，并要求重新校验和人工决定

#### Scenario: 规划批准后尚未完成实现

- **WHEN** Change 已获得规划批准但 Business MR 尚未全部合入和验证
- **THEN** Runtime 不创建最终 Change MR，也不把规划批准解释为交付批准或规格关闭
