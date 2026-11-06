# 团队接入与 SigNoz 文档验证报告

- Tested implementation commit: `8254146e05909e551e1c82649e7e4b9d70538d19`
- Package: `repoctopus@0.1.0`
- Package files: `459`
- Package content bytes: `5658646`
- Package content SHA-256: `62834101fd30013330d78de23a45797f5ca825f4a170b4b5268058b010b03fab`
- 验证环境为 Windows x64、Node.js 24.21.0 和 npm 11.19.0。

## 验收

- 从精确提交打包，在与源码无关的临时目录执行 README 的 PowerShell 安装示例。将安装位置重定向到临时用户前缀，验证 `PATH` 解析到该前缀的 `repoctopus.cmd`，并执行 `--help`。安装包包含完整安装指南。
- Windows npm 11 的全局安装反复交替解析 vendored Cordis 与 DSH 的 registry peer，测试主动终止。独立前缀的非全局安装成功，文档采用这条已验证的路径。
- 6 个相关测试文件共 14 项通过，覆盖打包 CLI、项目接入、OTLP 三种信号、指标投影、文档契约和项目审批。
- 校验 46 个仓库内链接与锚点、两个 YAML 配置示例和 7 个应拒绝的端点值。生成物检查、精确 Prettier 检查和 Git 差异检查通过。
- Windows 全量测试首轮 1002 项通过、3 项跳过、1 项失败。新工作区缺少 Electron 可执行文件，运行 `npm run desktop:prepare` 后单独复跑桌面激活文件，2 项均通过。其余校验门禁分段执行均通过，包括 18 项 OpenSpec 严格校验和包内容摘要。
- OTLP 端到端测试使用本地接收器。部署后的接收、网络与认证可按指南在团队 SigNoz 中核对。
- 摘要使用仓库的语义包内容校验工具计算。测试产生的临时 tarball 和独立安装目录均已清理。
