---
change: extend-workspace-skill-hosts
design-doc: openspec/changes/extend-workspace-skill-hosts/design.md
base-ref: 3d756bea681a4ed9b63de0ef7846080ebf0f2153
---

# 扩展 Workspace 入口宿主实施计划

<!-- comet-task-authority: openspec/changes/extend-workspace-skill-hosts/tasks.md -->

- 1.1 先复现新宿主选择失败。复用受管入口正文、所有权和原子写入，并按项目与个人作用域计划唯一目标。验证默认 Codex/OpenCode 及选择范围。 <!-- comet-task-ref:9c21fdc5-dff9-4a5e-966c-853e18d6ec75 -->
- 1.2 先通过公开 CLI 复现缺少补装入口。复用现有审批与重试，核对请求身份与目标，验证拒绝、冲突、中断和现有配置/Run 保留。 <!-- comet-task-ref:7165e11b-3aa6-42ce-ad61-bca8a540d0e6 -->
- 1.3 用 Windows 实际宿主核对发现、选用的正文与公开 CLI 续行。依赖宿主账号或版本时保留实际结果。 <!-- comet-task-ref:887897a4-70b2-4e21-915e-00111b7f94a5 -->
- 2.1 覆盖两种作用域的入口映射，在首次接入及已有 Workspace 核对 Init 与 Verify 配置的实际入口。 <!-- comet-task-ref:6e9bba1f-5a7c-4946-8b8e-c2767303b741 -->
- 2.2 更新现有用户文档，从固定候选包复测实际宿主及原宿主回归，独立审查审批和写入边界，保存对应证据。 <!-- comet-task-ref:9c4a65ca-e29f-45bc-9b07-478dcee28cd8 -->
