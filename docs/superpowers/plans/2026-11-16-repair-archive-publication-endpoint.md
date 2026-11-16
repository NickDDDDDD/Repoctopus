---
change: repair-archive-publication-endpoint
design-doc: openspec/changes/repair-archive-publication-endpoint/design.md
base-ref: 1fdd4a63e76ffc7a15d890690b2a825c6883dafc
archived-with: 2026-11-17-repair-archive-publication-endpoint
---

# Archive 发布策略实施计划

<!-- comet-task-authority: openspec/changes/repair-archive-publication-endpoint/tasks.md -->

## 1.1 发布目标回归

<!-- comet-task-ref:5ad42c94-49b6-40ae-bf86-be1941b4f8fb -->

在现有 Archive 组合验收中拦截 HTTP 请求，记录业务及规格的目标。在修复前确认规格请求落到默认 API；增加策略漂移测试，比较远端 refs 和 API 请求次数。

## 1.2 传递已核验的策略

<!-- comet-task-ref:af9a4883-ace1-45cb-9399-9511e28a76ef -->

依赖 1.1。由 WorkflowRuns 在已有策略摘要守卫后向规格发布传递该策略。业务及规格共用 GitHub 客户端构造，运行自定义 API 和默认 API 的相关回归。

## 2.1 验证直接前驱

<!-- comet-task-ref:d88955bb-d28d-4416-b4c9-e91801424226 -->

依赖 1.2。以冻结的原包代码、描述符和状态契约核对兼容采纳。使用既有机制，保留旧的完成证据和发布记录，覆盖错误前驱。

## 2.2 Windows 多仓验收

<!-- comet-task-ref:a94b4f27-a5eb-446a-9c06-1286e77de93c -->

依赖 2.1。将已提交的实现打成实际安装包。用受限本地 HTTPS 接口和 Git 远端从原两条 Run 的发布边界继续。记录所有创建及 Git 写入请求，比较原证据、PR 和远端 OID。用新进程复验终态无额外发布。

## 2.3 验证与报告

<!-- comet-task-ref:8353771b-8d8e-484f-acf6-0dbe7f8e5f0b -->

依赖 2.2。记录验证过的提交、包内容摘要、实际 API 与 Git 结果。处理独立审查结论，运行完整 Verify 和严格规格校验。
