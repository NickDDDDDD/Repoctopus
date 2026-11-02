# Runtime Workspace Binding 稳定性验证交接

## 结论

`stabilize-runtime-workspace-binding` 的实现与生产边界验证已完成。Runtime 现在会在创建 Run 前校验 Workspace binding，幂等恢复不再重复初始 Work，Open Provider 暂时不可用时只做 `reobserve`，不会误触发 Host reconciliation。

## 权威证据

- Repoctopus 正式验证报告：`verification/stabilize-runtime-workspace-binding/verification-report.md`
- 核心产品实现边界：`a400771190d8e414c54ae427d1430bb22f618fc4`
- 控制器：`@rpamis/comet@0.5.1`

本文件只把 Comet Classic Verify 入口连接到正式验证报告，不建立第二套验证权威。npm 包摘要只记录在包外的正式报告中，避免包内容自引用。

## 已证明的关键行为

- target branch、detached HEAD、remote 和 topology 在 RunStore 写入前 fail closed。
- HEAD、dirty、path 与观察时间不改变 semantic binding identity。
- 并发等价启动收敛到一个 Run；binding 漂移不改变原 checkpoint 或 trajectory。
- Provider unavailable 保留同一 Work、attempt、invocation 和成功 Outcome，并通过下一次 pull 重观察。
- Windows CLI、真实 Desktop、远端 OTLP、OpenSpec Provider 与完整 managed lifecycle 均已覆盖。

## 已知边界

- Runtime 只校验 binding，不创建、切换或删除 branch/worktree；checkout 准备仍由 Runner 负责。
- 本 Change 不迁移预发布阶段已经卡死的旧 Run；旧 Run 只保留为缺陷证据。
- OpenSpec Store 首次初始化与 CLI 默认值属于独立后续问题。
