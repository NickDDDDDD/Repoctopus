# Spec Delta

## ADDED Requirements

### Requirement: 宿主提供首次接入与 Verify 配置 Skill

Repoctopus MUST 随可安装 CLI 分发宿主可显式调用的 Init 和 Verify 配置 Skill。Init MUST 可在没有项目级入口或 `repoctopus.yaml` 的宿主中发现。Verify 配置入口 MUST 可在已接入 Workspace 单独调用。宿主通过公开接口调用 Runtime，可信用户选择和结果保持绑定原请求。

#### Scenario: 未接入项目调用 Init

- **WHEN** 用户在已安装个人级入口的 Codex 或 OpenCode 中请求 Repoctopus init
- **THEN** 宿主启动单仓或多仓接入，展示 Runtime 预览、提交实际决定并报告结果
- **AND** 接入本身不要求用户执行中间终端命令或编辑候选文件

#### Scenario: 已接入项目配置 Verify

- **WHEN** 用户在已接入 Workspace 明确调用 Verify 配置 Skill
- **THEN** 宿主使用独立公开接口配置 Profile，并沿 Runtime 指引恢复原 Run（如有）
