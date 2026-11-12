# Proposal

## Why

目前 Workspace 入口只支持 Codex 和 OpenCode。团队使用 CodeBuddy、华为云 CodeArts 码道或 TRAE 时，需要可由宿主原生发现和调用的同一套 Repoctopus 入口。

## What Changes

- 新增 CodeBuddy、CodeArts 码道和 TRAE 的项目级入口安装与宿主选择。已有 Workspace 可以只补装所需宿主。
- 复用已合入的 `repoctopus-init` 个人入口和 `repoctopus-configure-verify` Workspace 入口，核对各宿主版本、发行版与启用规则。
- 复用现有计划、真实批准、文件所有权和中断恢复，保持各宿主入口正文与 Runtime 协议一致。
- Windows 优先用真实宿主验证发现、显式调用及至少一次真实 Runtime 路由。保留 Codex、OpenCode 的安装与调用回归。

## Capabilities

### Modified Capabilities

- `project-configuration`：选择、预览、补装和验证三个宿主的项目级入口。
- `skill-integration`：三个宿主原生发现并调用 Repoctopus 入口，验证实际生效范围。

## Impact

涉及安装目标映射、入口资产、宿主验收和使用说明。以 `simplify-workspace-init` 已合入 `main` 的三份入口资产为基线。借鉴 Comet 将宿主路径和安装逻辑分开的做法，依据各宿主官方文档与实际行为确认目录和调用范围。阶段 Action 仍由 Runtime 派发。
