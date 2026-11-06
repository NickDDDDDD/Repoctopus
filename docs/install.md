# 获取与安装 Repoctopus

团队成员使用维护者分发的 CLI `.tgz`。CLI 可以在任意业务工作区运行，同一台机器可以用它管理多个 Workspace。Windows x64 桌面安装器是可选的本地看板。

## 团队成员安装 CLI

安装 Git 和 Node.js。支持 Node.js 22.16 或更新的 22.x 版本，以及 Node.js 24 及以上。使用团队指定版本的安装包，在该文件所在目录运行以下命令，以 0.1.0 为例。

```powershell
npm install -g --ignore-scripts --omit=dev ./repoctopus-0.1.0.tgz
repoctopus --help
```

如果系统找不到 `repoctopus`，用 `npm prefix -g` 找到全局前缀。Windows 的命令在该目录下，其他系统通常在该目录的 `bin` 下。将它加入 `PATH` 后重新打开终端和编码 Agent。Windows PowerShell 若阻止 npm 的 `.ps1` 启动器，使用 `npm.cmd` 和 `repoctopus.cmd`。

安装成功后切换到团队 Workspace，再按[首次接入](project-onboarding.md)或[快速开始](../README.md#快速开始)操作。若高级文档中的命令用 `node bin/repoctopus.js` 直接调用源码，安装后可改用 `repoctopus`，其余参数相同。

## 维护者生成并分发安装包

当前 [GitHub Releases](https://github.com/NickDDDDDD/Repoctopus/releases) 尚无安装资产。从团队选定的固定提交检出 Repoctopus 源码，在源码仓根目录执行以下命令。

```powershell
npm ci
npm run build
npm run check:generated
npm pack
```

`npm pack` 在当前目录输出 `repoctopus-<版本>.tgz`。把文件、对应 Git 提交 SHA 和文件的 SHA-256 一起通过团队渠道分发。同一个包版本可能来自不同提交，使用提交 SHA 和摘要识别团队实际使用的构建。

在 Windows x64 构建机上，可额外运行以下命令。

```powershell
npm run package:desktop
npm run check:desktop-package
```

Windows 安装器位于 `dist/desktop-release/Repoctopus-Desktop-<版本>-x64-Setup.exe`。安装后，CLI 启动或恢复 Change 时会尝试打开或激活 Dashboard。详见[桌面激活与诊断](desktop-activation.md#使用已安装应用)。
