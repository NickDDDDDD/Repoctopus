# Proposal

## Why

首次接入需要用户转交探测草稿、让 Agent 生成候选文件、在终端运行准备和审批命令。GitHub #85、#86 暴露了草稿和候选混用，以及普通子目录被误当成 Workspace 后直到批准才失败的问题。初始化同时要求推断构建和测试命令，用户因此在创建第一个 Change 前就得完成团队验证配置。

## What Changes

- 提供安装后可发现的个人级 `repoctopus-init` Skill。用户在宿主一次调用中完成单仓或多仓接入，审阅并确认一份可见的初始化计划。
- 接入仅确定 Git 仓库、Workspace、Store 和必要入口。Runtime 校验真实 Git 根、所选仓和审批输入，直接生成可审阅候选。错误布局、缺失绑定和输入类型错误在审批前得到具体诊断。
- 提供单独的 `repoctopus-configure-verify` Skill。用户需要时再确认构建、测试和 Acceptance coverage，把通过校验的 Profile 写入共享配置。
- 无 Verify Profile 的 Workspace 可以启动 Change、完成 Open、Design 和 Build。需要 Profile 时 Runtime 在同一 Run 给出可恢复的等待和配置指引。配置获批后继续真实 Verify 并满足门禁才可归档。
- 保留已有团队配置、Store 和有效证据，更新安装指引与 Workspace 本地引导。

## Capabilities

### Modified Capabilities

- `project-configuration`：最小候选、有效 Workspace Git 根、接入批准、按需更新验证配置。
- `skill-integration`：接入前可发现的 Init Skill 和独立的 Verify 配置 Skill。
- `implementation-evidence`：区分已配置 Profile 的 Design 预检与未配置时的显式延期。
- `change-lifecycle`：缺少 Profile 的 Run 可开始开发并在 Verify 边界恢复。

## Impact

涉及公开 CLI、接入配置 Schema、审批接口、入口资产、Design 预检与 Verify continuation。首批覆盖 Codex 和 OpenCode。CodeBuddy、CodeArts 和 TRAE 由 `extend-workspace-skill-hosts` 交付。本次保留 OpenSpec Store、五阶段和有效 Evidence 门禁。参考 Comet 的个人级与项目级入口安排，产品实现沿用 Repoctopus 公共接口，无第三方源码复制或许可证变更。
