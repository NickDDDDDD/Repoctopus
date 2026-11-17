# Repoctopus v0.1.3 候选验证

Tested implementation commit: `5029a75d3939b1670595c73e24a8e1f2bd5fa083`

Package content SHA-256: `fbf36bed838a6003ea402c5eb6e9e646f08a0fa2b092a507ca05ae6f2e7bd651`

Package files: `487`

Package content bytes: `6576162`

## 本地验收

- 在 Windows 用 Node.js 24 从已提交源码构建实际 `repoctopus-0.1.3.tgz`。包内包含 README、安装文档、遥测文档和 SigNoz 看板。
- 同一份安装包通过包 E2E 及隔离 npx 测试。CLI 版本为 `0.1.3`，帮助和 `project detect --json` 返回预期结果。
- 版本源和锁文件的包根版本一致。格式校验和 Git diff 校验通过。
- 产品代码沿用 `ff35328`。该提交的 Windows 安装包已跑完三条五仓 Change，覆盖 Build 冷恢复、Verify 局部返工和 Archive PR 响应丢失恢复。

## 发布验收

Release Prepare 从已通过 `main` CI 的版本提交构建并验证 CLI、npx 与 Windows 安装器。发布说明列出 v0.1.2 之后合入的五项更新。详情见[发布说明](release-notes.md)。
