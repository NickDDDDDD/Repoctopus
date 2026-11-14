# Repoctopus v0.1.2 Windows 短路径验证

Tested implementation commit: `8a9764accbdf0334ed4244909f9c31f2a7baa0a8`

Package content SHA-256: `72b6283126a5a59d377c95e58dd99036f3de8d9c424bfa026608c94d4bd92ad4`

Package files: `486`

Package content bytes: `6460917`

- 首次 Release Prepare 的 Windows runner 从含 `RUNNER~1` 的安装目录启动 CLI，`project detect` 在读取随包 Skill 时失败，未创建草稿。用实际 Windows 8.3 短路径启动旧候选复现同类错误。
- 修复后，从该候选实际安装的短路径执行项目探测和接入准备，E2E 通过。独立 npx 验证确认版本、帮助和项目探测 JSON。
- 项目接入的 20 项测试通过，含 Workspace 越界链接拦截。OpenSpec 严格校验、类型检查和 Lint 通过。

正式 Release 仍由 `main` CI 和已绑定新提交的 Prepare 验收，包含 Windows 安装器。
