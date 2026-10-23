# 配置 OpenTelemetry 与桌面 Dashboard

你可以把同一批 Repoctopus 观测 envelope 同时发送到团队 OTLP 后端和本地桌面 Dashboard。两个目的地分别确认；任一目的地不可用时，开发 Run 和另一个目的地继续运行。

本指南面向在 Windows 上开发 Repoctopus 的工程师。开始前，请安装 Node.js `22.16+` 或 `24+`，执行 `npm install` 和 `npm run build`，并准备一个含 `repoctopus.yaml` 的 Workspace。

## 选择运行方式

| 方式       | 前提                                       | 预期结果                                                    |
| ---------- | ------------------------------------------ | ----------------------------------------------------------- |
| 仅远端     | 新 Workspace，Dashboard 不可用             | `remote-otlp` 确认数据；Run 返回非阻塞桌面 warning          |
| 远端和桌面 | 远端端点可达，开发版 Dashboard 已构建      | 两个目的地收到相同 envelope 身份并分别确认                  |
| 桌面关闭   | `desktop-local` 已建立，随后关闭 Dashboard | 远端继续确认；本地 Cursor 保留积压和失败健康状态            |
| 桌面恢复   | 再次执行 `run start`，Dashboard 可以启动   | Runtime 先重放本地积压，再显示当前 change；远端 Cursor 不变 |

Repoctopus 不使用 SigNoZ 查询刷新桌面。Runtime 为两个目的地编码相同的标准 OTLP Trace、Log 和 Metric；本地 Receiver 接受上报后通过 IPC 推送投影更新。

## 配置仅远端上报

在从未激活 Dashboard 的新 Workspace 中，设置标准 OTLP/HTTP 环境变量并启动 Run：

```powershell
$env:OTEL_EXPORTER_OTLP_ENDPOINT = 'http://signoz.example.internal:4318'
$env:OTEL_EXPORTER_OTLP_HEADERS = 'signoz-ingestion-key=<credential>'
node bin/repoctopus.js run start --workspace . --change <change-id> --json
```

公共端点必须是 OTLP HTTP 根地址。Repoctopus 会追加 `/v1/traces`、`/v1/logs` 和 `/v1/metrics`。不要把凭据写入 `repoctopus.yaml` 或提交到 Git。

如果后端为三类信号提供不同 URL，请一次配置全部三个端点：

```powershell
$env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = 'https://otel.example.internal/v1/traces'
$env:OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'https://otel.example.internal/v1/logs'
$env:OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'https://otel.example.internal/v1/metrics'
node bin/repoctopus.js run start --workspace . --change <change-id> --json
```

只配置一个或两个信号端点会失败，因为那会让团队端看到不完整的工作流状态。没有配置任何远端端点时，Repoctopus 仍持久化本地 envelope，但不会建立 `remote-otlp` Cursor。

## 同时启用桌面 Dashboard

在 Repoctopus 源码 Workspace 中，先准备 Electron，再构建桌面应用：

```powershell
npm run desktop:prepare
npm run build:desktop
```

保留上一节的 OTLP 环境变量，然后启动 Run：

```powershell
node bin/repoctopus.js run start --workspace . --change <change-id> --json
```

`run start` 会启动或激活单实例 Dashboard，取得临时回环 Receiver 端点，并重放 `desktop-local` 的未确认 envelope。临时端口和会话凭据不是目的地身份，也不会写入远端配置。

## 验证桌面关闭时的降级

先成功运行一次远端加桌面场景，再关闭 Dashboard 窗口。当前开发版在最后一个窗口关闭时退出 Desktop Host 和本地 Receiver。

正在运行的 Repoctopus 仍会持久化新 envelope 并向 `remote-otlp` 投递。Runtime 尝试本地重放且失败时，只产生 `desktop-telemetry-replay-failed` warning；它不会回滚领域事实、远端确认或 Evidence 结果。

如果你在 Dashboard 不可用时启动新 Run，命令可能返回以下非阻塞 warning：

- `desktop-application-unavailable`：没有可启动的桌面应用；先执行桌面准备和构建命令。
- `desktop-platform-unsupported`：当前平台不是首发支持的 Windows；继续使用远端 OTLP。
- `desktop-activation-timeout`：Shell 没有在截止时间内发布 Receiver；结束残留桌面进程后重试。
- `desktop-activation-failed`：启动或激活失败；检查桌面构建和进程日志。
- `desktop-telemetry-replay-failed`：Receiver 已发布但本地重放失败；恢复 Dashboard 后启动下一个 Run。

这些 warning 不包含 OTLP 响应正文、凭据或 envelope 内容。

## 恢复桌面并重放积压

确认桌面构建仍然存在，然后启动下一个 Run：

```powershell
node bin/repoctopus.js run start --workspace . --change <change-id> --json
```

Runtime 在持久化新 Run 前激活 Dashboard，并用新的会话端点重放 `desktop-local` 积压。桌面确认只推进本地 Cursor；它不会重置或重放已经确认的 `remote-otlp` 数据。

投递采用 at-least-once。桌面投影通过稳定事件身份收敛重复记录；Repoctopus 不宣称多目的地 exactly-once。

## 运行四场景冒烟测试

执行文档契约测试：

```powershell
npm run test:telemetry-docs
```

测试使用远端和本地两个真实 OTLP HTTP 目的地，并在恢复时重建本地 Receiver。它覆盖仅远端、远端加桌面、桌面关闭和桌面恢复，还验证本页链接、命令、默认保留预算、目的地身份和环境变量名称与实现一致。

## 下一步

- 阅读[遥测数据与恢复契约](telemetry-reference.md)，了解 envelope 身份、Cursor、保留上限、可信关联和隐私边界。
- 阅读[Runtime 状态与恢复](runtime-state.md)，区分领域状态、轨迹和遥测投递状态。
- 运行 `npm run desktop:smoke`；[smoke 实现](../scripts/smoke-desktop.mjs)会验证 Electron Shell、Desktop Host、Receiver 和 Renderer 的完整纵切。
