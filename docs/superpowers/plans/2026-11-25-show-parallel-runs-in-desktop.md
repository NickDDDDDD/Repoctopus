---
change: show-parallel-runs-in-desktop
design-doc: openspec/changes/show-parallel-runs-in-desktop/design.md
base-ref: 406dee753136532fc60973c1d91129fe43001982
---

# 并行 Run 桌面工作台实施计划

<!-- comet-task-authority: openspec/changes/show-parallel-runs-in-desktop/tasks.md -->

按已批准配置自主实施，保留失败回归与独立审查，任务状态由 OpenSpec 管理。

## 宿主报告及权威校验

<!-- comet-task-ref:da7bd392-4d8f-41dd-90e9-a62c803344e3 -->

先验证当前父 invocation、签到与返回的幂等性及包范围拦截；复用现有 Run Store/Trajectory 和 Host 认证，添加有界的报告入口及阶段 Skill 指引。

## 本地传输及投影

<!-- comet-task-ref:36ec88b7-8765-49e5-8d23-1e90fa2fefa8 -->

从同一 OTLP envelope 投影成员开始、活动与结束，在接收器重放及父 Work 替换后核对历史与活跃人数。远端选择器对新增活动保持隔离。

## 工作台宫格

<!-- comet-task-ref:7b4d9738-1d49-4247-9811-8815b2ca3331 -->

以三重身份渲染并行卡片和历史记录；验收同名 Change、多 Workspace 及状态变化。

## Run 放大

<!-- comet-task-ref:46160bb0-1784-49dd-86c3-e56ba8bc908d -->

保留五阶段、当前 Work、诊断和原投影，并验证 Esc、滚动位置和键盘焦点。

## 人机交接

<!-- comet-task-ref:8a64f922-4107-4cc4-862f-448cad8070cd -->

复用有效审批判定，区分执行、待审批、外部等待及阻塞。验证随生命周期更新撤销旧提示。

## 子 Agent 展示

<!-- comet-task-ref:686d92ca-1953-4e77-9954-268dda47b8d6 -->

用本地投影显示活动摘要和可访问详情。验证 3 位、5 位、窄窗和过期事实。

## Windows 验收

<!-- comet-task-ref:20f8bbd1-5dc2-4b6b-9759-85bdff14cdba -->

复用 Electron 与多仓验收设施。用可委派的宿主生成实际活动，再做多 Run 更新、冷恢复、人工待办和实际渲染的核对。

## 文档与交付验证

<!-- comet-task-ref:3c87bf43-145a-4fa0-93a5-4b0475efc6fb -->

更新桌面指南及遥测字段参考，完成独立审查、完整检查并保留可重复证据。
