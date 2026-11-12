# Design

## Context

`simplify-workspace-init` 已合入 `main`（`3d756be`）。Workspace 安装服务已有个人级 `repoctopus-init`、Workspace 级 `repoctopus` 与 `repoctopus-configure-verify`，并对 Codex 和 OpenCode 核对文件所有权。宿主安装位置、发现规则和启用状态因产品版本而异。

## Goals / Non-Goals

**Goals:** 让 CodeBuddy、CodeArts 码道和 TRAE 从各自原生入口调用 Repoctopus，并支持已接入 Workspace 增量补装。

**Non-Goals:** 新增宿主专用生命周期、Action Skill 副本、宿主守护进程或替代 Runtime 的审批规则。

## Decisions

1. 平台安装层复用 Comet 0.5.1 的项目与个人目录分别配置的做法。CodeBuddy 的项目目录和 CLI 用户目录都以 `.codebuddy/skills` 为起点，IDE 用户目录需实测。CodeArts 码道的项目与个人目录都使用 `.codeartsdoer/skills`。TRAE 中国版文档列出项目级 `.trae/skills` 和个人级 `.trae-cn/skills`，与 Comet 对中国版项目目录的映射不同。两种 TRAE 发行版按实际宿主核验，验收记录注明各自生效的路径。新增宿主需显式选择，复用现有安装预览。 [CodeBuddy IDE](https://www.codebuddy.ai/docs/ide/Features/Skills) · [CodeBuddy CLI](https://www.codebuddy.cn/docs/cli/skills) · [CodeArts](https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0024.html) · [TRAE 中国版](https://docs.trae.cn/ide_skills?lang=zh)
2. 复用受管正文、批准的路径和内容摘要、冲突检查与中断恢复。CodeArts 的项目 Skill 启用状态、用户或企业级同名 Skill 优先级，以及 TRAE 发行版差异在真实宿主验证。需要宿主操作时说明具体步骤并观察结果，避免把文件存在当成已经启用。
3. 入口安装由配置 Service 负责，平台适配器确认路径与文件，Domain 保持审批契约，Engine 与 Action 装填保持同一协议。新增宿主只声明其真实能力。
4. Windows 优先，用实际安装包和新宿主会话验证个人级 Init、项目级 Verify 配置和工作流入口。验收记录包含宿主版本、实际发现和调用，以及通过公共 CLI 得到的 Runtime continuation。

## Risks / Trade-offs

- 宿主仅在文件创建后可见、需要重载或被更高优先级同名 Skill 覆盖时，应记录具体表现。官方文档、实际宿主和 Runtime 协议冲突时先厘清支持范围。
- 五个宿主同时安装可能引入无用配置目录，用户只选择需要的宿主。已有项目仅补齐获批目标。
- 本机已登记 CodeArts Agent、TRAE 国际版和中国版。客户端的模式、账号和实际调用能力仍需验证。CodeBuddy 的可用验收宿主待确认。
