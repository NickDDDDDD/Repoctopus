# skill-integration Delta

## ADDED Requirements

### Requirement: TDD Skill 消费与方法验证分别冻结

Repoctopus MUST 分别记录 TDD augmentation 的 resolved、delivered、consumed 和 method verified。Host 消费当前 TDD layer 只产生 consumed；只有 `TddCycleReceipt` 经登记 Validator 接受后才产生 method verified。

#### Scenario: TDD 正文已消费但没有有效循环

- **WHEN** Host 确认消费 TDD layer，但没有当前 package 的有效 RED/GREEN/regression Receipt
- **THEN** TDD 状态保持 consumed 且 method verified 缺失，要求 TDD 的 Gate 不能通过
