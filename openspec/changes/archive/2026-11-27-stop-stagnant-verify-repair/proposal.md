# Proposal

## Why

GitHub #120 报告 Verify 与 Build 往返数小时。用 v0.1.5 在 Windows 五仓实验中复现了可确认的一条路径：前后两轮 Verify 的机器检查指纹相同且同一个检查失败，Runtime 仍重新派发 Build Plan。报告者的首次失败仍待核对。

## What Changes

- 基于可核对的失败机器证据和实际输入识别同一 Run 的返工停滞。
- 在已经完成一次自动返工、仍观测到同一失败且输入未变时，暂停继续自动派发，展示原失败证据与可执行的下一步。
- 恢复保留原 Verify、完成事实和拒绝证据。对确有变化的输入保留现有核对规则，并提供受管的继续修复入口。
- 用同一个安装包复验重复失败、冷恢复和确有变化后的正常继续。

## Capabilities

### Modified Capabilities

- `change-lifecycle`：约束 Verify 实现失败引起的重复自动返工。

## Impact

涉及 Verify 失败与恢复、当前 Work 的继续处理和用户可见的阻塞原因。沿用 Repoctopus Runtime、OpenSpec 与多仓 Evidence 权威。暂不改变配置选项、上报频率、桌面 UI 或发布策略。
