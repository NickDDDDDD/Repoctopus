# Windows CLI 发布包验收

Tested implementation commit: `e0807820439771c9b5ff8b243227f8d4f5fd60e5`
Package content SHA-256: `36a69903dd59e7e695e0b729eb3999e11804ebf90f42804f4a592dfd6f602fe9`
Package files: `481`
Package content bytes: `6255741`
Archive SHA-256: `112ce4386943b80d109919878b77a57b56c6d2d54723d94b7455a1d2393b0a3f`

- 旧包从真实消费者目录安装后，新增回归在 Cordis 目录断言失败。Windows 报告 Core 和 Loader 均为 junction，CodeBuddy Agent 拒绝访问并报 `ERR_MODULE_NOT_FOUND`。
- 正式候选包通过独立消费者安装，两个依赖为普通目录，实际解析版本分别为 `4.0.5`、`1.0.6`。来源检查核对锁文件的完整性和 60 个 Cordis 快照文件。
- Windows npm 全局安装使用独立前缀。CodeBuddy CN IDE 4.12.4 的 Agent PowerShell 从该安装执行 `project detect`，回执为 `ok: true`、`protocolVersion: 1`。
- 同一候选的 npx 版本、帮助和项目探测通过。安装包和来源回归合计 24 项通过，CLI 和桌面构建、类型检查及改动文件 Lint 通过。
- 独立审查无 P1/P2。Core 和 Loader 保持固定版本，DSH peer 依赖共享同一个 Core 实例。桌面 Host 继续在构建时打包其依赖。
