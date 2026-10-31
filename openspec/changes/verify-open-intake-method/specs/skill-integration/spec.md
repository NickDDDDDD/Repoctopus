# skill-integration Delta

## ADDED Requirements

### Requirement: Skill 消费与 Open 方法验证分别冻结

Repoctopus MUST 分别记录 Open Skill 的 resolved、delivered、consumed 和 method verified 事实。`consumed` 只证明当前 Host invocation 回执匹配 packet/layer digest；`method_verified` 只在 Open Method Receipt 经登记 Validator 核对当前 Work input、Outcome 与机器证据后产生。Work 成功或 OpenSpec 文件存在 MUST NOT 反推 consumed 或 method verified。

#### Scenario: grilling 已消费但事实未核对

- **WHEN** Host 回执确认消费 grilling layer，但 Open Receipt 缺失必要事实类别
- **THEN** Skill 保持 consumed 且 method verified 缺失，Open 方法 Gate 不能通过
