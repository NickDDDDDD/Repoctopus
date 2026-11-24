---
change: improve-desktop-workflow-guidance
design-doc: openspec/changes/improve-desktop-workflow-guidance/design.md
base-ref: 77ee9722e6836129caf3c4718054bd90f53b6b0e
archived-with: 2026-11-24-improve-desktop-workflow-guidance
---

# 桌面当前工作和下一步实施计划

<!-- comet-task-authority: openspec/changes/improve-desktop-workflow-guidance/tasks.md -->

执行 autonomous、TDD、thorough，使用已绑定 worktree。完成状态由 OpenSpec tasks.md 管理。

## 一、确认并守住状态边界

<!-- comet-task-ref:c45a3b79-ef11-4ef0-a8bd-ea57d20b10fc -->

复用真实多仓 Run 的 Design 等待、批准转换和 wait.ended 顺序，构建可复验的 OTLP 测试。核对阶段、等待身份与策略事实。

<!-- comet-task-ref:37bf2548-ec4a-4a66-8582-82c4ba1df774 -->

先用失败回归覆盖迟到的旧审批、Archive Work 与 Run 终态、返工后继续。保持原细节和历史，在同一投影内确定首屏运行状态。根据实际观测补必要字段。

## 二、实现首屏和详情

<!-- comet-task-ref:a1321ba7-f983-4890-8112-8961efbeac79 -->

在现有 Electron Renderer 呈现紧凑阶段、当前工作、下一步及分组 Run 导航。用渲染测试核对首屏文案、数据不完整和当前选中项。

<!-- comet-task-ref:eadfa99c-3f35-4ff6-a01e-df609ee51694 -->

明确区分审批、外部等待、进行中、阻塞、返工和终态。实现只读复制路径，展示当前 Skill、已知 Build 进度及可展开的原有诊断。

## 三、端到端验收

<!-- comet-task-ref:857ff474-f700-42b0-b8bb-2036ae0f9fce -->

用 Windows 实包与真实多仓 Run 核对审批到 Build、返工及归档。保存首屏图、Runtime 收据和重放证据。复验远端降噪、窄窗口、键盘、高 DPI 和启动退出。

<!-- comet-task-ref:44e121c3-8a75-4c57-8be7-cc416ed9a5ce -->

更新桌面指南，完成独立审查、完整 Verify、OpenSpec 校验和候选包身份核对。记录实际结果与未覆盖范围。
