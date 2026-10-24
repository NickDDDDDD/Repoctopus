# development-telemetry Specification

## ADDED Requirements

### Requirement: 生命周期遥测来自权威 Change Run

Repoctopus MUST 只从已接受的 Change Run facts 和公共 projection 映射 phase、status、current Work、Task progress、wait condition、blocker 和 next action；Exporter、Desktop projection 和后端查询不得扫描目录、Git 或 MR 后自行推断另一套 lifecycle 状态。

#### Scenario: Run 进入等待状态

- **WHEN** Change Run 接受一个带稳定 wait condition 的转换
- **THEN** 遥测使用同一事件身份输出 phase、status、Work 和等待类别，桌面与远端目的地可投影出一致状态

#### Scenario: 平台事实尚未被 Run 接受

- **WHEN** Inbox 已收到合入事件但 Change Run 尚未核对并接受该事实
- **THEN** 遥测可以报告投递处理状态，但不得提前把 change 阶段标记为已关闭或 completed

## MODIFIED Requirements

### Requirement: Post-merge Run 输出阶段与证据关联

Repoctopus MUST 为同一 Change Run Archive 阶段的合入事实核对、临时检出、Evidence Gate、规格同步、路径审计、commit、push 和 MR 创建输出可关联状态，并引用持久 Work、Receipt 或 Artifact 身份而非嵌入完整内容；不得以独立 Post-merge Run 表达这些步骤。

#### Scenario: 规格同步因冲突停止

- **WHEN** Archive Work 生成 Human Decision 并使 Change Run 进入 blocked 或 waiting
- **THEN** 遥测记录 phase、status、冲突类别、change、Run、Work 和请求身份，不记录设计图或规格正文

#### Scenario: Webhook 唤醒 Archive

- **WHEN** 平台投递使同一 Change Run 从 `archive/waiting` 恢复执行
- **THEN** 遥测关联 Delivery ID、wake identity 和原 Run，不生成新的 Post-merge Run identity
