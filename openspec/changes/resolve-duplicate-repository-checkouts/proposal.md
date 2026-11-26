# Proposal

## Why

同一远端在开发目录中有多个 checkout 时，多仓接入会剔除整组目录，探测候选也没有解释原因。GitHub #110 中，用户明明选择了 `backend`，仍只能临时移走其他目录才能完成初始化。

## What Changes

- 在多仓接入的候选中展示指向同一远端的 checkout 和实际路径。
- 允许用户在有歧义时绑定明确的 checkout，或显式排除整组，仍在原接入审批中核对最终选定的仓库。
- 使用已登记路径识别已有 Workspace 的绑定。路径失效、选择矛盾或审批期间身份变化时，给出可执行的恢复提示。
- 维持首次接入的轻量路径。Verify Profile 单独配置，项目仍使用既有 OpenSpec Store。

## Capabilities

### New Capabilities

### Modified Capabilities

- `project-configuration` — 多仓探测、checkout 选择、接入候选审批与恢复。

- `multi-repository-probe` — 将同一远端的候选路径作为探测诊断返回，保留已选择仓库快照中的身份唯一性。

## Impact

影响多仓项目探测、Init CLI 与 Skill、用户接入指南和 Windows 实包验收。一个远端在一个 Workspace 中仍绑定一个 checkout。Comet 的路径与分支核对仅作设计参考，无第三方源码采用或许可证变更。
