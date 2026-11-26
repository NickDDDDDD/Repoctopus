---
change: resolve-duplicate-repository-checkouts
design-doc: openspec/changes/resolve-duplicate-repository-checkouts/design.md
base-ref: 4295f95febb5e15af6ac5d1b2addcf82e2ffe4ef
---

# 多仓接入选择实际 checkout

<!-- comet-task-authority: openspec/changes/resolve-duplicate-repository-checkouts/tasks.md -->

## 1. 复现与实现接入闭环

<!-- comet-task-ref:7fdebb4a-dacd-4bd9-b87a-bcb5836f8967 -->
<!-- comet-task-ref:ab7e1ecc-4709-4df3-bbee-2bfed492b614 -->

从公共 CLI 的四目录 fixture 复现探测静默排除。让 Git 适配器在接入模式传递冲突事实，接入候选规范化显式路径并拒绝歧义，CLI 和 Init Skill 复用诊断。用原审批证明只写入所选 checkout 的 pointer。

## 2. 登记与审批边界

<!-- comet-task-ref:9d72c090-f001-475d-bb44-6cf7e94259a2 -->
<!-- comet-task-ref:58a68616-4cf4-4c58-aa57-126d6dbc3232 -->

用真实 Git checkout 验证已登记路径保留和扫描范围约束，覆盖显式排除、双选、越界与审批期间远端身份变化。冻结候选身份，沿用现有审批和恢复对同一目标的校验，回退到重新探测而非替换目标。

## 3. 使用说明与 Windows 实装

<!-- comet-task-ref:71d9da2a-d64a-4df1-9069-859e5f6b17ea -->
<!-- comet-task-ref:1e68496f-f11a-4e18-8b6d-80e198e6d7bf -->

补齐 Init Skill 和接入指南中路径选择的示例。从本次构建的 tgz 安装，在 Windows 隔离仓验证接入、重进程复核和入口使用。运行全量 Check 与 Verify，执行独立审查，将失败与通过证据绑定到候选包。
