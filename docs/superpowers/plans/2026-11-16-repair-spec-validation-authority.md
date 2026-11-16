---
change: repair-spec-validation-authority
design-doc: openspec/changes/repair-spec-validation-authority/design.md
base-ref: c375eb9
archived-with: 2026-11-16-repair-spec-validation-authority
---

# 规格校验权威修复实施计划

<!-- comet-task-authority: openspec/changes/repair-spec-validation-authority/tasks.md -->

## 先锁定观察和提交的反例

<!-- comet-task-ref:31d05ef2-5eb2-4305-9fd8-e28d4b834099 -->
<!-- comet-task-ref:5730719a-2b5b-46df-81a6-bbade6ef489b -->

以公开 CLI 复现错误摘要的持久化，并对照有效草案、另一 Change 和完成的 Run。通过生产组合或受管 Runtime 边界注入 Provider 失败或提交中断，记录当前 checkpoint 与副作用差异。

## 修复并复核 Runtime 写入边界

<!-- comet-task-ref:3ff70cbb-d90e-451c-988a-8e3da941d260 -->
<!-- comet-task-ref:0fdeb3e8-514f-4117-9bb8-27c4c56c392c -->
<!-- comet-task-ref:1c71c7f5-3495-4167-930a-0ec4696a2bda -->

先使 CLI 只读并核对归属，再把有效的 Open/Design 证据移入现有阶段提交。封闭独立的规格快照写入，并保留兼容性检查。将 Provider 无法观察显式投影为可重试结果，共享确定性失效分类。分段审查持久化、审批、并发重放与后续阶段。

## 验证并记录实际交付行为

<!-- comet-task-ref:aa7b2ce0-202b-46ef-bc53-770fc9e5f2d0 -->
<!-- comet-task-ref:5e9abfb6-3915-4853-ab62-b7d297e44421 -->
<!-- comet-task-ref:6d8d3a0a-a9fc-4119-82cf-d7f117874630 -->

运行生命周期和证据回归，在隔离多仓用安装包验证同一 Run 修正规格后完成 Verify 与 Archive，再从新进程观察终态。保留候选包身份、失败诊断及实际验收结果，同步 CLI 文档。
