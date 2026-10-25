# Spec Delta

## ADDED Requirements

### Requirement: 发布与一致性审查遥测保持有界

Repoctopus MUST 从已接受的 Publication 与 Consistency Receipt 输出低基数事件，允许属性只包含 change、Run、Work、repository identity、item kind、结果类别、verdict、Receipt identity 和时间；不得包含 MR body、完整 diff、commit message、仓库 URL、绝对路径或凭据。

#### Scenario: Publication Receipt 完成 Archive

- **WHEN** 全部发布项通过精确远端核对并完成 Change Run
- **THEN** Desktop 与 SigNoz 接收相同的 publication completed 语义，不记录 MR 是否最终合入

#### Scenario: 一致性审查要求规格修正

- **WHEN** Consistency Review 输出 `spec-update-required`
- **THEN** 遥测关联原 Change、审查 Receipt 和后续 remediation change identity，不嵌入规格正文或代码差异

## REMOVED Requirements

### Requirement: 平台事件处理可追踪但不泄露载荷秘密

**Reason**: 平台事件、Webhook 和 Event Inbox 退役，不再产生接收、去重、领取、重试或死信遥测。

**Migration**: 仅输出主动 Publication/Consistency 操作的有界结果。

### Requirement: Post-merge Run 输出阶段与证据关联

**Reason**: Post-merge 产品链和合入等待退役；Archive 使用同一 Change Run 的 Publication Receipt 完成。

**Migration**: 使用“发布与一致性审查遥测保持有界”要求替代。
