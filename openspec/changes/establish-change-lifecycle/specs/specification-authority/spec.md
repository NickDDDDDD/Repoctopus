# specification-authority Specification

## MODIFIED Requirements

### Requirement: 规格校验是推进前置事实

Repoctopus MUST 在 Design 退出、Verify 完成、Archive 开始和规格关闭等受保护转换前请求当前 Specification Provider 校验该转换所需产物，并把规范化 manifest、校验结果和输入摘要作为 Change Run Evidence；调用方自述成功、文件存在或 Git/MR 状态不得替代该事实。

#### Scenario: Delta Spec 严格校验失败

- **WHEN** 规格 Provider 报告当前 change 校验失败
- **THEN** 受保护转换不得推进，Change Run 保持当前 phase/status 并返回可定位的规格诊断

#### Scenario: 校验结果属于旧输入

- **WHEN** Provider 曾经校验成功但当前规划产物或实现输入摘要已经变化
- **THEN** Runtime 使旧校验失效并请求新结果，不把缓存成功用于当前转换

### Requirement: 规划批准独立于 Change MR

Repoctopus MUST 在没有 Change MR 的情况下，通过当前 Specification Provider 校验 Proposal、Design、Delta Specs 和 Tasks，并使用结构化 Human Decision 记录批准、要求修改或拒绝；批准必须绑定 change、Provider、规范化规划语义摘要、受影响能力和目标分支。Change 分支必须已公开且其远端 OID作为发布来源记录，但非规划 commit 不得仅因改变分支 OID 而使语义批准失效。

#### Scenario: 规划产物通过校验并获得批准

- **WHEN** 四类规划产物均由当前 Provider 声明为完成，Change 分支已公开且可信用户批准对应语义摘要
- **THEN** Change Run 记录 Design approval Evidence，并允许进入 Build

#### Scenario: Provider 校验失败

- **WHEN** 任一规划产物缺失、无效或与当前 Provider 状态不一致
- **THEN** Runtime 不创建批准请求或进入 Build，并返回 Provider 的可定位诊断

#### Scenario: 没有可信人工交互通道

- **WHEN** Runtime 无法确认规划决定来自可信用户交互上下文
- **THEN** Runtime 保持 `design/waiting`，Agent、Runner、commit 和 MR 状态不得代替用户批准

#### Scenario: 批准后规划分支发生变化

- **WHEN** 四类产物语义摘要、受影响能力、Provider 或目标分支与已批准事实不同
- **THEN** Runtime 使旧批准失效、返回 Design 并要求重新校验和人工决定

#### Scenario: Task 只更新完成 checkbox

- **WHEN** 已批准 Tasks 的稳定 ID、文字、结构、依赖、验收和需求映射未变，只有有效 Work 完成导致 checkbox 状态变化
- **THEN** Provider 的规划语义摘要保持不变，Runtime 不要求重新批准 Design

#### Scenario: Change 分支只增加非规划提交

- **WHEN** Change 分支远端 OID 因实现、测试或合法收尾提交变化，但规划语义摘要与目标分支不变
- **THEN** Runtime 更新 publication provenance，既有 Design approval 不仅因 OID 变化而失效

#### Scenario: 规划批准后尚未完成实现

- **WHEN** Change 已获得 Design approval 但 Verify 和 Archive 尚未完成
- **THEN** Runtime 不创建最终 Change MR，也不把 Design approval 解释为验证、远端副作用授权或规格关闭
