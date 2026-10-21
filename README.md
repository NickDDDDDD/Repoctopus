# Repoctopus

Repoctopus 是面向团队 Agent 开发的多仓交付编排器。它把项目探测、确定性阶段推进、运行轨迹、断点恢复和 OpenTelemetry 反馈放进同一个可检查的插件系统，IDE 与 Agent 只通过稳定协议调用它。Cordis 是唯一应用 Runtime；Repoctopus 的能力以 Service、Provider 和 Contributor 组成。

当前版本包含运行基础和交付治理纵切：探测同级 Git 仓库，确定性推进工作流，自动创建并立即远端备份策略允许的 checkpoint commit，把验证报告绑定为多仓交付快照，并在用户通过 IDE 或 CLI 交互批准后可恢复地创建或更新 MR。Repoctopus 只读取 MR 合入事实，不自动 merge。

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

## Skills

Repoctopus 使用 DSH Skill Registry 统一解析内置、个人和项目 Skill。你可以查看有效目录、加载 Skill，或把同一目录投影到 Codex 和 OpenCode：

```powershell
node bin/repoctopus.js skill list --workspace . --audience user --json
node bin/repoctopus.js skill get --workspace . --audience user --name tdd --json
node bin/repoctopus.js skill project --workspace . --target codex --json
node bin/repoctopus.js skill project --workspace . --target opencode --json
```

Provider 优先级、项目替换、Run 快照和 `teach` 本地状态规则见 [Skills 接入与投影](docs/skills.md)。

## 规格权威

Repoctopus 通过可替换的 Specification Provider 使用规格体系。当前 OpenSpec Provider 支持规范化检查、严格校验、Evidence 节点和幂等关闭：

```powershell
node bin/repoctopus.js spec inspect --workspace . --change <change-id> --json
node bin/repoctopus.js spec validate --workspace . --change <change-id> --json
```

Provider 契约、Evidence 配置与权威资料冲突规则见 [Specification Provider](docs/specification.md)。

## 平台事件运维

平台未能直接投递 webhook 时，可以把已经验签或通过平台 API 获得的规范化 Envelope 写入同一个持久 Inbox；查询和人工重试都只经过 `PlatformEvents` 权威 Service：

```powershell
node bin/repoctopus.js event replay --workspace . --file verified-envelope.json --json
node bin/repoctopus.js event status --workspace . --envelope sha256:<digest> --json
node bin/repoctopus.js event retry --workspace . --envelope sha256:<digest> --json
```

`replay` 校验 Envelope 的身份和 payload 摘要并幂等接收，不直接调用下游 Coordinator。`retry` 只接受 `dead_letter`，不能重新执行已完成事件。命令输出是脱敏状态投影，不包含原始 payload、Header、签名、Lease token 或平台 Token。

Runner、Inbox、GitHub 验签和安全边界见[平台事件处理](docs/platform-events.md)。需要验证强制中断后的跨进程恢复时，按[平台事件故障恢复](docs/platform-event-recovery.md)运行签名 HTTP 演练。

正式工作区在 `repoctopus.yaml` 中选择 Provider、HTTP 入口、Inbox Runner 与可选的 Post-merge 策略后，可以启动常驻 Application：

```powershell
$env:REPOCTOPUS_GITHUB_WEBHOOK_SECRET = '<webhook-secret>'
$env:REPOCTOPUS_GITHUB_TOKEN = '<github-token>'
$env:REPOCTOPUS_GIT_AUTHOR_NAME = 'Repoctopus Bot'
$env:REPOCTOPUS_GIT_AUTHOR_EMAIL = 'repoctopus@example.invalid'
node bin/repoctopus.js runner start --workspace . --json
```

Runner 输出一次 `ready` envelope 后保持前台运行；由进程管理器发送 `SIGINT` 或 `SIGTERM` 时，它会停止接收新请求、排空有界操作并释放 HTTP 与后台 Fiber。完整配置、部署方式、数据边界和自举闭环见[自举与 Runner 部署](docs/self-hosting.md)。

Webhook 不可达或 Runner 曾离线时，可以执行一次短生命周期补偿；日常 `run start` 也会在创建新 Run 前调用相同入口：

```powershell
node bin/repoctopus.js post-merge reconcile --workspace . --json
```

补偿按 Repoctopus 已登记的团队 Change 和业务 MR role 查询，不按 MR 作者划分所有权。协调 MR 与业务 MR 可以同仓，但不能复用同一个 MR。多个 Runner 可以重复验证同一 change，远端发布以协调分支精确 OID、非强制 push 和结果核对安全收敛。

## 交付治理

通过项目接入流程生成 workspace 的 `repoctopus.yaml`，在其 `delivery` 段维护团队交付策略（完整示例见 [项目配置示例](docs/examples/repoctopus.yaml)），并为 change 创建 [交付意图](docs/examples/delivery-intent.yaml)。checkpoint 会普通 push 当前 HEAD、建立 upstream 并核对远端 OID，不需要逐次人工批准：

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

多仓项目首次接入和 Evidence 命令见 [项目接入](docs/project-onboarding.md)。

## 架构入口

- [Runtime 架构](docs/architecture.md)
- [状态与恢复](docs/runtime-state.md)
- [项目接入](docs/project-onboarding.md)
- [Evidence](docs/evidence.md)
- [Skills 接入与投影](docs/skills.md)
- [Specification Provider](docs/specification.md)
- [OpenTelemetry 与 SigNoz](docs/telemetry.md)
- [交付治理与失败恢复](docs/delivery.md)
- [观察和恢复 Post-merge 收尾](docs/post-merge.md)
- [自举与 Runner 部署](docs/self-hosting.md)
- [Human Decision 协议](docs/human-decision.md)
- [第三方来源与采用报告](third_party/comet/adoption-report.md)

## 开发验证

```powershell
npm run verify
npm run test:package-e2e
npm run test:tracer-e2e
```

完整验证还包含类型检查、Lint、确定性构建、来源摘要检查、OpenSpec 严格校验和实际 npm 打包安装。

仓库自身提交了最小 `repoctopus.yaml`，因此普通开发命令可以用同一条 Project composition 执行自举验证。生产 Runner 还需要平台事件、Credential 引用与 Post-merge 策略；可运行结构见[完整项目配置示例](docs/examples/repoctopus.yaml)，不要把秘密写入 YAML。
