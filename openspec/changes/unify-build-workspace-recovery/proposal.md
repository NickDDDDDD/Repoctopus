# 统一 Build 工作区恢复判定

## Why

Repoctopus v0.1.0 的真实多仓验收在首个 Build 工作包完成后重启进程，`run resume` 将已接受的分支和提交变化误判为 `runtime.project-changed`，并留下需要协调的状态。同一 Run 的 `run next` 保留 Binding、Plan 和已完成工作包，继续派发第二个工作包，两个入口对同一执行现场给出了不同结论。

## What Changes

- 让 `run resume` 与 `run next` 使用相同的 Build 工作区恢复判定，依据当前获准的执行绑定和持久化检查点识别可继续的 Run。
- 保留已接受的 Binding、Plan、工作包、证据和下一项工作。逐仓校验实际 checkout，阻断未授权的分支切换和无法用现有权威记录解释的仓库漂移。
- 用公开 CLI 在真实多仓实验项目复验。两个入口分别在新进程中恢复同一 Run，保留第一个工作包并识别第二个工作包；将一个业务仓切到未授权分支后，两者都阻断执行，切回后仍可从原进度恢复。
- Archive 与 Verify 的证据一致性问题交给后续独立 Change，在本 Change 验证合入后处理。

## Capabilities

### New Capabilities

### Modified Capabilities

- `multi-repository-probe`：约束 Build 恢复时仓库事实的判定基线，以及两个公开入口对执行进度与漂移的一致解释。
- `managed-work-execution`：明确已授权兼容重绑定与未授权 checkout 漂移的边界，使 Configure revalidation 与恢复阻断遵循同一授权规则。

## Impact

- 涉及 Runtime 的公开恢复入口、Build 工作区绑定和进度校验，以及 CLI 多仓回归验收。
- 参考固定上游 Comet 0.5.1 的 Classic 分支绑定与 Engine checkpoint 恢复设计和测试。采用行为与测试方法，无第三方源码引入或许可证变更。
