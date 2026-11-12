---
change: simplify-workspace-init
design-doc: openspec/changes/simplify-workspace-init/design.md
base-ref: bb4670b529550ca46b067d43a7b9d82f062aba9e
---

# 轻量 Workspace 初始化实施计划

<!-- comet-task-authority: openspec/changes/simplify-workspace-init/tasks.md -->

## 接入与诊断

- 1.1 先建立 CLI 与安装资产回归，交付个人级 Init 和项目级 Verify 配置入口，复用受管写入。 <!-- comet-task-ref:221ece0e-1c4e-46fd-b406-ee6a61837f96 -->
- 1.2 先证明无构建文件的接入失败，再让 Runtime 从 Git 与 Store 构造最小共享配置，复用原 Store 事务。 <!-- comet-task-ref:e3f222c2-b3f5-4982-8656-2173ee2bc362 -->
- 1.3 验证拒绝、请求身份和中断重试，复用原接入批准与文件所有权。 <!-- comet-task-ref:3d692f8f-c039-4200-91d0-3a2305f4c2bc -->
- 2.1 以 Git 根为权威，使用单仓直接核对及多仓同级发现。验证用户选择、普通子目录和多仓不相干仓。 <!-- comet-task-ref:0a7c2aea-90c2-4794-ac35-a39465562523 -->
- 2.2 用已复现的错误覆盖 argv、候选类型及 Store binding，再为各类失败返回对应恢复操作。 <!-- comet-task-ref:832f3936-d3e2-4661-b490-d57f755dae98 -->

## 配置与同一 Run 的验证

- 3.1 通过独立 Skill 与公开 CLI 形成只涉及目标 Profile 的可批准更新。验收拒绝、候选越权、真实覆盖和重试。 <!-- comet-task-ref:16258cfc-0213-4eb5-a612-0d697cf1288b -->
- 3.2 先增加无 Profile 时 Design 和 Build Check 的回归，用同一个 Runtime checkpoint 保存检查后等待。保留现有 Profile 的早期校验。 <!-- comet-task-ref:6a8b8234-a771-4429-bca1-26e4075ce0e5 -->
- 3.3 用真实配置批准和 Git 提交触发冷恢复，证明作用域、同一工作包与原审批保留，以及 Verify/Archive 实际运行。混合改动或未经批准的 checkout 继续阻断。 <!-- comet-task-ref:a119dec8-ae7c-4372-bf7c-5bd012660419 -->

## 安装包

- 4.1 更新安装和 Workspace 引导，使用候选包在真实宿主和单仓/多仓验收，独立审查证据和改动范围。 <!-- comet-task-ref:4f06016a-649f-472b-8adf-3c356f795088 -->
