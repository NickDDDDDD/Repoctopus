# Proposal

## Why

GitHub #93 的 Workspace 误跟踪了 `.repoctopus/` 中的本地运行时文件。Evidence 拒绝这些输入，而在 Build 期间解除跟踪的提交又被当前逐仓 checkpoint 判定为未获授权的 HEAD，导致已开始的 Run 无法继续。

## What Changes

- 在 Build Configure 冻结 Binding 前检查受管工作区，报告被 Git 跟踪的运行时路径，让开发者在当前 Run 中先修正工作区。
- 当已绑定的 Workspace 产生可验证的纯运行时文件清理提交时，由 Runtime 在原 Run 上更新 Build 进度。保留已接受的规划、审批及仍有效的工作包成果。
- 沿用现有分支、逐仓写集和未知执行的保护。无法证明为纯清理的变更仍需受管处理。
- 用实际 Windows 安装包和独立多仓 Git 项目验证两个入口。覆盖待执行首包、保留先前完成事实和拒绝夹带业务改动。

## Capabilities

### New Capabilities

### Modified Capabilities

- `change-lifecycle`：规定 Build 绑定前的运行时文件检查及已绑定 Run 的受限恢复。

## Impact

改动涉及 Build Configure、`run resume`、`run next`、Git 观察及现有 Build workspace checkpoint。更新工作流文档，说明清理时机与原 Run 的恢复方式。范围限于 GitHub #93 的运行时文件误跟踪和恢复，常规外部提交仍按已有工作流处理。

参考 Comet Classic 0.5.1 的工作区身份核对、未解决执行保护和同一 Run 的版本化提交。本 Change 采用实现原则，第三方源码与许可证沿用仓库现有采用记录。
