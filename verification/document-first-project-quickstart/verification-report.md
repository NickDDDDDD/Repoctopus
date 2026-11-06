# 首次接入快速开始验证报告

- Tested implementation commit: `5c613ee5dc228dfbafc995faa11cdd38ffafb4ac`
- Package: `repoctopus@0.1.0`
- Package files: `459`
- Package content bytes: `5661340`
- Package content SHA-256: `f7ab563e02473c566c301dea16291001e43f36de06c0d54fe497fc98c3f9ea5f`
- 验证环境为 Windows x64、Node.js 24.21.0 和 npm 11.19.0。

## 验收

- 用本地 CLI tarball 从一个已有 Git 提交、尚未接入 Repoctopus 的单仓开始，执行 README 中的 `--help`、`project detect`、`project prepare` 和交互式 `project review`。审批成功后生成 `repoctopus.yaml`、`openspec/` 和 `.openspec-store/`，并在 `.gitignore` 忽略 `.repoctopus/`。
- 将初始化提交和 Change 分支推送到临时裸仓，从新分支执行 `run start`，再用 `run status` 确认 Run 处于 Open。测试的配置候选使用探测得到的配置，业务命令为临时项目的构建和测试脚本。
- 对比扫描根时，`--scan-root .` 漏掉单仓本身，`--scan-root ..` 正确识别它。npm 11 连续用同一份本地 tarball 时曾在 CLI 启动前出现缓存解析错误；使用文档中的 `--legacy-peer-deps` 并在干净缓存中重跑后，接入和启动命令通过。
- 4 个相关测试文件共 11 项通过，覆盖项目接入、打包和发布契约。31 个本地文档链接与锚点通过检查。三个改动文档的 Prettier 与 Git 差异检查通过。
- 从精确提交重新打包，`test:release-npx` 验证了隔离环境中的 `--help` 和 `project detect` JSON 协议。GitHub Releases 检查时尚无公开资产，本次使用本地 `.tgz`。临时包、测试仓和缓存均已清理。
