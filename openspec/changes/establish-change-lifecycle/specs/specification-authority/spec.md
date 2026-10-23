# specification-authority Specification

## ADDED Requirements

### Requirement: Workspace Store 是规划根的稳定权威

Repoctopus MUST 将当前 Workspace Repository 登记为 OpenSpec Store，并以稳定 `storeId` 和 `workspaceRepositoryId` 标识 Specification Root；Runtime 调用 OpenSpec 时必须显式选择该 Store 并校验当前 Runner 的 registry、Store metadata 与 Workspace checkout 一致，不得依赖绝对路径、nearest root、default Store、Workset 或业务仓 pointer 推断权威根。单仓场景 MAY 让 Workspace、Store 与实现仓物理合一，多仓场景不得因此新增独立规格仓。

#### Scenario: 单仓自举使用同一个物理仓

- **WHEN** Workspace Repository 同时承载 Repoctopus 实现与 OpenSpec Store
- **THEN** Runtime 以不同 repository role 表达相同物理仓，并从显式 Store 读取唯一四类规划产物

#### Scenario: Runner 尚未登记 Store

- **WHEN** 当前 Runner 的 OpenSpec registry 没有该 `storeId` 或指向另一个 checkout
- **THEN** Runtime 阻塞受保护转换并返回可恢复的登记诊断，不回退到默认或最近的规格根

#### Scenario: 业务仓存在本地规格根

- **WHEN** 业务仓已有本地 `specs` 或 `changes`，其解析优先级会遮蔽 Store pointer
- **THEN** Runtime 将其报告为 authority conflict 并要求显式迁移，不覆盖、合并猜测或把两个根都视为权威

### Requirement: OpenSpec 官方 schema 和模板保持结构权威

Repoctopus MUST 从固定 OpenSpec Provider 版本取得当前 schema 的 artifact instructions/template，并只承认 Proposal、Delta Specs、Design、Tasks 四类规划工件；方法 Skill MAY 增强内容质量和验证，但不得替换官方结构、创建第五类工件、发布第二套 ticket 权威或改变 Provider 的完成判定。

#### Scenario: 方法 Skill 建议额外规格文档

- **WHEN** augmentation Skill 的原始流程会生成独立 spec、ticket 文件或外部 tracker 项
- **THEN** Runtime 只采用可映射进四类工件的规则，并拒绝把额外产物纳入规划权威

#### Scenario: 固定 OpenSpec 模板发生漂移

- **WHEN** Provider 返回的 schema/version/template digest 与当前 Change Run 的规划输入不兼容
- **THEN** Runtime 使未完成的 Design Work 失效或进入 `migration_required`，不得静默使用 Repoctopus 内置副本

## MODIFIED Requirements

### Requirement: 规格校验是推进前置事实

Repoctopus MUST 在 Design 退出、Verify 完成、Archive 开始和规格关闭等受保护转换前，请求当前 Specification Provider 在已校验的 Specification Root 上校验该转换所需产物，并把 Store/Provider/schema identity、规范化 manifest、校验结果和输入摘要作为 Change Run Evidence；调用方自述成功、文件存在或 Git/MR 状态不得替代该事实。

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
