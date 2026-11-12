---
change: install-workspace-entry-skill
design-doc: openspec/changes/install-workspace-entry-skill/design.md
base-ref: 87dcd9631a801b9d551a3d24de9a6a36e49035c7
archived-with: 2026-11-12-install-workspace-entry-skill
---

# Workspace 入口 Skill 实施计划

<!-- comet-task-authority: openspec/changes/install-workspace-entry-skill/tasks.md -->

## 1. 安装、调用和装填

<!-- comet-task-ref:b0a5fbc8-83f7-4b67-8664-4b10e7b33c90 -->

先在项目接入测试中证明入口安装缺失。使用 CLI 包内单一入口资产，绑定接入候选、审批摘要及写入前态。实际安装包复核 Codex 发现。

<!-- comet-task-ref:f6a52240-5e08-4210-9042-5c03495c571f -->

入口记录从 Workspace 明确启动或恢复的公共操作。宿主缺少意图、目标或 Run 身份时澄清。用真实宿主记录启动和恢复身份。

<!-- comet-task-ref:6949290a-69fe-4a87-9172-f412699dcc1f -->

先补失败测试，再从同一次 Skill 读取冻结正文与资源。在领取之前检查资源清单、路径与大小，并将内容纳入执行包摘要。覆盖缺失、漂移、动态诊断层和已领取恢复。

<!-- comet-task-ref:1f872953-a072-4f23-9046-8f14fdef0ef8 -->

入口按 Runtime continuation 处理执行、决定、等待、核对与结束。用宿主验收证明 Open 审批停留和冷恢复后按当前包进入 Design。

## 2. 接入范围与恢复

<!-- comet-task-ref:157d89ad-92a9-40e6-9a86-eb97cd048e53 -->

复用宿主路径约定实现 OpenCode。分别核对单仓、多仓的写入范围和真实 OpenCode 加载。

<!-- comet-task-ref:85014b1f-3791-4a2c-85e2-3eee98caf56b -->

先测未受管文件、路径、修改和并发冲突，再将安全写入和所有权检查接入原事务。审批失败不得发布成功状态。

<!-- comet-task-ref:ddc2b0f8-b3a2-4644-b5ab-9a0b43164b30 -->

模拟中断和已确认请求重放，证明既有 Store 与 Run 身份保留。补齐本地使用说明。

## 3. 实际安装包验收

<!-- comet-task-ref:83b0006c-5d17-44e7-b319-ffd16d69fdae -->

实际安装包、多仓 Workspace 和真实宿主贯通调用、消费、审批及跨进程恢复。核对 Build Configure 后的 Runner 与回执、遥测。用独立审查和项目完整检查验收。
