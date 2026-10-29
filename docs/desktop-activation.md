# 启动或恢复 Desktop Dashboard

本指南帮助 Windows x64 开发者从源码或已安装应用自动打开当前 Change。正常路径不需要设置 `REPOCTOPUS_DESKTOP_EXECUTABLE`：Runtime 在 Change Run 创建或恢复后选择受控启动目标，并把 Workspace、change 和 Run identity 交给唯一桌面实例。

## 从源码启动

开始前，请安装仓库声明的 Node.js 版本并确认当前目录是 Repoctopus Product Root。

1. 安装固定依赖并生成 CLI 与 Desktop artifact：

   ```powershell
   npm ci
   npm run build
   npm run check:generated
   ```

2. 启动或恢复一个 Change Run：

   ```powershell
   node bin/repoctopus.js run start --workspace . --change <change-id> --target main --json
   ```

3. 在 JSON 响应的 `diagnostics` 中检查桌面激活结果：

   | Diagnostic                       | 含义                                     |
   | -------------------------------- | ---------------------------------------- |
   | `desktop.activation.started`     | 操作系统接受了首次桌面启动请求           |
   | `desktop.activation.activated`   | 操作系统接受了向现有单实例转交上下文请求 |
   | `desktop.activation.unavailable` | 本机没有可用启动目标，或启动请求失败     |
   | `desktop.activation.unsupported` | 当前平台不在正式支持范围                 |

`started` 和 `activated` 只表示操作系统接受了请求，不表示 Renderer 已绘制或 Desktop Host 已 ready。Dashboard 就绪后会从同一套 OTLP 事实流显示当前 Change。

## 使用已安装应用

Windows 安装器登记 `repoctopus://` 用户级协议。安装完成后，在没有源码 Electron artifact 的 CLI Product Root 运行同一条 `run start` 命令；Runtime 会通过协议启动应用或把上下文转交给现有实例。

若要在发布前验证安装路径：

1. 构建并检查安装包：

   ```powershell
   npm run package:desktop
   npm run check:desktop-package
   ```

2. 运行隔离的安装到卸载 E2E：

   ```powershell
   npm run test:desktop-package-e2e
   ```

该测试验证协议注册、首次启动、第二实例转交、托盘恢复、完整退出和卸载清理。测试会拒绝覆盖已存在的 Repoctopus 协议处理器。

## 处理不可用或不支持结果

Desktop activation 是应用级的 best-effort 副作用，不是 Change 生命周期 Gate。`unavailable` 或 `unsupported` 只产生 warning；已经创建或恢复的 Run、当前 Work 和远端 OTLP 目的地继续运行。

1. 运行 `npm run build`，确认源码 `dist/desktop/main.js` 与固定 Electron executable 同时存在。
2. 对安装态运行 `reg.exe query HKCR\repoctopus\shell\open\command /ve`，确认处理器指向有效的 `Repoctopus.exe` 并转交 `%1`。
3. 检查系统托盘，确认窗口不是以 `tray` 偏好隐藏。
4. 运行 `node bin/repoctopus.js run status --workspace . --run <run-id> --json`，确认 Run 仍处于权威状态。
5. 修复本地桌面后再次运行 `run start`；稳定 Run identity 会恢复同一 Run，不会创建平行生命周期。

`REPOCTOPUS_DESKTOP_EXECUTABLE` 只保留给受控测试和运维覆盖。不要把它写进团队配置、Workspace 文件或正常开发说明。

## 安全与数据边界

Runtime 和 Desktop 使用 `%LOCALAPPDATA%\Repoctopus\discovery` 交换短期 Receiver 位置。发现流程校验当前用户所有权、freshness、Host PID 创建身份，以及操作系统监听所有权；当 Windows 网络 compartment 隐藏端口表时，Receiver 必须用高熵 session token 证明同一 PID。任一检查失败都会 fail closed。

Dashboard 退出不会停止 Change Run，也不会重置远端 SigNoZ cursor。关于 Receiver、Projection 与关闭偏好，请参阅 [Desktop Dashboard](desktop-dashboard.md)；关于双目的地语义，请参阅 [OpenTelemetry](telemetry.md)。
