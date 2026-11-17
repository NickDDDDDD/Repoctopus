# Repoctopus v0.1.3

本版提高 Windows 多仓工作流的恢复和发布可靠性，并改进入门文档和团队 Skill 配置体验。

## Runtime 修复

- Archive 的业务 PR 和规格 PR 共用 Runtime 已校验的 GitHub API 地址与凭据。恢复时沿用原 Run、Verify 证据和已发生的发布结果。[#100](https://github.com/NickDDDDDD/Repoctopus/pull/100)
- Build 绑定前识别误跟踪的 Runtime 输出。已有 Run 可以在验证过仅清理这些文件的提交后继续，保留原 Plan 和已完成工作包。[#99](https://github.com/NickDDDDDD/Repoctopus/pull/99)
- 规格校验保持只读。Provider 暂时不可用时保留当前 Work，正式的阶段证据和推进在同一次提交中生效。[#98](https://github.com/NickDDDDDD/Repoctopus/pull/98)

## Workspace

- 启动 Run 前可以预览每个 Work 的 Skill、来源、加载顺序和配置错误。[#97](https://github.com/NickDDDDDD/Repoctopus/pull/97)
- 初始化生成的 README、本地指南和入口说明与当前接入流程对齐。[#96](https://github.com/NickDDDDDD/Repoctopus/pull/96)

## 安装

```powershell
npm.cmd install --global --ignore-scripts --legacy-peer-deps https://github.com/NickDDDDDD/Repoctopus/releases/download/v0.1.3/repoctopus-0.1.3.tgz
repoctopus --version
```

Windows 桌面端使用本页的 `Repoctopus-Desktop-0.1.3-x64-Setup.exe`。升级前，有进行中的 Run 时先用创建该 Run 的版本完成交付。[安装与升级指南](https://github.com/NickDDDDDD/Repoctopus/blob/v0.1.3/docs/install.md)
