# TDD 工作包结果纠正验证

Tested implementation commit: `fbaa03ad8ab5648e37f9a2ff7e19703de4628d68`

Package content SHA-256: `ad6c5a99912428e0fc6a01315a0eddcbab0d73711127437066284656f23a94a3`

Package files: `493`

Package content bytes: `6826543`

## 回归

在旧代码的生产组合中，向有效的 TDD Build Execute Work 提交缺少 `tddEvidence` 的完成候选。下一次 `next` 在构造证据时抛出 `TDD Build completion requires RED, GREEN, and regression Evidence`。测试在相同边界验证修复后的拒绝、重启与补交，并继续完成 Archive。

## Windows 实包

在上列提交执行 `npm run build` 和 `npm pack --ignore-scripts`。两轮隔离三仓验收安装同一候选包，使用本地 Git 远端和模拟 GitHub 发布 API。候选 tarball 的传输 SHA-256 为 `59293e8acfd60e89ddf7f12f4fab8dc959a0d5874c39c33ea19541c1ee9ffea1`。

- 标准场景完成 Init 到 Archive，验证首包后的冷恢复、规格 PR 响应丢失的发布去重和终态恢复。
- 专项场景在首个工作包用真实 CLI 提交缺少 TDD Evidence 的候选。Runtime 记录 `output-invalid`，清除 pending，保留 Work `build.execute:a5db652c05b2`、attempt 1、epoch 8、invocation 和执行包。另起 CLI 进程执行 `resume`，拒绝历史和原 invocation 仍可见。用新 submission ID 提交完整证据后，同一 Run 通过 Verify、完成 Archive 和终态冷恢复。

实现提交的 Linux CI 已通过 1329 项测试，8 项跳过，当时只缺少匹配该候选包的本报告。报告内容不进入 CLI 安装包。专项验收使用新的实验 Run，报告者旧 Run 的升级恢复尚待验证。
