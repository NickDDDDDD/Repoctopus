# 工作区 OTLP 地址验证报告

- Change: `configure-workspace-otlp-endpoint`
- Tested implementation commit: `48228ddbee55444cda200173cd2cd078d44c6bd1`
- Package: `repoctopus@0.1.0`
- Package files: `458`
- Package content bytes: `5647448`
- Package content SHA-256: `1001d84f5b39cd293ba93193bbaa6b4bd47617f042757ac01c8727c1a339e84c`
- 平台为 Windows x64，Node.js `24.21.0`，控制器为 Comet Classic `0.5.1`。

## 验收

- 旧版 CLI 在 YAML-only 场景拒绝 `telemetry`。实现后，真实 CLI 在工作区写入带路径前缀的地址，并由本地 HTTP 接收器确认三类信号的请求和 Evidence 正文。
- 单信号环境变量优先于公共环境变量，公共环境变量优先于 YAML。Windows 环境查找对象保持原样，覆盖端点、Header 和超时。纯环境变量部署保持可用。
- 独立审查后补齐回归。只变更遥测地址不改变同一版本中的 Run 执行配置身份。已有 Run 能继续产生 Evidence，工作区初始化确认仍核对完整 YAML 摘要。
- 无效地址被 `telemetry.endpoint` 诊断拒绝，凭据不回显。认证继续由部署环境提供。
- 定向验证覆盖项目配置、项目初始化、Composition、OTLP 配置、接收器和字段文档。8 个测试文件共 41 项通过。类型检查、lint、架构和 provenance 检查通过。
- GitHub Linux `npm run verify` 在报告提交 `33645005087906d6462aa610a11a170052fc0389` 通过。193 个测试文件通过、1 个跳过，OpenSpec 严格校验 19 项通过，包摘要复算匹配。见 [CI 运行](https://github.com/NickDDDDDD/Repoctopus/actions/runs/42141367199)。
- Windows 全量首轮 1002 项通过、3 项跳过。唯一失败是已有 Desktop 启动用例返回 `desktop.activation.unavailable`，单独复跑该文件两项均通过。另行验证的包摘要与 OpenSpec 严格校验均通过。
- 端到端使用本地测试接收器。公司 Collector 的连通性取决于实际部署网络和认证。

## 工件

包摘要使用现有规范化 npm 内容摘要工具计算，临时 tarball 和专用目录已清理。验证报告采用 UTF-8 和 LF，提交后将核对 Git blob 的完整字节。
