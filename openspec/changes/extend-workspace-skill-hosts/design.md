# Design

## Context

当前 Workspace 安装服务对 Codex 和 OpenCode 计划受管入口并核对文件所有权。宿主安装位置、发现规则和启用状态因产品版本而异。初始化及 Verify 配置资产将在前置 Change 形成。

## Goals / Non-Goals

**Goals:** 让 CodeBuddy、CodeArts 码道和 TRAE 从各自原生入口调用 Repoctopus，并支持已接入 Workspace 增量补装。

**Non-Goals:** 新增宿主专用生命周期、Action Skill 副本、宿主守护进程或替代 Runtime 的审批规则。

## Decisions

1. 平台安装层用显式宿主映射描述作用域与路径。项目级优先使用宿主原生目录。CodeBuddy 使用 `.codebuddy/skills`，CodeArts 码道使用 `.codeartsdoer/skills`，TRAE 使用 `.trae/skills`。个人级目录按具体产品及发行版核验。复用现有宿主选择和安装预览。 [CodeBuddy](https://www.codebuddy.ai/docs/ide/Features/Skills) · [CodeArts](https://support.huaweicloud.com/usermanual-codeartsagent/codeartsagent_ug_0024.html) · [TRAE](https://docs.trae.cn/ide_skills?lang=zh)
2. 复用受管正文、批准的路径和内容摘要、冲突检查与中断恢复。CodeArts 的项目 Skill 启用状态、用户或企业级同名 Skill 优先级，以及 TRAE 发行版差异在真实宿主验证。需要宿主操作时说明具体步骤并观察结果，避免把文件存在当成已经启用。
3. 入口安装由配置 Service 负责，平台适配器确认路径与文件，Domain 保持审批契约，Engine 与 Action 装填保持同一协议。新增宿主只声明其真实能力。
4. 第一轮可验证现有 `repoctopus` 项目入口的移植性。最终候选基于轻量初始化交付结果，三种宿主均验证个人级 Init、项目级 Verify 配置和工作流入口。Windows 优先，用实际安装包、新宿主会话和公开 CLI；检查至少一次真实 Runtime continuation 和相应观测记录。

## Risks / Trade-offs

- 宿主仅在文件创建后可见、需要重载或被更高优先级同名 Skill 覆盖时，应记录具体表现。官方文档、实际宿主和 Runtime 协议冲突时先厘清支持范围。
- 五个宿主同时安装可能引入无用配置目录，用户只选择需要的宿主。已有项目仅补齐获批目标。
- 新宿主安装验证可并行准备，交付顺序先合入轻量初始化，再完成新增宿主的完整资产矩阵。
