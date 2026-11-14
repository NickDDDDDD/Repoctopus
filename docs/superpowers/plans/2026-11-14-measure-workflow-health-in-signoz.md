---
change: measure-workflow-health-in-signoz
design-doc: openspec/changes/measure-workflow-health-in-signoz/design.md
base-ref: 7ea00e5db03a42d4148a374a585c24238e72b54b
---

# 工作流健康指标实施计划

<!-- comet-task-authority: openspec/changes/measure-workflow-health-in-signoz/tasks.md -->

## Runtime 事实

<!-- comet-task-ref:d0efea8d-630c-45a4-b0aa-63d25a30a407 -->
<!-- comet-task-ref:4dc1ce65-14c5-4eae-9404-19e89337f48c -->
<!-- comet-task-ref:0181fa75-2c75-4038-a8c9-32b001fc0628 -->

先用真实 Trajectory 与重复回执夹具验证启动、配置、阶段和终态语义。扩展共用观测投影，保留有限枚举、稳定身份和完成 Run 的六条回退计数。用已接受转换计算回退，补验跨窗口、无历史和零回退。

## OTLP 投递

<!-- comet-task-ref:8808e0ea-dedb-4546-99e6-8e9c7e732554 -->
<!-- comet-task-ref:e36f0f3b-2c64-42cc-8f57-42cfd4e6ec6d -->

先复现信号部分失败及独立 CLI 打开同一 outbox 的覆盖。对远端接入关闭边界、有界批次和诊断模式，桌面照常即时投递。以可恢复文件锁和独立确认推进，测试失败恢复、空载、旧游标、部分拒绝与传输预算。

## SigNoz 看板与多仓验收

<!-- comet-task-ref:0072b5f3-bf8d-443d-bc37-43f60b4b3fe8 -->
<!-- comet-task-ref:34c2a89a-0620-495d-be5f-8a4b82afc4a2 -->
<!-- comet-task-ref:7d553ec3-4faf-47f9-b1af-a89a7400d217 -->

从规范字段构造可导入看板和使用说明。对真实候选安装包执行不同结果的多仓 Change，以 Runtime 轨迹作预期，用本地 SigNoz API 和 MCP 对账。同一场景测量请求、入库、重复和无样本行为。最后做独立审查、严格 OpenSpec 校验及 Comet Build/Verify。
