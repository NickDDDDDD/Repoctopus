# 多仓 Build 漂移恢复验证

本次按照 [技术设计](../../../openspec/changes/scope-build-workspace-drift/design.md) 修复 #114 和 #115。统一 Build 续跑与验收的 Git 观察。无关快进保留有效工作，真实读取依赖变化触发局部复核，发布前独立核对远端源与目标。

在 Windows 上安装同一个候选包完成四个隔离多仓场景。前两条问题从真实 Git 变动恢复同一 Run 至终态，业务 PR 的三点差异没有外部文件。额外 Archive intent 在发生推送或 PR 副作用前被拒绝。后续依赖和原 Host 调用失败后的恢复均通过。精确内容摘要和 PR 坐标见 [验证报告](../../../verification/scope-build-workspace-drift/verification-report.md) 与 [Windows 验收收据](../../../verification/scope-build-workspace-drift/windows-acceptance.json)。

全量 `npm run verify` 通过，1333 项通过、4 项跳过，OpenSpec 严格校验 16 项通过。独立审查确认拒绝命中原 claim 与提交，已结算失败的重派发绑定相同 Run，发布前核验实际远端源头和目标历史。正式 Verify Guard 重构并核对与报告完全相同的候选包。
