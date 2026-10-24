# Spec Delta

## ADDED Requirements

### Requirement: Change 元数据参与规划语义身份

Specification Provider MUST 把会改变验证、关闭或能力退役行为的 Change-local 元数据纳入规范化规划语义摘要；仅修改实现、测试或其他非规划文件不得改变该摘要。

#### Scenario: Archive 元数据在批准后变化

- **WHEN** `.openspec.yaml` 的 `retire_capabilities` 或其他 Provider 语义字段在 Design approval 后变化
- **THEN** Runtime 检测到新的 planning semantic digest，使旧批准失效并返回 Design

#### Scenario: 非规划提交只更新发布来源

- **WHEN** Change 分支新增实现或测试提交但四类规划工件、Change 元数据、Provider/schema、能力集合和目标分支均未变化
- **THEN** Runtime 只更新 publication provenance，不撤销相同语义快照的 Design approval

### Requirement: 规格关闭先形成隔离候选再签发 Receipt

Specification Provider MUST 在隔离的 Workspace checkout 中把关闭计划应用为候选结果，并在签发 Closure Receipt 前核对活动 change 已移除、恰好新增一个预期归档目录、全部受影响主规格已同步、允许路径差异成立且全局严格校验通过；任一后置条件失败时不得把目录移动或命令退出码解释为完整关闭。

#### Scenario: OpenSpec 已移动目录但主规格无效

- **WHEN** 官方 archive 命令已移动 change 目录，但受影响主规格或全局严格校验失败
- **THEN** Provider 保留可恢复 Journal 和诊断，不签发 Closure Receipt、不允许发布候选结果

#### Scenario: 关闭候选满足全部后置条件

- **WHEN** 预期归档唯一存在、活动 change 不再存在、Purpose、受影响主规格和允许差异均通过严格核对
- **THEN** Provider 返回绑定关闭计划、文件身份和内容摘要的候选关闭结果，供 Archive 发布步骤使用

### Requirement: 规格关闭副作用只使用窄范围可恢复 Journal

Provider MUST 在调用官方 archive 副作用前持久化包含输入文件身份和预期输出的 prepared Journal，并只在隔离 checkout 内单调推进 applying、rolling-back、rolled-back 或 committed；Journal 不得保存 MR 等待、平台事件、跨仓发布或生命周期终态。

#### Scenario: 进程在 change 目录移动后中断

- **WHEN** 恢复入口发现活动 change 不存在且 prepared/applying Journal 没有完成 Receipt
- **THEN** Provider 根据归档目录、主规格文件身份和预期输出判断继续验证、回滚或进入人工修复，不盲目再次 archive

#### Scenario: 相同关闭计划重放

- **WHEN** 已存在匹配输入摘要且后置条件仍成立的 committed Journal 与 Closure Receipt
- **THEN** Provider 返回同一逻辑关闭身份，不再次调用 archive 或创建第二个归档目录

#### Scenario: 隔离 checkout 出现并发修改

- **WHEN** 当前文件 CAS identity 不再匹配 before 或 expected manifest
- **THEN** Provider 保留现场并返回人工修复 blocker，不覆盖文件且不写入开发者工作树

### Requirement: 语义漂移通过后续规格 Change 补偿

已完成 Change 的业务 MR 后续变化被确认影响行为契约时，Repoctopus MUST 通过标准 Open 阶段建立引用原 Change、Publication Receipt 和受影响 MR 的新 OpenSpec change；系统不得编辑旧归档目录、重写旧 Closure Receipt 或重开原 Change Run。

#### Scenario: 业务 MR 最终修改公共行为

- **WHEN** 一致性审查与可信人工决定确认最终代码改变 API、配置、权限、数据契约或已接受范围
- **THEN** Runtime 准备一个普通后续 Change，由完整 Open/Design/Build/Verify/Archive 流程处理规格修正

#### Scenario: 业务 MR 只修改内部实现

- **WHEN** 审查证据确认最终差异不改变任何规范性行为
- **THEN** 系统保存 `no-spec-impact` Receipt，不创建规格 Change
