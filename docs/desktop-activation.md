# 启动或恢复 Desktop Dashboard

Windows x64 用户安装 CLI 和桌面应用后，可以在同一桌面窗口查看工作流。启动或恢复 Change 时，CLI 会把对应的 Workspace、Change 和 Run 交给桌面应用。[安装指南](install.md#可选的-windows-dashboard)

## 使用已安装应用

打开团队 Workspace，在宿主中调用 `repoctopus` 处理实际需求。已有 Run 时，提供原 Run ID。若需要从终端恢复，在 Workspace 根目录运行。

```powershell
$runId = Read-Host '原 Run ID'
repoctopus.cmd run resume --workspace . --run $runId --json
```

Windows 安装器登记 `repoctopus://` 和用户级 `App Paths\Repoctopus.exe`，CLI 通过该登记启动应用或把 Run 转交给已打开的实例。

## 从源码启动

此节面向测试源码改动的维护者。从 Repoctopus 源码根目录构建，再指定用于验收的 Workspace。

1. 安装固定依赖并生成 CLI 与 Desktop artifact：

   ```powershell
   npm ci
   npm run build
   npm run check:generated
   ```

2. 用预先准备的验收 Workspace 和原 Run ID 恢复：

   ```powershell
   $workspace = Read-Host '验收 Workspace 的路径'
   $runId = Read-Host '原 Run ID'
   node bin/repoctopus.js run resume --workspace $workspace --run $runId --json
   ```

3. 在 JSON 响应的 `diagnostics` 中检查桌面激活结果：

   | Diagnostic                       | 含义                                     |
   | -------------------------------- | ---------------------------------------- |
   | `desktop.activation.started`     | 操作系统接受了首次桌面启动请求           |
   | `desktop.activation.activated`   | 操作系统接受了向现有单实例转交上下文请求 |
   | `desktop.activation.unavailable` | 本机没有可用启动目标，或启动请求失败     |
   | `desktop.activation.unsupported` | 当前平台不在正式支持范围                 |

`started` 和 `activated` 只表示操作系统接受了请求，不表示 Renderer 已绘制或 Desktop Host 已 ready。Dashboard 就绪后会从同一套 OTLP 事实流显示当前 Change。

## 验证安装包

维护者在 Repoctopus 源码根目录运行安装态验收。

1. 构建并检查安装包：

   ```powershell
   npm run package:desktop
   npm run check:desktop-package
   ```

2. 运行隔离的安装到卸载 E2E：

   ```powershell
   npm run test:desktop-package-e2e
   ```

该测试验证协议与 App Paths 登记、首次启动、第二实例转交、托盘恢复、完整退出和卸载清理。测试开始前会分别导出既有用户级注册项，测试结束或失败时删除测试登记并逐字节验证原状态已经恢复。

## 处理不可用或不支持结果

Desktop activation 是应用级的 best-effort 副作用，不是 Change 生命周期 Gate。`unavailable` 或 `unsupported` 只产生 warning；已经创建或恢复的 Run、当前 Work 和远端 OTLP 目的地继续运行。

1. 检查系统托盘，确认窗口是否已隐藏。
2. 使用安装器时，运行 `reg.exe query "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\Repoctopus.exe" /ve`，确认默认值指向可访问的应用文件。再运行 `reg.exe query HKCR\repoctopus\shell\open\command /ve`，核对协议处理器和 `%1` 参数。
3. 运行源码时，在源码根执行 `npm run build`，确认 `dist/desktop/main.js` 和固定版本的 Electron 已准备好。
4. 用原 Run ID 查看 `run status`。修复桌面后，按[已安装应用](#使用已安装应用)或[源码](#从源码启动)步骤恢复同一 Run。

`REPOCTOPUS_DESKTOP_EXECUTABLE` 只保留给受控测试和运维覆盖。不要把它写进团队配置、Workspace 文件或正常开发说明。

## 安全与数据边界

Runtime 和 Desktop 使用 `%LOCALAPPDATA%\Repoctopus\discovery` 交换短期 Receiver 位置。发现流程校验当前用户所有权、freshness、Host PID 创建身份，以及操作系统监听所有权；当 Windows 网络 compartment 隐藏端口表时，Receiver 必须用高熵 session token 证明同一 PID。任一检查失败都会 fail closed。

Dashboard 退出不会停止 Change Run，也不会重置远端 SigNoZ cursor。关于 Receiver、Projection 与关闭偏好，请参阅 [Desktop Dashboard](desktop-dashboard.md)；关于双目的地语义，请参阅 [OpenTelemetry](telemetry.md)。
