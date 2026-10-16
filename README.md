# Repoctopus

Repoctopus 是面向团队 Agent 开发的多仓工作流 Runtime。它把项目探测、确定性阶段推进、运行轨迹、断点恢复和 OpenTelemetry 反馈放进同一个可检查的内核，IDE 与 Agent 只通过稳定协议调用它。

当前版本交付第一条可运行纵切：探测同级 Git 仓库，启动工作流 Run，跨进程推进和记录动作，恢复时核对仓库事实，并把 Trace、Log 和 Metric 发送到 OTLP 端点。

## 快速开始

要求 Node.js `22.16+` 或 `24+`。

```powershell
npm install
npm run build
node bin/repoctopus.js project probe --root C:\path\to\project --workspace C:\path\to\project\repoctopus --json
node bin/repoctopus.js run start --workspace C:\path\to\project\repoctopus --project-root C:\path\to\project --json
```

`run start` 返回 `runId`，随后使用：

```powershell
node bin/repoctopus.js run next --workspace C:\path\to\project\repoctopus --run <run-id> --json
node bin/repoctopus.js run record --workspace C:\path\to\project\repoctopus --run <run-id> --action <action-id> --status succeeded --summary "验证通过" --json
node bin/repoctopus.js run resume --workspace C:\path\to\project\repoctopus --run <run-id> --json
node bin/repoctopus.js doctor --workspace C:\path\to\project\repoctopus --run <run-id> --json
```

运行状态保存在 workspace 的 `.repoctopus/`，不会写入同级业务仓。OTLP 配置遵循标准 `OTEL_EXPORTER_OTLP_*` 环境变量；没有配置端点时遥测自动降级为空实现。

## 架构入口

- [Runtime 架构](docs/architecture.md)
- [状态与恢复](docs/runtime-state.md)
- [OpenTelemetry 与 SigNoz](docs/telemetry.md)
- [第三方来源与采用报告](third_party/comet/adoption-report.md)

## 开发验证

```powershell
npm run verify
npm run test:package-e2e
npm run test:tracer-e2e
```

完整验证还包含类型检查、Lint、确定性构建、来源摘要检查、OpenSpec 严格校验和实际 npm 打包安装。
