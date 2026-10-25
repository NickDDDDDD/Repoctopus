# Repoctopus

Repoctopus 是面向团队 Agent 开发的多仓交付编排器。它把 OpenSpec 规格、确定性 Change 生命周期、Evidence、可恢复发布与 OpenTelemetry 反馈放进同一个可检查的插件系统。Cordis 是唯一应用 Runtime；所有公共命令都使用短生命周期 composition，执行后释放资源。

团队从一个版本化 Workspace 进入工作流。单仓项目可把 Workspace 嵌入业务仓；多仓项目可使用与业务仓同级的独立 Workspace Repository。Workspace 保存 `repoctopus.yaml`、OpenSpec change 和最终 Change MR，业务实现保存在显式登记的业务仓。

## 快速开始

要求 Node.js `22.16+` 或 `24+`。

```powershell
npm install
npm run build
node bin/repoctopus.js project detect --scan-root C:\path\to\project --workspace C:\path\to\project\repoctopus --json
node bin/repoctopus.js run start --workspace C:\path\to\project\repoctopus --json
```

`run start` 返回 `runId`，Change 随后按 `Open → Design → Build → Verify → Archive` 推进：

```powershell
node bin/repoctopus.js run status --workspace . --run <run-id> --json
node bin/repoctopus.js run next --workspace . --run <run-id> --json
node bin/repoctopus.js run resume --workspace . --run <run-id> --json
node bin/repoctopus.js doctor --workspace . --run <run-id> --json
```

运行状态保存在 Workspace 的 `.repoctopus/`。OTLP 配置遵循标准 `OTEL_EXPORTER_OTLP_*` 环境变量；没有配置端点时遥测降级为空实现，不影响领域结果。

## Skills 与规格权威

DSH Skill Registry 统一解析内置、个人和项目 Skill：

```powershell
node bin/repoctopus.js skill list --workspace . --audience user --json
node bin/repoctopus.js skill get --workspace . --audience user --name tdd --json
node bin/repoctopus.js skill project --workspace . --target codex --json
```

当前 Specification Provider 使用 OpenSpec，并将 Proposal、Delta Specs、Design 与 Tasks 映射为稳定领域契约：

```powershell
node bin/repoctopus.js spec inspect --workspace . --change <change-id> --json
node bin/repoctopus.js spec validate --workspace . --change <change-id> --json
```

Provider 契约见 [Specification Provider](docs/specification.md)，Skill 组合规则见 [Skills 接入与投影](docs/skills.md)。

## Archive 发布与最终一致性

实现和 Verify 完成后，Archive 先冻结经过人工批准的 Delivery Intent，再关闭规格并发布全部 Business MR 与最终 Change MR：

```powershell
node bin/repoctopus.js run archive-prepare --workspace . --run <run-id> --attempt <attempt-id> --intent docs/examples/delivery-intent.yaml --json
node bin/repoctopus.js approval review --workspace . --change <change-id>
node bin/repoctopus.js run archive-publish --workspace . --run <run-id> --json
```

`archive-publish` 核对每个远端分支及 MR 的 repository、base、head 和 head OID，形成完整 `PublicationReceipt` 后完成原 Change Run。Repoctopus 不等待也不自动合入 MR；代码审查、流水线或人工修改造成的后续远端变化由下一次任务启动或显式短命令拉取：

```powershell
node bin/repoctopus.js change reconcile --workspace . --json
node bin/repoctopus.js change reconcile --workspace . --change <change-id> --json
```

无变化时命令直接退出；有变化时产生结构化影响审查。需要修正规格时建立普通后续 OpenSpec change，引用原 Change 与 Publication Receipt，不修改已归档目录或重开原 Run。

配置示例见 [repoctopus.yaml](docs/examples/repoctopus.yaml)，发布与恢复语义见 [交付治理](docs/delivery.md)，自举方式见 [短生命周期自举](docs/self-hosting.md)。

## 架构入口

- [Runtime 与插件架构](docs/architecture.md)
- [Plugin 与 lifecycle 扩展](docs/plugins.md)
- [状态、轨迹与恢复](docs/runtime-state.md)
- [项目接入](docs/project-onboarding.md)
- [Evidence](docs/evidence.md)
- [Specification Provider](docs/specification.md)
- [OpenTelemetry 与本地 Desktop](docs/telemetry.md)
- [交付治理与失败恢复](docs/delivery.md)
- [Human Decision 协议](docs/human-decision.md)
- [第三方来源与采用报告](third_party/comet/adoption-report.md)

## 开发验证

```powershell
npm run verify
npm run test:package-e2e
npm run test:tracer-e2e
```

完整验证包含类型检查、Lint、确定性构建、架构和来源摘要检查、OpenSpec 严格校验、单元/E2E 测试与实际 npm 打包安装。
