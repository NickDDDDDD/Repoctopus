# Proposal

## Why

目前 Workspace 入口只支持 Codex 和 OpenCode。团队使用 CodeBuddy、华为云 CodeArts 码道或 TRAE 时，需要可由宿主原生发现和调用的同一套 Repoctopus 入口。

## What Changes

- 新增 CodeBuddy、CodeArts 码道和 TRAE 的项目级入口安装与宿主选择。已有 Workspace 可以只补装所需宿主。
- 在 `simplify-workspace-init` 交付的个人级 Init 和项目级 Verify 配置资产上扩展同样的宿主覆盖，明确宿主版本、发行版和启用规则。
- 复用现有计划、真实批准、文件所有权和中断恢复，保持各宿主入口正文与 Runtime 协议一致。
- Windows 优先用真实宿主验证发现、显式调用及至少一次真实 Runtime 路由。保留 Codex、OpenCode 的安装与调用回归。

## Capabilities

### Modified Capabilities

- `project-configuration`：选择、预览、补装和验证三个宿主的项目级入口。
- `skill-integration`：三个宿主原生发现并调用 Repoctopus 入口，验证实际生效范围。

## Impact

涉及安装目标映射、入口资产、宿主验收和使用说明。新增项目级支持可基于当前入口机制验证。最终个人级 Init 和项目级 Verify 配置覆盖以 `simplify-workspace-init` 的资产合同为前置。实现遵循宿主官方文档与 Comet 已有安装经验，无需引入 IDE 插件进程、复制第三方源码或变更许可证。阶段 Action 仍由 Runtime 派发。
