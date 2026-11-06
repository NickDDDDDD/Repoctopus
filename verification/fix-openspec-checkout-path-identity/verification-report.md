# OpenSpec Store checkout 路径身份验证报告

- Tested implementation commit: `e8fafad4cfefb7c7c5cbbf569a866d5b41791924`
- Package: `repoctopus@0.1.0`
- Package files: `459`
- Package content bytes: `5664153`
- Package content SHA-256: `6f023718738610a9be187b17e72fa7c9f2ee861cdc631a55fb48e129926f02ed`
- 验证环境为 Windows x64、Node.js 24.21.0、npm 11.19.0 和 Comet Classic 0.5.1。

## 验收

- TDD RED 由安装版 CLI 复现原始 Store checkout 冲突。另一个 RED 证明探测将 junction 别名记录为 Workspace。修复后两条真实 CLI 路径通过。
- 六个定向测试文件共 42 项通过。覆盖真实注册表、Store ID 冲突、失效路径、同一 checkout 重复探测、多仓 pointer 和归档隔离。接入验收额外验证了目录越界、旧审批重放与登记漂移。恢复原登记后，同一请求完成接入，首次 Evidence 通过。
- 从精确修复提交构建 tarball。将测试临时目录设为真实 8.3 短路径，实际安装版 `test:package-e2e` 通过。隔离 npm 缓存使用同一候选运行 `test:release-npx`，帮助与 JSON 协议均通过。临时安装和打包目录已清理。随后只调整失效登记测试的断言写法，重新运行安装验收与 lint 均通过。组合摘要测试确认改动后的插件实现身份，包内容未因这两项测试调整而变化。
- Build 独立审查复核了审批文件边界、恢复时 Store 登记重新核验和正反路径场景。发现的问题已修正并复审。现有 Archive 隔离测试覆盖正常隔离 checkout。本次仅验证与路径身份改动相关的归档行为。
- 远端 Windows CLI 和桌面安装器验收由合入后的 Release Prepare 执行。公开安装包与真实 URL 的 `npx` 验收由 Publish 执行。
