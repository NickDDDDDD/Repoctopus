# Workspace 接入与用户文档验证

Tested implementation commit: `4041914803316cb6c12fb6f9bc2d07bbe1d99ff4`

Package content SHA-256: `7c7989463f6f334707851e1c32c5f6902eb48028997124c61d08ecd3e67d278f`

Package files: `493`

Package content bytes: `6756113`

## 文档核对

- README、项目接入页和生成的 Workspace 指南在初始化后引导用户先核对项目、Store 和 Skill。启动步骤使用真实需求和已公开的 Change 分支。
- 单仓和多仓各自准备一份 Init 请求。已安装 CLI 与维护者源码命令分开，桌面恢复使用原 Run ID。
- 共享示例沿用默认 Skill Provider，启用自定义绑定前先提供相应文件。实跑 `skill preview` 得到 9 种 Work，且没有写入 Run 状态。
- 对 30 份公开 Markdown 核对了 99 个本地链接和锚点，解析了 57 段 PowerShell，全部通过。用发布版 `v0.1.4` 运行 README 的团队 Skill 示例，确认来源和加载顺序。

## 验证

Workspace 引导与 Skill 预览共 26 项测试通过。类型检查、lint、CLI 和桌面构建、生成物、来源清单及 15 项严格 OpenSpec 校验通过。

CI 首轮发现三处文档断言仍按旧命令或带锚点的完整链接字符串检查。更新三个测试文件后，相关三个测试文件共 5 项通过。该修正只改动包外测试文件，重新打包核对相同的内容 SHA-256、文件数和字节数。

实际候选包通过 Windows 三仓 Init 到 Archive 验收。同一 Run `change-workspace-verify-package-workflow-1084f1a8861b28e9` 完成首个工作包后换进程恢复，并通过发布响应丢失去重和终态恢复验证。全程耗时 252.98 秒。规范化包内容身份由 `check:managed-execution-report` 独立复现。
