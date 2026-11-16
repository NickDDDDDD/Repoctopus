# Proposal

## Why

`spec validate --run` 会在 Runtime 接受 Open 或 Design 证据前冻结校验摘要。实际安装包已复现失败校验卡死原 Run、有效草案无法继续迭代，以及另一份 Change 的校验结果写入当前 Run。另有部分 Build 和 Archive 入口会把 Provider 暂不可用当作规划变化。

## What Changes

- **行为变更** 将手动规格校验限定为当前 Change 的只读诊断。指定 Run 时先核对其归属。
- 让 Runtime 在接受当前阶段的有效证据时记录绑定，沿用阶段、批准提案与 Work 的现有校验。
- 统一处理 Provider 无法观察与已证实规划变更，前者保留当前 checkpoint，后者进入现有 Design 修订。
- 用实际安装包验证同一 Run 冷恢复，复验多仓 Verify 和 Archive 的身份约束。

## Capabilities

### Modified Capabilities

- `specification-authority`：规定校验查询的只读契约、阶段证据的提交边界和后续阶段观察结果。

## Impact

影响 CLI `spec validate --run`、Specification 命令与规划服务，以及 Runtime 中 Open、Design、Build 和 Archive 的观察与接受路径。现有失败现场和批准历史用于复核。
