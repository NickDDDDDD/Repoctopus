# Repoctopus v0.1.2 候选验证

Tested implementation commit: `b36afc56d68f9e34b116559a343df7a4f56f7cfd`

Package content SHA-256: `121e13a893123501136e13abf28863b777ebe3b874f11f90cac970e210bc66a5`

Package files: `486`

Package content bytes: `6460550`

## 本地验收

- Windows Node.js 24 上用固定依赖构建 CLI 与桌面文件，并用 `npm pack --ignore-scripts` 生成实际候选 `repoctopus-0.1.2.tgz`。检查包包含 README、接入和安装文档以及 SigNoz 工作流健康看板。
- 在源码仓之外安装同一个候选，验证 CLI 版本、OpenSpec Store、包内 Skill、项目和验证命令以及运行时遥测版本。隔离的 npx 缓存验证了 `--version`、`--help` 与 `project detect --json`。
- 在旧实现上稳定复现 Verify 的并发错误。让一个节点在 Receipt 已写、完成 Journal 尚未提交时抛错，同时让另一个节点停在提交完成记录前。修复后，第二个节点先持久化完成，原调用随后返回错误。恢复采纳第二个节点的结果，保留第一个节点为未完成并阻断其下游，没有重跑原命令。
- Evidence 与发布相关测试通过 30 项，跳过 1 项。实际候选包 E2E 另通过 1 项。严格 OpenSpec 校验、类型检查、Lint、生成物与架构检查通过。

正式 Windows 安装器和 GitHub 公共下载由 Release workflow 验证。该 workflow 以 `main` 上通过完整 CI 的提交为输入。
