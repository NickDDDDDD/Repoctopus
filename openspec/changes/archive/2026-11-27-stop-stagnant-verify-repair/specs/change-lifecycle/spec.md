# Change lifecycle

## ADDED Requirements

### Requirement: Verify 停止同一失败的重复自动返工

Runtime MUST 在已完成一轮自动返工后，用两个可归属于同一 Run 的失败机器证据比较失败检查、验收范围和声明的实际输入。当失败范围与输入均未变化时，Runtime MUST 保留当前 Verify Work、原机器 Attempt 和失败证据，并暂停自动派发 Build 或新 Verify。新的 Attempt、Bundle、Work、epoch、完成记录或 recovery decision 标识 MUST NOT 单独作为输入变更或返工进展的证据。

#### Scenario: 同一失败与实际输入未变

- **WHEN** 一轮自动 Build 返工结束后，再次观测到相同的机器检查失败，受影响的验收范围与声明输入保持不变
- **THEN** Runtime 停在同一 Verify Work，返回可定位的失败证据及继续修复的指引，保留有效完成事实，不再自动派发 Build Plan 或机器检查

#### Scenario: 暂停后从新进程恢复

- **WHEN** Runner 断开后，再执行 `status`、`resume` 或 `next`，且影响当前暂停的事实没有变化
- **THEN** 所有入口保持同一暂停、Work、Attempt 和失败证据，重试读取不产生新的执行或重复审批

#### Scenario: 有实际变化或可信决定后继续

- **WHEN** Runtime 观察到声明输入确实变化，或接受同一失败范围的明确继续决定
- **THEN** Runtime 沿受管路径重观或重新修复，保留不受影响的完成事实，不接受旧或不相干的决定，不跳过 Verify；再次观察到同一无进展失败时仍须阻断自动循环

#### Scenario: 首次失败或失败证据变化

- **WHEN** 首次观察到可归属的实现失败，或后续机器失败范围或声明输入有实质变化
- **THEN** Runtime 继续执行现有的有界证据核对和局部返工规则
