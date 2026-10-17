# Repoctopus

Repoctopus 是面向团队 Agent 开发的多仓工作流 Runtime。它把项目探测、确定性阶段推进、运行轨迹、断点恢复和 OpenTelemetry 反馈放进同一个可检查的内核，IDE 与 Agent 只通过稳定协议调用它。

当前版本包含 Runtime 基础和交付治理纵切：探测同级 Git 仓库，确定性推进工作流，自动创建策略允许的本地 checkpoint commit，把验证报告绑定为多仓交付快照，并在用户通过 IDE 或 CLI 交互批准后可恢复地执行 push 与 MR 动作。Repoctopus 只读取 MR 合入事实，不自动 merge。

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

## 交付治理

复制 [交付策略示例](docs/examples/repoctopus.yaml) 为 workspace 的 `repoctopus.yaml`，并为 change 创建 [交付意图](docs/examples/delivery-intent.yaml)。本地 checkpoint 不需要人工批准：

```powershell
node bin/repoctopus.js delivery checkpoint --workspace . --project-root .. --intent docs/examples/delivery-intent.yaml --policy repoctopus.yaml --json
```

实现和验证报告都进入本地 commit 后，生成一次待批准快照：

```powershell
node bin/repoctopus.js delivery prepare --workspace . --project-root .. --intent docs/examples/delivery-intent.yaml --policy repoctopus.yaml --report path/to/verification-report.md --json
node bin/repoctopus.js approval review --workspace . --change example-change
```

`approval review` 只在交互式终端中运行；IDE Adapter 可以把同一 `HumanDecisionRequest` 显示为原生确认卡片。批准后执行发布，失败时使用相同参数执行 `delivery resume`：

```powershell
node bin/repoctopus.js delivery publish --workspace . --project-root .. --change example-change --intent docs/examples/delivery-intent.yaml --policy repoctopus.yaml --report path/to/verification-report.md --json
node bin/repoctopus.js delivery refresh --workspace . --change example-change --policy repoctopus.yaml --json
```

## 架构入口

- [Runtime 架构](docs/architecture.md)
- [状态与恢复](docs/runtime-state.md)
- [OpenTelemetry 与 SigNoz](docs/telemetry.md)
- [交付治理与失败恢复](docs/delivery.md)
- [Human Decision 协议](docs/human-decision.md)
- [第三方来源与采用报告](third_party/comet/adoption-report.md)

## 开发验证

```powershell
npm run verify
npm run test:package-e2e
npm run test:tracer-e2e
```

完整验证还包含类型检查、Lint、确定性构建、来源摘要检查、OpenSpec 严格校验和实际 npm 打包安装。
